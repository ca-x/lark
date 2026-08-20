package library

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/artist"
	"lark/backend/ent/playlist"
	"lark/backend/ent/predicate"
	"lark/backend/ent/song"
	"lark/backend/ent/user"
	"lark/backend/ent/useralbumfavorite"
	"lark/backend/ent/userartistfavorite"
	"lark/backend/internal/models"
)

func (s *Service) albumSongCounts(ctx context.Context) (map[int]int, error) {
	s.countCacheMu.RLock()
	if cached := s.albumSongCountsAll.get(s.countCacheTTL); cached != nil {
		s.countCacheMu.RUnlock()
		return cached, nil
	}
	s.countCacheMu.RUnlock()

	rows := []albumSongCountRow{}
	if err := s.client.Song.Query().GroupBy(song.AlbumColumn).Aggregate(ent.Count()).Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counts := make(map[int]int, len(rows))
	for _, row := range rows {
		if row.AlbumID != nil && *row.AlbumID > 0 {
			counts[*row.AlbumID] = row.Count
		}
	}
	s.countCacheMu.Lock()
	s.albumSongCountsAll = cachedCounts{counts: counts, fetched: time.Now()}
	s.countCacheMu.Unlock()
	return counts, nil
}
func (s *Service) albumSongCountsForIDs(ctx context.Context, ids []int) (map[int]int, error) {
	if len(ids) == 0 {
		return map[int]int{}, nil
	}
	// Try the full cache first — if the full map is fresh, just slice the requested IDs.
	s.countCacheMu.RLock()
	if cached := s.albumSongCountsAll.get(s.countCacheTTL); cached != nil {
		s.countCacheMu.RUnlock()
		return countsFromFullMap(cached, ids), nil
	}
	s.countCacheMu.RUnlock()

	rows := []albumSongCountRow{}
	if err := s.client.Song.Query().
		Where(song.HasAlbumWith(album.IDIn(ids...))).
		GroupBy(song.AlbumColumn).
		Aggregate(ent.Count()).
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counts := make(map[int]int, len(rows))
	for _, row := range rows {
		if row.AlbumID != nil && *row.AlbumID > 0 {
			counts[*row.AlbumID] = row.Count
		}
	}
	return counts, nil
}
func (s *Service) artistSongCounts(ctx context.Context) (map[int]int, error) {
	s.countCacheMu.RLock()
	if cached := s.artistSongCountsAll.get(s.countCacheTTL); cached != nil {
		s.countCacheMu.RUnlock()
		return cached, nil
	}
	s.countCacheMu.RUnlock()

	rows := []artistSongCountRow{}
	if err := s.client.Song.Query().GroupBy(song.ArtistColumn).Aggregate(ent.Count()).Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counts := make(map[int]int, len(rows))
	for _, row := range rows {
		if row.ArtistID != nil && *row.ArtistID > 0 {
			counts[*row.ArtistID] = row.Count
		}
	}
	s.countCacheMu.Lock()
	s.artistSongCountsAll = cachedCounts{counts: counts, fetched: time.Now()}
	s.countCacheMu.Unlock()
	return counts, nil
}
func (s *Service) artistSongCountsForIDs(ctx context.Context, ids []int) (map[int]int, error) {
	if len(ids) == 0 {
		return map[int]int{}, nil
	}
	s.countCacheMu.RLock()
	if cached := s.artistSongCountsAll.get(s.countCacheTTL); cached != nil {
		s.countCacheMu.RUnlock()
		return countsFromFullMap(cached, ids), nil
	}
	s.countCacheMu.RUnlock()

	rows := []artistSongCountRow{}
	if err := s.client.Song.Query().
		Where(song.HasArtistWith(artist.IDIn(ids...))).
		GroupBy(song.ArtistColumn).
		Aggregate(ent.Count()).
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counts := make(map[int]int, len(rows))
	for _, row := range rows {
		if row.ArtistID != nil && *row.ArtistID > 0 {
			counts[*row.ArtistID] = row.Count
		}
	}
	return counts, nil
}
func collectAlbumIDs(items []*ent.Album) []int {
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids
}
func collectArtistIDs(items []*ent.Artist) []int {
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids
}
func (s *Service) playlistSongCount(ctx context.Context, item *ent.Playlist) (int, error) {
	if item == nil {
		return 0, nil
	}
	return item.QuerySongs().Count(ctx)
}
func (s *Service) CreatePlaylist(ctx context.Context, userID int, name, description, theme string) (models.Playlist, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return models.Playlist{}, fmt.Errorf("playlist name is required")
	}
	if theme == "" {
		theme = "deep-space"
	}
	p, err := s.client.Playlist.Create().SetName(name).SetDescription(description).SetCoverTheme(theme).SetOwnerID(userID).Save(ctx)
	if err != nil {
		return models.Playlist{}, err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	return mapPlaylist(p), nil
}
func (s *Service) PlaylistSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error) {
	p, err := s.client.Playlist.Query().
		Where(playlist.ID(id), playlist.HasOwnerWith(user.ID(userID))).
		WithSongs(func(q *ent.SongQuery) {
			q.Select(browseSongColumns...).WithArtist().WithAlbum()
			limitCollectionSongQuery(q, limit)
		}).
		Only(ctx)
	if err != nil {
		return nil, err
	}
	out := mapSongs(p.Edges.Songs)
	return s.applySongUserState(ctx, userID, out)
}
func (s *Service) AddSongToPlaylist(ctx context.Context, userID, playlistID, songID int) error {
	p, err := s.client.Playlist.Query().Where(playlist.ID(playlistID), playlist.HasOwnerWith(user.ID(userID))).Only(ctx)
	if err != nil {
		return err
	}
	if err := p.Update().AddSongIDs(songID).Exec(ctx); err != nil {
		return err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	return nil
}
func (s *Service) RemoveSongFromPlaylist(ctx context.Context, userID, playlistID, songID int) error {
	p, err := s.client.Playlist.Query().Where(playlist.ID(playlistID), playlist.HasOwnerWith(user.ID(userID))).Only(ctx)
	if err != nil {
		return err
	}
	if err := p.Update().RemoveSongIDs(songID).Exec(ctx); err != nil {
		return err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	return nil
}
func (s *Service) FavoriteAlbums(ctx context.Context, userID, limit int) ([]models.Album, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	favorites, err := s.client.UserAlbumFavorite.Query().
		Where(useralbumfavorite.HasUserWith(user.ID(userID))).
		WithAlbum(func(q *ent.AlbumQuery) {
			q.WithArtist().Where(album.HasSongs())
		}).
		Order(ent.Desc(useralbumfavorite.FieldCreatedAt)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(favorites))
	for _, favorite := range favorites {
		if favorite.Edges.Album != nil {
			ids = append(ids, favorite.Edges.Album.ID)
		}
	}
	counts, err := s.albumSongCountsForIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]models.Album, 0, len(favorites))
	for _, favorite := range favorites {
		if favorite.Edges.Album == nil {
			continue
		}
		item := mapAlbumWithCount(favorite.Edges.Album, counts[favorite.Edges.Album.ID])
		item.Favorite = true
		out = append(out, item)
	}
	return out, nil
}
func (s *Service) AlbumsPage(ctx context.Context, userID, limit, offset, artistID int) (models.AlbumPage, error) {
	return s.albumsPage(ctx, userID, limit, offset, artistID, false)
}

func (s *Service) FavoriteAlbumsPage(ctx context.Context, userID, limit, offset, artistID int) (models.AlbumPage, error) {
	return s.albumsPage(ctx, userID, limit, offset, artistID, true)
}

func (s *Service) albumsPage(ctx context.Context, userID, limit, offset, artistID int, favoritesOnly bool) (models.AlbumPage, error) {
	limit, offset = normalizePage(limit, offset)
	key := cacheKey("albums-page", userID, s.userCacheVersion(ctx, userID), limit, offset, artistID, favoritesOnly)
	var cached models.AlbumPage
	if ok, err := s.cacheGetJSON(ctx, key, &cached); err != nil {
		return models.AlbumPage{}, err
	} else if ok {
		return cached, nil
	}
	// Singleflight: collapse concurrent identical page requests (e.g. refreshAll
	// thundering herd) into a single DB load + cache write.
	v, err, _ := s.loadSF.Do(key, func() (any, error) {
		bgCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		// Re-check cache inside the flight.
		var inner models.AlbumPage
		if ok, e := s.cacheGetJSON(bgCtx, key, &inner); e == nil && ok {
			return inner, nil
		}
		predicates := []predicate.Album{album.HasSongs()}
		if artistID > 0 {
			predicates = append(predicates, album.HasArtistWith(artist.ID(artistID)))
		}
		if favoritesOnly {
			predicates = append(predicates, album.HasUserFavoritesWith(
				useralbumfavorite.HasUserWith(user.ID(userID)),
			))
		}
		total, e := s.client.Album.Query().Where(predicates...).Count(bgCtx)
		if e != nil {
			return models.AlbumPage{}, e
		}
		query := s.client.Album.Query().Where(predicates...).WithArtist().Order(ent.Desc(album.FieldUpdatedAt)).Limit(limit)
		if offset > 0 {
			query = query.Offset(offset)
		}
		items, e := query.All(bgCtx)
		if e != nil {
			return models.AlbumPage{}, e
		}
		counts, e := s.albumSongCountsForIDs(bgCtx, collectAlbumIDs(items))
		if e != nil {
			return models.AlbumPage{}, e
		}
		out := make([]models.Album, 0, len(items))
		for _, a := range items {
			out = append(out, mapAlbumWithCount(a, counts[a.ID]))
		}
		out, e = s.applyAlbumUserState(bgCtx, userID, out)
		if e != nil {
			return models.AlbumPage{}, e
		}
		page := models.AlbumPage{Items: out, Total: total, Limit: limit, Offset: offset, Page: offset/limit + 1}
		_ = s.cacheSetJSON(bgCtx, key, page)
		return page, nil
	})
	if err != nil {
		return models.AlbumPage{}, err
	}
	return v.(models.AlbumPage), nil
}
func (s *Service) cachedSongCollection(ctx context.Context, kind string, userID, id, limit int, load func(context.Context) ([]models.Song, error)) ([]models.Song, error) {
	key := cacheKey(kind, userID, s.userCacheVersion(ctx, userID), id, limit)
	var cached []models.Song
	if ok, err := s.cacheGetJSON(ctx, key, &cached); err != nil {
		return nil, err
	} else if ok {
		// Cache hit: re-apply fresh user state (play counts, last played, resume
		// positions) from DB. These fields change on every play and are NOT cached
		// — only the song structure is cached.
		return s.applySongUserState(ctx, userID, cached)
	}
	v, err, _ := s.loadSF.Do(key, func() (any, error) {
		// Use an internal bounded context so the producer isn't cancelled when the
		// first caller's request is aborted. Without this, a client disconnect on
		// the first waiter would abort the DB load and cascade the error to all
		// other waiters sharing this flight.
		bgCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		// Re-check the cache inside the flight.
		var inner []models.Song
		if ok, e := s.cacheGetJSON(bgCtx, key, &inner); e == nil && ok {
			return s.applySongUserState(bgCtx, userID, inner)
		}
		out, e := load(bgCtx)
		if e != nil {
			return nil, e
		}
		// Strip volatile user state before caching so the cached entry represents
		// the song structure only. PlayCount/LastPlayedAt/ResumePosition will be
		// overlaid fresh from DB on every read.
		stripped := stripSongUserState(out)
		_ = s.cacheSetJSON(bgCtx, key, stripped)
		return out, nil
	})
	if err != nil {
		return nil, err
	}
	return v.([]models.Song), nil
}

// stripSongUserState returns a copy of songs with volatile user state zeroed out.
// The cached representation only stores stable song data; user state is fetched
// fresh on every read to avoid stale play counts / resume positions.
func stripSongUserState(items []models.Song) []models.Song {
	out := make([]models.Song, len(items))
	copy(out, items)
	for i := range out {
		out[i].PlayCount = 0
		out[i].LastPlayedAt = nil
		out[i].ResumePosition = 0
		out[i].Favorite = false
	}
	return out
}
func (s *Service) AlbumSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error) {
	return s.cachedSongCollection(ctx, "album-songs", userID, id, limit, func(ctx context.Context) ([]models.Song, error) {
		a, err := s.client.Album.Query().Where(album.ID(id)).WithArtist().WithSongs(func(q *ent.SongQuery) {
			q.Select(browseSongColumns...).WithArtist().WithAlbum()
			limitCollectionSongQuery(q, limit)
		}).Only(ctx)
		if err != nil {
			return nil, err
		}
		if a.Year == 0 {
			s.triggerAlbumYearRefresh(id) // async; never blocks the request path
		}
		return s.applySongUserState(ctx, userID, mapSongs(a.Edges.Songs))
	})
}
func (s *Service) FavoriteArtists(ctx context.Context, userID, limit int) ([]models.Artist, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	favorites, err := s.client.UserArtistFavorite.Query().
		Where(userartistfavorite.HasUserWith(user.ID(userID))).
		WithArtist().
		Order(ent.Desc(userartistfavorite.FieldCreatedAt)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(favorites))
	for _, favorite := range favorites {
		if favorite.Edges.Artist != nil {
			ids = append(ids, favorite.Edges.Artist.ID)
		}
	}
	songCounts, err := s.artistSongCountsForIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	albumCounts, err := s.artistAlbumCountsForIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]models.Artist, 0, len(favorites))
	for _, favorite := range favorites {
		if favorite.Edges.Artist == nil {
			continue
		}
		item := mapArtistWithCounts(favorite.Edges.Artist, songCounts[favorite.Edges.Artist.ID], albumCounts[favorite.Edges.Artist.ID])
		item.Favorite = true
		out = append(out, item)
	}
	return out, nil
}
func (s *Service) SearchArtists(ctx context.Context, userID int, term string, limit int) ([]models.Artist, error) {
	term = strings.TrimSpace(term)
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if term != "" && s.searchCatalogCacheEnabled() {
		catalog, err := s.artistSearchCatalog(ctx)
		if err != nil {
			return nil, err
		}
		needle := searchCatalogTerm(term)
		ids := make([]int, 0, limit)
		for _, item := range catalog {
			if strings.Contains(item.Text, needle) {
				ids = append(ids, item.ID)
				if len(ids) >= limit {
					break
				}
			}
		}
		if len(ids) == 0 {
			return []models.Artist{}, nil
		}
		items, err := s.client.Artist.Query().Where(artist.IDIn(ids...)).Order(ent.Asc(artist.FieldName)).All(ctx)
		if err != nil {
			return nil, err
		}
		songCounts, err := s.artistSongCountsForIDs(ctx, ids)
		if err != nil {
			return nil, err
		}
		albumCounts, err := s.artistAlbumCountsForIDs(ctx, ids)
		if err != nil {
			return nil, err
		}
		out := make([]models.Artist, 0, len(items))
		for _, item := range items {
			out = append(out, mapArtistWithCounts(item, songCounts[item.ID], albumCounts[item.ID]))
		}
		return s.applyArtistUserState(ctx, userID, out)
	}
	query := s.client.Artist.Query().Order(ent.Asc(artist.FieldName)).Limit(limit)
	if term != "" {
		query = query.Where(artist.NameContainsFold(term))
	}
	items, err := query.All(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	songCounts, err := s.artistSongCountsForIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	albumCounts, err := s.artistAlbumCountsForIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]models.Artist, 0, len(items))
	for _, item := range items {
		out = append(out, mapArtistWithCounts(item, songCounts[item.ID], albumCounts[item.ID]))
	}
	return s.applyArtistUserState(ctx, userID, out)
}
func (s *Service) ArtistsPage(ctx context.Context, userID, limit, offset int, initial string) (models.ArtistPage, error) {
	return s.artistsPage(ctx, userID, limit, offset, initial, false)
}

func (s *Service) FavoriteArtistsPage(ctx context.Context, userID, limit, offset int, initial string) (models.ArtistPage, error) {
	return s.artistsPage(ctx, userID, limit, offset, initial, true)
}

func (s *Service) artistsPage(ctx context.Context, userID, limit, offset int, initial string, favoritesOnly bool) (models.ArtistPage, error) {
	limit, offset = normalizePage(limit, offset)
	initial = normalizeArtistInitial(initial)
	key := cacheKey("artists-page", userID, s.userCacheVersion(ctx, userID), limit, offset, initial, favoritesOnly)
	var cached models.ArtistPage
	if ok, err := s.cacheGetJSON(ctx, key, &cached); err != nil {
		return models.ArtistPage{}, err
	} else if ok {
		return cached, nil
	}
	v, err, _ := s.loadSF.Do(key, func() (any, error) {
		bgCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		var inner models.ArtistPage
		if ok, e := s.cacheGetJSON(bgCtx, key, &inner); e == nil && ok {
			return inner, nil
		}
		basePredicates := []predicate.Artist{}
		if favoritesOnly {
			basePredicates = append(basePredicates, artist.HasUserFavoritesWith(
				userartistfavorite.HasUserWith(user.ID(userID)),
			))
		}
		predicates := append([]predicate.Artist{}, basePredicates...)
		if initial != "" {
			predicates = append(predicates, artist.InitialEQ(initial))
		}
		initials, e := s.artistInitialsWithPredicates(bgCtx, basePredicates...)
		if e != nil {
			return models.ArtistPage{}, e
		}
		total, e := s.client.Artist.Query().Where(predicates...).Count(bgCtx)
		if e != nil {
			return models.ArtistPage{}, e
		}
		query := s.client.Artist.Query().Where(predicates...).Order(ent.Asc(artist.FieldInitial), ent.Asc(artist.FieldName)).Limit(limit)
		if offset > 0 {
			query = query.Offset(offset)
		}
		items, e := query.All(bgCtx)
		if e != nil {
			return models.ArtistPage{}, e
		}
		songCounts, e := s.artistSongCountsForIDs(bgCtx, collectArtistIDs(items))
		if e != nil {
			return models.ArtistPage{}, e
		}
		albumCounts, e := s.artistAlbumCountsForIDs(bgCtx, collectArtistIDs(items))
		if e != nil {
			return models.ArtistPage{}, e
		}
		out := make([]models.Artist, 0, len(items))
		for _, a := range items {
			out = append(out, mapArtistWithCounts(a, songCounts[a.ID], albumCounts[a.ID]))
		}
		out, e = s.applyArtistUserState(bgCtx, userID, out)
		if e != nil {
			return models.ArtistPage{}, e
		}
		page := models.ArtistPage{Items: out, Total: total, Limit: limit, Offset: offset, Page: offset/limit + 1, Initials: initials}
		_ = s.cacheSetJSON(bgCtx, key, page)
		return page, nil
	})
	if err != nil {
		return models.ArtistPage{}, err
	}
	return v.(models.ArtistPage), nil
}

func (s *Service) artistInitials(ctx context.Context) ([]string, error) {
	return s.artistInitialsWithPredicates(ctx)
}

func (s *Service) artistInitialsWithPredicates(ctx context.Context, predicates ...predicate.Artist) ([]string, error) {
	items, err := s.client.Artist.Query().
		Where(predicates...).
		Select(artist.FieldName, artist.FieldInitial).
		All(ctx)
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	for _, item := range items {
		initial := normalizeArtistInitial(item.Initial)
		computedInitial := artistInitial(item.Name)
		if initial == "" || (initial == "#" && computedInitial != "#") {
			initial = computedInitial
		}
		if initial != "" {
			set[initial] = true
		}
	}
	out := make([]string, 0, len(set))
	for initial := range set {
		out = append(out, initial)
	}
	sort.Strings(out)
	return out, nil
}
func (s *Service) ArtistSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error) {
	return s.cachedSongCollection(ctx, "artist-songs", userID, id, limit, func(ctx context.Context) ([]models.Song, error) {
		a, err := s.client.Artist.Query().Where(artist.ID(id)).WithSongs(func(q *ent.SongQuery) {
			q.Select(browseSongColumns...).WithArtist().WithAlbum().Order(ent.Asc(song.FieldTitle))
			limitCollectionSongQuery(q, limit)
		}).Only(ctx)
		if err != nil {
			return nil, err
		}
		return s.applySongUserState(ctx, userID, mapSongs(a.Edges.Songs))
	})
}
func (s *Service) ToggleAlbumFavorite(ctx context.Context, userID, id int) (models.Album, error) {
	if _, err := s.client.Album.Query().Where(album.ID(id), album.HasSongs()).Only(ctx); err != nil {
		return models.Album{}, err
	}
	existing, err := s.client.UserAlbumFavorite.Query().
		Where(useralbumfavorite.HasUserWith(user.ID(userID)), useralbumfavorite.HasAlbumWith(album.ID(id))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.Album{}, err
	}
	return s.setAlbumFavorite(ctx, userID, id, ent.IsNotFound(err), existing)
}

func (s *Service) SetAlbumFavorite(ctx context.Context, userID, id int, favorite bool) (models.Album, error) {
	if _, err := s.client.Album.Query().Where(album.ID(id), album.HasSongs()).Only(ctx); err != nil {
		return models.Album{}, err
	}
	existing, err := s.client.UserAlbumFavorite.Query().
		Where(useralbumfavorite.HasUserWith(user.ID(userID)), useralbumfavorite.HasAlbumWith(album.ID(id))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.Album{}, err
	}
	return s.setAlbumFavorite(ctx, userID, id, favorite, existing)
}

func (s *Service) setAlbumFavorite(ctx context.Context, userID, id int, favorite bool, existing *ent.UserAlbumFavorite) (models.Album, error) {
	changed := false
	if favorite && existing == nil {
		if _, err := s.client.UserAlbumFavorite.Create().SetUserID(userID).SetAlbumID(id).Save(ctx); err != nil && !ent.IsConstraintError(err) {
			return models.Album{}, err
		}
		changed = true
	} else if !favorite && existing != nil {
		if err := s.client.UserAlbumFavorite.DeleteOneID(existing.ID).Exec(ctx); err != nil && !ent.IsNotFound(err) {
			return models.Album{}, err
		}
		changed = true
	}
	if changed {
		s.invalidateUserLibraryCache(ctx, userID)
	}
	return s.Album(ctx, userID, id)
}

func (s *Service) ToggleArtistFavorite(ctx context.Context, userID, id int) (models.Artist, error) {
	if _, err := s.client.Artist.Get(ctx, id); err != nil {
		return models.Artist{}, err
	}
	existing, err := s.client.UserArtistFavorite.Query().
		Where(userartistfavorite.HasUserWith(user.ID(userID)), userartistfavorite.HasArtistWith(artist.ID(id))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.Artist{}, err
	}
	return s.setArtistFavorite(ctx, userID, id, ent.IsNotFound(err), existing)
}

func (s *Service) SetArtistFavorite(ctx context.Context, userID, id int, favorite bool) (models.Artist, error) {
	if _, err := s.client.Artist.Get(ctx, id); err != nil {
		return models.Artist{}, err
	}
	existing, err := s.client.UserArtistFavorite.Query().
		Where(userartistfavorite.HasUserWith(user.ID(userID)), userartistfavorite.HasArtistWith(artist.ID(id))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.Artist{}, err
	}
	return s.setArtistFavorite(ctx, userID, id, favorite, existing)
}

func (s *Service) setArtistFavorite(ctx context.Context, userID, id int, favorite bool, existing *ent.UserArtistFavorite) (models.Artist, error) {
	changed := false
	if favorite && existing == nil {
		if _, err := s.client.UserArtistFavorite.Create().SetUserID(userID).SetArtistID(id).Save(ctx); err != nil && !ent.IsConstraintError(err) {
			return models.Artist{}, err
		}
		changed = true
	} else if !favorite && existing != nil {
		if err := s.client.UserArtistFavorite.DeleteOneID(existing.ID).Exec(ctx); err != nil && !ent.IsNotFound(err) {
			return models.Artist{}, err
		}
		changed = true
	}
	if changed {
		s.invalidateUserLibraryCache(ctx, userID)
	}
	return s.Artist(ctx, userID, id)
}
func mapAlbum(item *ent.Album) models.Album {
	count := 0
	if item.Edges.Songs != nil {
		count = len(item.Edges.Songs)
	}
	return mapAlbumWithCount(item, count)
}
func mapAlbumWithCount(item *ent.Album, songCount int) models.Album {
	artistID := 0
	artistName := ""
	if item.Edges.Artist != nil {
		artistID = item.Edges.Artist.ID
		artistName = item.Edges.Artist.Name
	}
	year := item.Year
	for _, song := range item.Edges.Songs {
		if song.Year > 0 && (year == 0 || song.Year < year) {
			year = song.Year
		}
	}
	return models.Album{ID: item.ID, Title: item.Title, ArtistID: artistID, Artist: artistName, AlbumArtist: item.AlbumArtist, Year: year, Favorite: item.Favorite, SongCount: songCount, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
func mapArtist(item *ent.Artist) models.Artist {
	return mapArtistWithCounts(item, len(item.Edges.Songs), len(item.Edges.Albums))
}
func mapArtistWithCounts(item *ent.Artist, songCount, albumCount int) models.Artist {
	initial := normalizeArtistInitial(item.Initial)
	computedInitial := artistInitial(item.Name)
	if initial == "" || (initial == "#" && computedInitial != "#") {
		initial = computedInitial
	}
	return models.Artist{ID: item.ID, Name: item.Name, Initial: initial, SongCount: songCount, AlbumCount: albumCount, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
func mapPlaylist(item *ent.Playlist) models.Playlist {
	count := 0
	if item.Edges.Songs != nil {
		count = len(item.Edges.Songs)
	}
	return mapPlaylistWithCount(item, count)
}
func mapPlaylistWithCount(item *ent.Playlist, songCount int) models.Playlist {
	return models.Playlist{ID: item.ID, Name: item.Name, Description: item.Description, CoverTheme: item.CoverTheme, CoverURL: item.CoverURL, Favorite: item.Favorite, SongCount: songCount, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
