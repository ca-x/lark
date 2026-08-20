package library

import (
	"context"
	"fmt"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/kv"

	_ "github.com/lib-x/entsqlite"
)

func TestAddSongsToPlaylistIsAtomicAndDeduplicatesIDs(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	store := kv.NewMemoryStore()
	defer store.Close()
	service := &Service{client: client, cache: store}

	owner, err := client.User.Create().SetUsername("playlist-owner").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	playlistItem, err := client.Playlist.Create().SetName("Plugin queue").SetOwnerID(owner.ID).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	first, err := client.Song.Create().SetTitle("First").SetPath("/music/first.flac").SetFileName("first.flac").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	second, err := client.Song.Create().SetTitle("Second").SetPath("/music/second.flac").SetFileName("second.flac").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := service.AddSongsToPlaylist(ctx, owner.ID, playlistItem.ID, []int{first.ID, second.ID + 1000}); err == nil {
		t.Fatal("expected an invalid song ID to reject the whole batch")
	}
	items, err := service.PlaylistSongs(ctx, owner.ID, playlistItem.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("failed batch left partial playlist contents: %+v", items)
	}

	added, err := service.AddSongsToPlaylist(ctx, owner.ID, playlistItem.ID, []int{first.ID, second.ID, first.ID})
	if err != nil {
		t.Fatal(err)
	}
	if added != 2 {
		t.Fatalf("added = %d, want 2 unique songs", added)
	}
	items, err = service.PlaylistSongs(ctx, owner.ID, playlistItem.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("playlist contains %d songs, want 2", len(items))
	}
}
