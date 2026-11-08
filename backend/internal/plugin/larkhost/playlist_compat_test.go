package larkhost

import (
	"database/sql"
	"fmt"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/library"
	pluginhost "lark/backend/internal/plugin/host"

	_ "github.com/lib-x/entsqlite"
)

func TestSongloftFavoritesDoNotTargetNativePlaylistOne(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	ctx := t.Context()
	owner := client.User.Create().SetUsername("owner").SetPasswordHash("unused").SetRole("admin").SaveX(ctx)
	other := client.User.Create().SetUsername("other").SetPasswordHash("unused").SaveX(ctx)
	service := library.New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	ordinary, err := service.CreatePlaylist(ctx, owner.ID, "Existing ordinary playlist", "", "")
	if err != nil || ordinary.ID != 1 {
		t.Fatalf("native fixture=%+v err=%v", ordinary, err)
	}
	track := client.Song.Create().SetTitle("Fixture").SetPath("/fixture.flac").SetFileName("fixture.flac").SaveX(ctx)
	host := New(client, service, Config{UserID: owner.ID}).Playlists()
	favorites, err := host.Get(ctx, 1)
	if err != nil || favorites.Name != "收藏" {
		t.Fatalf("compatibility ID 1 must be favorites, not native playlist: %+v %v", favorites, err)
	}
	result, err := host.AddSongs(ctx, 1, []int{track.ID, track.ID})
	if err != nil || result.Added != 1 || result.Skipped != 1 {
		t.Fatalf("favorite add=%+v %v", result, err)
	}
	stored, err := service.Song(ctx, owner.ID, track.ID)
	if err != nil || !stored.Favorite {
		t.Fatalf("favorite did not persist: %+v %v", stored, err)
	}
	items, err := service.PlaylistSongs(ctx, owner.ID, ordinary.ID, 0)
	if err != nil || len(items) != 0 {
		t.Fatalf("native playlist was mutated: %+v %v", items, err)
	}
	otherHost := New(client, service, Config{UserID: other.ID}).Playlists()
	otherFavorites, err := otherHost.Songs(ctx, 1, pluginhost.PlaylistSongQuery{})
	if err != nil || len(otherFavorites) != 0 {
		t.Fatalf("favorites leaked across users: %+v %v", otherFavorites, err)
	}
	listed, err := host.List(ctx)
	if err != nil || len(listed) != 2 || listed[0].ID != 1 || listed[1].ID <= 1_000_000_000 {
		t.Fatalf("playlist identities=%+v %v", listed, err)
	}
	if _, err := otherHost.Get(ctx, listed[1].ID); err == nil {
		t.Fatal("ordinary playlist owner check bypassed")
	}
	if _, err := host.Get(ctx, 2); err == nil {
		t.Fatal("stale ordinary ID silently accepted")
	}
	if err := host.RemoveSongs(ctx, 1, []int{track.ID}); err != nil {
		t.Fatal(err)
	}
	stored, err = service.Song(ctx, owner.ID, track.ID)
	if err != nil || stored.Favorite {
		t.Fatal("favorite removal did not persist")
	}
	if err := host.Delete(ctx, 1); err == nil {
		t.Fatal("built-in favorites playlist can be deleted")
	}
	if _, err := host.AddSongs(ctx, listed[1].ID, []int{track.ID}); err != nil {
		t.Fatal(err)
	}
	items, err = service.PlaylistSongs(ctx, owner.ID, ordinary.ID, 0)
	if err != nil || len(items) != 1 {
		t.Fatal("ordinary compatibility ID did not resolve to original playlist")
	}
	database, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.ExecContext(ctx, "UPDATE sqlite_sequence SET seq = ? WHERE name = 'playlists'", 1_000_000_000); err != nil {
		t.Fatal(err)
	}
	client.Playlist.Create().SetName("Historic high native ID").SetOwnerID(owner.ID).SaveX(ctx)
	if _, err := host.Get(ctx, 1_000_000_001); err == nil {
		t.Fatal("ambiguous historic ID silently mapped")
	}
}
