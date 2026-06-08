package library

import (
	"context"
	"strconv"
	"time"

	"golang.org/x/sync/errgroup"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/artist"
	"lark/backend/ent/playhistory"
	"lark/backend/ent/predicate"
	"lark/backend/ent/song"
	"lark/backend/ent/user"
	"lark/backend/ent/useralbumfavorite"
	"lark/backend/ent/userartistfavorite"
	"lark/backend/ent/usersongfavorite"
	"lark/backend/internal/models"
)

func (s *Service) ToggleSongFavorite(ctx context.Context, userID, id int) (models.Song, error) {
	if _, err := s.client.Song.Get(ctx, id); err != nil {
		return models.Song{}, err
	}
	existing, err := s.client.UserSongFavorite.Query().
		Where(usersongfavorite.HasUserWith(user.ID(userID)), usersongfavorite.HasSongWith(song.ID(id))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.Song{}, err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.UserSongFavorite.Create().SetUserID(userID).SetSongID(id).Save(ctx)
	} else {
		err = s.client.UserSongFavorite.DeleteOneID(existing.ID).Exec(ctx)
	}
	if err != nil {
		return models.Song{}, err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	return s.Song(ctx, userID, id)
}
func (s *Service) MarkPlayed(ctx context.Context, userID, id int) error {
	item, err := s.client.Song.Get(ctx, id)
	if err != nil {
		return err
	}
	now := time.Now()
	if _, err := s.client.PlayHistory.Create().
		SetUserID(userID).
		SetSongID(id).
		SetPlayedAt(now).
		SetUpdatedAt(now).
		SetDurationSeconds(item.DurationSeconds).
		SetDeviceType(playbackDeviceTypeFromContext(ctx)).
		Save(ctx); err != nil {
		return err
	}
	// NOTE: intentionally NOT calling invalidateUserLibraryCache here.
	// Playback state is stored in PlayHistory and overlaid on song responses.
	// MarkPlayed must not mutate the Song inventory row, otherwise Ent's
	// updated_at default makes recently played songs look newly added.
	// Bumping the user cache version would also cold-miss every cached library
	// page during normal playback.
	return s.cleanupPlaybackHistory(ctx, userID)
}
func (s *Service) SavePlaybackProgress(ctx context.Context, userID, id int, progressSeconds, durationSeconds float64, completed bool) error {
	item, err := s.client.Song.Get(ctx, id)
	if err != nil {
		return err
	}
	if durationSeconds <= 0 {
		durationSeconds = item.DurationSeconds
	}
	if progressSeconds < 0 {
		progressSeconds = 0
	}
	if durationSeconds > 0 && progressSeconds > durationSeconds {
		progressSeconds = durationSeconds
	}
	if durationSeconds > 0 && durationSeconds-progressSeconds <= 3 {
		completed = true
	}
	now := time.Now()
	deviceType := playbackDeviceTypeFromContext(ctx)
	deviceScope, err := s.playbackHistoryDeviceScope(ctx, userID)
	if err != nil {
		return err
	}
	history, err := s.client.PlayHistory.Query().
		Where(playHistorySongPredicates(userID, id, deviceScope)...).
		Order(ent.Desc(playhistory.FieldUpdatedAt), ent.Desc(playhistory.FieldPlayedAt)).
		First(ctx)
	if ent.IsNotFound(err) {
		_, err = s.client.PlayHistory.Create().
			SetUserID(userID).
			SetSongID(id).
			SetPlayedAt(now).
			SetUpdatedAt(now).
			SetProgressSeconds(progressSeconds).
			SetDurationSeconds(durationSeconds).
			SetCompleted(completed).
			SetDeviceType(deviceType).
			Save(ctx)
		// NOTE: intentionally NOT calling invalidateUserLibraryCache here.
		// Progress updates are high-frequency (every few seconds during playback).
		// Invalidating the user cache on each progress save would cold-miss every
		// cached page result, defeating the cache entirely. The play history data
		// is fetched fresh when needed (e.g. RecentPlayedSongs).
		if err != nil {
			return err
		}
		return s.cleanupPlaybackHistory(ctx, userID)
	}
	if err != nil {
		return err
	}
	if err := s.client.PlayHistory.UpdateOneID(history.ID).
		SetProgressSeconds(progressSeconds).
		SetDurationSeconds(durationSeconds).
		SetCompleted(completed).
		SetDeviceType(deviceType).
		SetUpdatedAt(now).
		Exec(ctx); err != nil {
		return err
	}
	return s.cleanupPlaybackHistory(ctx, userID)
}

func (s *Service) PlaybackHistory(ctx context.Context, userID, limit int) ([]models.PlaybackHistoryEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	deviceScope, err := s.playbackHistoryDeviceScope(ctx, userID)
	if err != nil {
		return nil, err
	}
	histories, err := s.client.PlayHistory.Query().
		Where(playHistoryUserPredicates(userID, deviceScope)...).
		WithSong(func(q *ent.SongQuery) {
			q.Select(browseSongColumns...).WithArtist().WithAlbum()
		}).
		Order(ent.Desc(playhistory.FieldUpdatedAt), ent.Desc(playhistory.FieldPlayedAt), ent.Desc(playhistory.FieldID)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return nil, err
	}
	songByID := make(map[int]models.Song, len(histories))
	rawSongs := make([]*ent.Song, 0, len(histories))
	seenSongs := map[int]bool{}
	for _, history := range histories {
		if history.Edges.Song == nil || seenSongs[history.Edges.Song.ID] {
			continue
		}
		seenSongs[history.Edges.Song.ID] = true
		rawSongs = append(rawSongs, history.Edges.Song)
	}
	songs, err := s.applySongUserStateWithDevice(ctx, userID, mapSongs(rawSongs), deviceScope)
	if err != nil {
		return nil, err
	}
	for _, item := range songs {
		songByID[item.ID] = item
	}
	out := make([]models.PlaybackHistoryEntry, 0, len(histories))
	for _, history := range histories {
		if history.Edges.Song == nil {
			continue
		}
		item, ok := songByID[history.Edges.Song.ID]
		if !ok {
			continue
		}
		out = append(out, models.PlaybackHistoryEntry{
			ID:              history.ID,
			Song:            item,
			PlayedAt:        history.PlayedAt,
			UpdatedAt:       history.UpdatedAt,
			ProgressSeconds: history.ProgressSeconds,
			DurationSeconds: history.DurationSeconds,
			Completed:       history.Completed,
			DeviceType:      history.DeviceType,
		})
	}
	return out, nil
}

func (s *Service) cleanupPlaybackHistory(ctx context.Context, userID int) error {
	if userID == 0 {
		return nil
	}
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return err
	}
	days := normalizePlaybackHistoryRetentionDays(settings.PlaybackHistoryRetentionDays)
	if days <= 0 {
		return nil
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	_, err = s.client.PlayHistory.Delete().
		Where(playhistory.HasUserWith(user.ID(userID)), playhistory.UpdatedAtLT(cutoff)).
		Exec(ctx)
	return err
}
func (s *Service) applySongUserState(ctx context.Context, userID int, items []models.Song) ([]models.Song, error) {
	deviceScope, err := s.playbackHistoryDeviceScope(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.applySongUserStateWithDevice(ctx, userID, items, deviceScope)
}
func (s *Service) applySongUserStateWithDevice(ctx context.Context, userID int, items []models.Song, deviceScope string) ([]models.Song, error) {
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}

	// Run all three queries concurrently — SQLite WAL supports concurrent readers.
	var (
		favoriteIDs     map[int]bool
		playCounts      map[int]int
		lastPlayed      map[int]time.Time
		resumePositions map[int]float64
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		favorites, err := s.client.UserSongFavorite.Query().
			Where(usersongfavorite.HasUserWith(user.ID(userID)), usersongfavorite.HasSongWith(song.IDIn(ids...))).
			WithSong().
			All(gctx)
		if err != nil {
			return err
		}
		favoriteIDs = make(map[int]bool, len(favorites))
		for _, favorite := range favorites {
			if favorite.Edges.Song != nil {
				favoriteIDs[favorite.Edges.Song.ID] = true
			}
		}
		return nil
	})
	g.Go(func() error {
		var err error
		playCounts, err = s.playHistoryCountsForSongs(gctx, userID, ids, deviceScope)
		return err
	})
	g.Go(func() error {
		var err error
		lastPlayed, resumePositions, err = s.latestPlayHistoryStateForSongs(gctx, userID, items, deviceScope)
		return err
	})
	if err := g.Wait(); err != nil {
		return nil, err
	}
	for i := range items {
		items[i].Favorite = favoriteIDs[items[i].ID]
		items[i].PlayCount = playCounts[items[i].ID]
		items[i].ResumePosition = resumePositions[items[i].ID]
		if playedAt, ok := lastPlayed[items[i].ID]; ok {
			items[i].LastPlayedAt = &playedAt
		} else {
			items[i].LastPlayedAt = nil
		}
	}
	return items, nil
}
func playHistoryUserPredicates(userID int, deviceScope string) []predicate.PlayHistory {
	predicates := []predicate.PlayHistory{playhistory.HasUserWith(user.ID(userID))}
	if deviceScope != "" {
		predicates = append(predicates, playhistory.DeviceTypeEQ(deviceScope))
	}
	return predicates
}
func playHistorySongPredicates(userID, songID int, deviceScope string) []predicate.PlayHistory {
	predicates := playHistoryUserPredicates(userID, deviceScope)
	predicates = append(predicates, playhistory.HasSongWith(song.ID(songID)))
	return predicates
}
func playHistorySongsPredicates(userID int, songIDs []int, deviceScope string) []predicate.PlayHistory {
	predicates := playHistoryUserPredicates(userID, deviceScope)
	predicates = append(predicates, playhistory.HasSongWith(song.IDIn(songIDs...)))
	return predicates
}
func (s *Service) playHistoryCountsForSongs(ctx context.Context, userID int, ids []int, deviceScope string) (map[int]int, error) {
	rows := []playHistorySongCountRow{}
	if err := s.client.PlayHistory.Query().
		Where(playHistorySongsPredicates(userID, ids, deviceScope)...).
		GroupBy(playhistory.SongColumn).
		Aggregate(ent.Count()).
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counts := make(map[int]int, len(rows))
	for _, row := range rows {
		if row.SongID != nil && *row.SongID > 0 {
			counts[*row.SongID] = row.Count
		}
	}
	return counts, nil
}
func (s *Service) latestPlayHistoryStateForSongs(ctx context.Context, userID int, items []models.Song, deviceScope string) (map[int]time.Time, map[int]float64, error) {
	lastPlayed := map[int]time.Time{}
	resumePositions := map[int]float64{}
	ids := make([]int, 0, len(items))
	durationByID := make(map[int]float64, len(items))
	for i := range items {
		ids = append(ids, items[i].ID)
		durationByID[items[i].ID] = items[i].DurationSeconds
	}
	limit := maxInt(len(ids)*4, 200)
	if limit > 1000 {
		limit = 1000
	}
	histories, err := s.client.PlayHistory.Query().
		Where(playHistorySongsPredicates(userID, ids, deviceScope)...).
		WithSong(func(q *ent.SongQuery) { q.Select(song.FieldID, song.FieldDurationSeconds) }).
		Order(ent.Desc(playhistory.FieldUpdatedAt), ent.Desc(playhistory.FieldPlayedAt)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return nil, nil, err
	}
	for _, history := range histories {
		if history.Edges.Song == nil {
			continue
		}
		songID := history.Edges.Song.ID
		if _, ok := lastPlayed[songID]; ok {
			continue
		}
		lastPlayed[songID] = history.PlayedAt
		if !history.Completed && history.ProgressSeconds >= 5 {
			duration := history.DurationSeconds
			if duration <= 0 {
				duration = durationByID[songID]
			}
			if duration <= 0 || history.ProgressSeconds < duration-5 {
				resumePositions[songID] = history.ProgressSeconds
			}
		}
	}
	return lastPlayed, resumePositions, nil
}
func (s *Service) applyAlbumUserState(ctx context.Context, userID int, items []models.Album) ([]models.Album, error) {
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	favorites, err := s.client.UserAlbumFavorite.Query().
		Where(useralbumfavorite.HasUserWith(user.ID(userID)), useralbumfavorite.HasAlbumWith(album.IDIn(ids...))).
		WithAlbum().
		All(ctx)
	if err != nil {
		return nil, err
	}
	favoriteIDs := map[int]bool{}
	for _, favorite := range favorites {
		if favorite.Edges.Album != nil {
			favoriteIDs[favorite.Edges.Album.ID] = true
		}
	}
	for i := range items {
		items[i].Favorite = favoriteIDs[items[i].ID]
	}
	return items, nil
}
func (s *Service) applyArtistUserState(ctx context.Context, userID int, items []models.Artist) ([]models.Artist, error) {
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	favorites, err := s.client.UserArtistFavorite.Query().
		Where(userartistfavorite.HasUserWith(user.ID(userID)), userartistfavorite.HasArtistWith(artist.IDIn(ids...))).
		WithArtist().
		All(ctx)
	if err != nil {
		return nil, err
	}
	favoriteIDs := map[int]bool{}
	for _, favorite := range favorites {
		if favorite.Edges.Artist != nil {
			favoriteIDs[favorite.Edges.Artist.ID] = true
		}
	}
	for i := range items {
		items[i].Favorite = favoriteIDs[items[i].ID]
	}
	return items, nil
}
func mapLibraryDirectory(item *ent.LibraryDirectory) models.LibraryDirectory {
	return models.LibraryDirectory{ID: strconv.Itoa(item.ID), Path: item.Path, Note: item.Note, WatchEnabled: item.WatchEnabled, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
func mapSongs(items []*ent.Song) []models.Song {
	out := make([]models.Song, 0, len(items))
	for _, item := range items {
		out = append(out, mapSong(item))
	}
	return out
}
func mapSong(item *ent.Song) models.Song {
	artistID, albumID := 0, 0
	artistName, albumTitle := "", ""
	if item.Edges.Artist != nil {
		artistID = item.Edges.Artist.ID
		artistName = item.Edges.Artist.Name
	}
	if item.Edges.Album != nil {
		albumID = item.Edges.Album.ID
		albumTitle = item.Edges.Album.Title
	}
	return models.Song{ID: item.ID, Title: item.Title, ArtistID: artistID, Artist: artistName, AlbumID: albumID, Album: albumTitle, Path: item.Path, FileName: item.FileName, Format: item.Format, Mime: item.Mime, SizeBytes: item.SizeBytes, DurationSeconds: item.DurationSeconds, SampleRate: item.SampleRate, BitRate: item.BitRate, BitDepth: item.BitDepth, Year: item.Year, NeteaseID: item.NeteaseID, Favorite: item.Favorite, PlayCount: item.PlayCount, LastPlayedAt: item.LastPlayedAt, HasLyrics: item.HasLyrics, LyricsSource: item.LyricsSource, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}
