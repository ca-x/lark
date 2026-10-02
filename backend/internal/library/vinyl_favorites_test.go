package library

import (
	"slices"
	"testing"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/internal/kv"
)

func TestVinylFavoriteAlbumPages(t *testing.T) {
	ctx := t.Context()
	service, userID := newSearchBenchmarkService(t, 200)
	service.cache = kv.NewMemoryStore()
	service.cacheTTL = time.Hour
	albums, err := service.client.Album.Query().WithArtist().Order(ent.Asc(album.FieldID)).All(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// This artist has two albums, including one beyond the first catalog page.
	artistID := albums[0].Edges.Artist.ID
	if _, err := service.SetArtistFavorite(ctx, userID, artistID, true); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int{albums[0].ID, albums[1].ID} {
		if _, err := service.SetAlbumFavorite(ctx, userID, id, true); err != nil {
			t.Fatal(err)
		}
	}
	other, err := service.client.User.Create().SetUsername("vinyl-other").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetArtistFavorite(ctx, other.ID, albums[2].Edges.Artist.ID, true); err != nil {
		t.Fatal(err)
	}

	for _, tt := range []struct {
		name            string
		userID          int
		albums, artists bool
		artistID        int
		want            []int
	}{
		{name: "albums", userID: userID, albums: true, want: []int{albums[0].ID, albums[1].ID}},
		{name: "artists across pages", userID: userID, artists: true, want: []int{albums[0].ID, albums[100].ID}},
		{name: "union deduplicates overlap", userID: userID, albums: true, artists: true, want: []int{albums[0].ID, albums[1].ID, albums[100].ID}},
		{name: "artist constraint", userID: userID, albums: true, artists: true, artistID: artistID, want: []int{albums[0].ID, albums[100].ID}},
		{name: "other user", userID: other.ID, albums: true, artists: true, want: []int{albums[2].ID, albums[102].ID}},
		{name: "anonymous", albums: true, artists: true, want: []int{}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var got []int
			for offset := range len(tt.want) + 1 {
				page, err := service.FilteredAlbumsPage(ctx, tt.userID, 1, offset, tt.artistID, tt.albums, tt.artists)
				if err != nil {
					t.Fatal(err)
				}
				if page.Total != len(tt.want) || page.Offset != offset || page.Page != offset+1 {
					t.Fatalf("unexpected page metadata: %+v", page)
				}
				for _, item := range page.Items {
					got = append(got, item.ID)
					wantFavorite := tt.userID == userID && (item.ID == albums[0].ID || item.ID == albums[1].ID)
					if item.Favorite != wantFavorite {
						t.Fatalf("album %d favorite=%v, want %v", item.ID, item.Favorite, wantFavorite)
					}
				}
			}
			slices.Sort(got)
			if !slices.Equal(got, tt.want) {
				t.Fatalf("albums = %v, want %v", got, tt.want)
			}
		})
	}

	// The same filter must reflect unfavoriting rather than reuse stale cached results.
	if _, err := service.SetArtistFavorite(ctx, userID, artistID, false); err != nil {
		t.Fatal(err)
	}
	page, err := service.FilteredAlbumsPage(ctx, userID, 1, 0, 0, false, true)
	if err != nil || page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("cleared artist favorites: %+v, err=%v", page, err)
	}
	all, err := service.AlbumsPage(ctx, userID, 60, 0, 0)
	if err != nil || all.Total != 200 || len(all.Items) != 60 {
		t.Fatalf("unfiltered catalog: %+v, err=%v", all, err)
	}
}
