package library

import (
	"context"
	"fmt"
	"testing"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/enttest"
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
