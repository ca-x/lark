package library

import (
	"context"
	"fmt"
	"testing"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/artist"
	"lark/backend/ent/enttest"
	"lark/backend/ent/user"
	"lark/backend/ent/useralbumfavorite"
	"lark/backend/ent/userartistfavorite"
	"lark/backend/internal/kv"

	_ "github.com/lib-x/entsqlite"
)

func TestSongsPageSearchMatchesSongArtistAndAlbum(t *testing.T) {
	ctx := context.Background()
	service, userID := newSearchBenchmarkService(t, 36)

	cases := []struct {
		name string
		term string
	}{
		{name: "song title", term: "Song 0007"},
		{name: "artist name", term: "Artist 003"},
		{name: "album title", term: "Album 004"},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			page, err := service.SongsPage(ctx, userID, tt.term, false, 10, 0)
			if err != nil {
				t.Fatal(err)
			}
			if page.Total == 0 || len(page.Items) == 0 {
				t.Fatalf("expected search term %q to match at least one song", tt.term)
			}
		})
	}
}

func BenchmarkSongsPageSearchMemory(b *testing.B) {
	ctx := context.Background()
	service, userID := newSearchBenchmarkService(b, 5000)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		page, err := service.SongsPage(ctx, userID, "Artist 042", false, 25, 0)
		if err != nil {
			b.Fatal(err)
		}
		if len(page.Items) == 0 {
			b.Fatal("expected search results")
		}
	}
}

func TestSongsPageSearchCanUsePersistentCatalog(t *testing.T) {
	ctx := context.Background()
	service, userID := newSearchBenchmarkService(t, 36)
	store, err := kv.OpenBadger(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service.cache = store
	first, err := service.client.Song.Query().First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.cacheSetJSONPermanent(ctx, songCatalogCacheKey, []songSearchCatalogEntry{{ID: first.ID, Text: "synthetic-only-term"}}); err != nil {
		t.Fatal(err)
	}

	page, err := service.SongsPage(ctx, userID, "synthetic-only-term", false, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != first.ID {
		t.Fatalf("expected catalog-only search to return song %d, got total=%d items=%+v", first.ID, page.Total, page.Items)
	}
}

func TestSearchArtistsCanUsePersistentCatalog(t *testing.T) {
	ctx := context.Background()
	service, userID := newSearchBenchmarkService(t, 36)
	store, err := kv.OpenBadger(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service.cache = store
	first, err := service.client.Artist.Query().First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.cacheSetJSONPermanent(ctx, artistCatalogCacheKey, []artistSearchCatalogEntry{{ID: first.ID, Name: first.Name, Text: "synthetic-artist-term"}}); err != nil {
		t.Fatal(err)
	}

	items, err := service.SearchArtists(ctx, userID, "synthetic-artist-term", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != first.ID {
		t.Fatalf("expected catalog-only artist search to return artist %d, got %+v", first.ID, items)
	}
}

func TestFavoriteAlbumsReturnsFavoritedAlbumOutsideCurrentPage(t *testing.T) {
	ctx := context.Background()
	service, userID := newSearchBenchmarkService(t, 36)
	albums, err := service.client.Album.Query().Where(album.HasSongs()).Order(ent.Asc(album.FieldID)).All(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(albums) < 2 {
		t.Fatal("expected multiple albums")
	}
	favorited := albums[len(albums)-1]
	if _, err := service.client.UserAlbumFavorite.Create().SetUserID(userID).SetAlbumID(favorited.ID).Save(ctx); err != nil {
		t.Fatal(err)
	}

	items, err := service.FavoriteAlbums(ctx, userID, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one favorite album, got %d", len(items))
	}
	if items[0].ID != favorited.ID || !items[0].Favorite {
		t.Fatalf("expected favorite album %d with favorite=true, got %+v", favorited.ID, items[0])
	}
}

func TestFavoriteCollectionPagesAreUserScoped(t *testing.T) {
	ctx := context.Background()
	service, userID := newSearchBenchmarkService(t, 36)
	albums, err := service.client.Album.Query().
		Where(album.HasSongs()).
		WithArtist().
		Order(ent.Asc(album.FieldID)).
		All(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(albums) < 2 || albums[0].Edges.Artist == nil || albums[1].Edges.Artist == nil {
		t.Fatal("expected multiple albums with artists")
	}
	if _, err := albums[0].Edges.Artist.Update().SetInitial("A").Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := albums[1].Edges.Artist.Update().SetInitial("B").Save(ctx); err != nil {
		t.Fatal(err)
	}
	otherUser, err := service.client.User.Create().SetUsername("other-search-user").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.client.UserAlbumFavorite.Create().SetUserID(userID).SetAlbumID(albums[0].ID).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := service.client.UserArtistFavorite.Create().SetUserID(userID).SetArtistID(albums[0].Edges.Artist.ID).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := service.client.UserAlbumFavorite.Create().SetUserID(otherUser.ID).SetAlbumID(albums[1].ID).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := service.client.UserArtistFavorite.Create().SetUserID(otherUser.ID).SetArtistID(albums[1].Edges.Artist.ID).Save(ctx); err != nil {
		t.Fatal(err)
	}

	albumPage, err := service.FavoriteAlbumsPage(ctx, userID, 10, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if albumPage.Total != 1 || len(albumPage.Items) != 1 {
		t.Fatalf("expected one favorite album, total=%d items=%d", albumPage.Total, len(albumPage.Items))
	}
	if albumPage.Items[0].ID != albums[0].ID || !albumPage.Items[0].Favorite {
		t.Fatalf("expected user favorite album %d, got %+v", albums[0].ID, albumPage.Items[0])
	}
	otherArtistAlbums, err := service.FavoriteAlbumsPage(ctx, userID, 10, 0, albums[1].Edges.Artist.ID)
	if err != nil {
		t.Fatal(err)
	}
	if otherArtistAlbums.Total != 0 || len(otherArtistAlbums.Items) != 0 {
		t.Fatalf("expected other artist filter to exclude user favorites, got %+v", otherArtistAlbums)
	}

	artistPage, err := service.FavoriteArtistsPage(ctx, userID, 10, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if artistPage.Total != 1 || len(artistPage.Items) != 1 {
		t.Fatalf("expected one favorite artist, total=%d items=%d", artistPage.Total, len(artistPage.Items))
	}
	if artistPage.Items[0].ID != albums[0].Edges.Artist.ID || !artistPage.Items[0].Favorite {
		t.Fatalf("expected user favorite artist %d, got %+v", albums[0].Edges.Artist.ID, artistPage.Items[0])
	}
	if len(artistPage.Initials) != 1 || artistPage.Initials[0] != "A" {
		t.Fatalf("expected only the user's favorite initial A, got %v", artistPage.Initials)
	}
	otherInitialPage, err := service.FavoriteArtistsPage(ctx, userID, 10, 0, "B")
	if err != nil {
		t.Fatal(err)
	}
	if otherInitialPage.Total != 0 || len(otherInitialPage.Items) != 0 {
		t.Fatalf("expected other user's favorite initial to stay isolated, got %+v", otherInitialPage)
	}
}

func TestSetCollectionFavoritesIsIdempotent(t *testing.T) {
	ctx := context.Background()
	service, userID := newSearchBenchmarkService(t, 12)
	item, err := service.client.Album.Query().Where(album.HasSongs()).WithArtist().First(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if item.Edges.Artist == nil {
		t.Fatal("expected album artist")
	}

	for attempt := 0; attempt < 2; attempt++ {
		got, err := service.SetAlbumFavorite(ctx, userID, item.ID, true)
		if err != nil {
			t.Fatal(err)
		}
		if !got.Favorite {
			t.Fatalf("expected album favorite after attempt %d", attempt+1)
		}
		artistItem, err := service.SetArtistFavorite(ctx, userID, item.Edges.Artist.ID, true)
		if err != nil {
			t.Fatal(err)
		}
		if !artistItem.Favorite {
			t.Fatalf("expected artist favorite after attempt %d", attempt+1)
		}
	}
	albumCount, err := service.client.UserAlbumFavorite.Query().
		Where(useralbumfavorite.HasUserWith(user.ID(userID)), useralbumfavorite.HasAlbumWith(album.ID(item.ID))).
		Count(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artistCount, err := service.client.UserArtistFavorite.Query().
		Where(userartistfavorite.HasUserWith(user.ID(userID)), userartistfavorite.HasArtistWith(artist.ID(item.Edges.Artist.ID))).
		Count(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if albumCount != 1 || artistCount != 1 {
		t.Fatalf("expected one favorite edge each, album=%d artist=%d", albumCount, artistCount)
	}

	for attempt := 0; attempt < 2; attempt++ {
		got, err := service.SetAlbumFavorite(ctx, userID, item.ID, false)
		if err != nil {
			t.Fatal(err)
		}
		if got.Favorite {
			t.Fatalf("expected album favorite cleared after attempt %d", attempt+1)
		}
		artistItem, err := service.SetArtistFavorite(ctx, userID, item.Edges.Artist.ID, false)
		if err != nil {
			t.Fatal(err)
		}
		if artistItem.Favorite {
			t.Fatalf("expected artist favorite cleared after attempt %d", attempt+1)
		}
	}
}

func newSearchBenchmarkService(tb testing.TB, songCount int) (*Service, int) {
	tb.Helper()
	ctx := context.Background()
	client := enttest.Open(tb, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", tb.Name()))
	tb.Cleanup(func() { client.Close() })
	userItem, err := client.User.Create().SetUsername("search-user").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		tb.Fatal(err)
	}

	artists := make([]*ent.Artist, 0, 100)
	for i := 0; i < 100; i++ {
		item, err := client.Artist.Create().SetName(fmt.Sprintf("Artist %03d", i)).Save(ctx)
		if err != nil {
			tb.Fatal(err)
		}
		artists = append(artists, item)
	}

	albums := make([]*ent.Album, 0, 200)
	for i := 0; i < 200; i++ {
		item, err := client.Album.Create().
			SetTitle(fmt.Sprintf("Album %03d", i)).
			SetAlbumArtist(artists[i%len(artists)].Name).
			SetArtist(artists[i%len(artists)]).
			Save(ctx)
		if err != nil {
			tb.Fatal(err)
		}
		albums = append(albums, item)
	}

	const batchSize = 500
	for start := 0; start < songCount; start += batchSize {
		end := start + batchSize
		if end > songCount {
			end = songCount
		}
		builders := make([]*ent.SongCreate, 0, end-start)
		for i := start; i < end; i++ {
			ar := artists[i%len(artists)]
			al := albums[i%len(albums)]
			builders = append(builders, client.Song.Create().
				SetTitle(fmt.Sprintf("Song %04d", i)).
				SetPath(fmt.Sprintf("/music/artist-%03d/album-%03d/song-%04d.flac", i%len(artists), i%len(albums), i)).
				SetFileName(fmt.Sprintf("song-%04d.flac", i)).
				SetFormat("flac").
				SetMime("audio/flac").
				SetDurationSeconds(180).
				SetArtist(ar).
				SetAlbum(al))
		}
		if err := client.Song.CreateBulk(builders...).Exec(ctx); err != nil {
			tb.Fatal(err)
		}
	}

	return &Service{client: client}, userItem.ID
}
