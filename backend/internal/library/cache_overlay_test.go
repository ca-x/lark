package library

import (
	"context"
	"fmt"
	"testing"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/enttest"
	"lark/backend/ent/song"
	"lark/backend/internal/kv"
	"lark/backend/internal/models"

	_ "github.com/lib-x/entsqlite"
)

type missOnceStore struct {
	*kv.MemoryStore
	key    string
	misses int
}

func (s *missOnceStore) Get(ctx context.Context, key string) ([]byte, bool, error) {
	if key == s.key && s.misses == 0 {
		s.misses++
		return nil, false, nil
	}
	return s.MemoryStore.Get(ctx, key)
}

func TestSongsPageSingleflightCacheRecheckAppliesFreshUserState(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	store := &missOnceStore{MemoryStore: kv.NewMemoryStore()}
	defer store.Close()
	service := &Service{client: client, cache: store, cacheTTL: time.Hour}

	userItem, err := client.User.Create().SetUsername("cache-overlay").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artistItem, err := client.Artist.Create().SetName("Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	albumItem, err := client.Album.Create().SetTitle("Album").SetAlbumArtist("Artist").SetArtist(artistItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	songItem, err := client.Song.Create().
		SetTitle("Song").
		SetPath("/music/song.flac").
		SetFileName("song.flac").
		SetDurationSeconds(120).
		SetArtist(artistItem).
		SetAlbum(albumItem).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	const limit = 50
	key := cacheKey("songs-page", userItem.ID, 0, "", "", false, limit, 0)
	store.key = key
	cached := models.SongPage{
		Items: stripSongUserState([]models.Song{{
			ID:              songItem.ID,
			Title:           songItem.Title,
			ArtistID:        artistItem.ID,
			Artist:          artistItem.Name,
			AlbumID:         albumItem.ID,
			Album:           albumItem.Title,
			DurationSeconds: songItem.DurationSeconds,
		}}),
		Total:  1,
		Limit:  limit,
		Offset: 0,
		Page:   1,
	}
	if err := service.cacheSetJSON(ctx, key, cached); err != nil {
		t.Fatal(err)
	}
	if err := service.MarkPlayed(ctx, userItem.ID, songItem.ID); err != nil {
		t.Fatal(err)
	}

	page, err := service.SongsPage(ctx, userItem.ID, "", false, limit, 0)
	if err != nil {
		t.Fatal(err)
	}
	if store.misses != 1 {
		t.Fatalf("expected one staged outer cache miss, got %d", store.misses)
	}
	if len(page.Items) != 1 {
		t.Fatalf("expected one cached song, got %d", len(page.Items))
	}
	if page.Items[0].PlayCount != 1 || page.Items[0].LastPlayedAt == nil {
		t.Fatalf("expected fresh user state overlaid from DB, got play_count=%d last_played=%v", page.Items[0].PlayCount, page.Items[0].LastPlayedAt)
	}
}

func TestMarkPlayedDoesNotTouchSongUpdatedAt(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	userItem, err := client.User.Create().SetUsername("song-updated-at-user").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artistItem, err := client.Artist.Create().SetName("Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	albumItem, err := client.Album.Create().SetTitle("Album").SetAlbumArtist("Artist").SetArtist(artistItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	createdAt := time.Now().Add(-2 * time.Hour).Truncate(time.Millisecond)
	updatedAt := time.Now().Add(-1 * time.Hour).Truncate(time.Millisecond)
	songItem, err := client.Song.Create().
		SetTitle("Inventory Song").
		SetPath("/music/inventory.flac").
		SetFileName("inventory.flac").
		SetCreatedAt(createdAt).
		SetUpdatedAt(updatedAt).
		SetArtist(artistItem).
		SetAlbum(albumItem).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	if err := service.MarkPlayed(ctx, userItem.ID, songItem.ID); err != nil {
		t.Fatal(err)
	}
	reloaded, err := client.Song.Get(ctx, songItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reloaded.UpdatedAt.Equal(updatedAt) {
		t.Fatalf("expected playback to preserve song updated_at %s, got %s", updatedAt, reloaded.UpdatedAt)
	}
	if reloaded.PlayCount != 0 || reloaded.LastPlayedAt != nil {
		t.Fatalf("expected playback to avoid mutating song user-state columns, got play_count=%d last_played=%v", reloaded.PlayCount, reloaded.LastPlayedAt)
	}
	visible, err := service.Song(ctx, userItem.ID, songItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if visible.PlayCount != 1 || visible.LastPlayedAt == nil {
		t.Fatalf("expected playback state overlay from history, got play_count=%d last_played=%v", visible.PlayCount, visible.LastPlayedAt)
	}
}

func TestSongsPageOrdersByCreatedAtNotUpdatedAt(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	userItem, err := client.User.Create().SetUsername("songs-page-order-user").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artistItem, err := client.Artist.Create().SetName("Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	albumItem, err := client.Album.Create().SetTitle("Album").SetAlbumArtist("Artist").SetArtist(artistItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Truncate(time.Millisecond)
	oldSong, err := client.Song.Create().
		SetTitle("Old import").
		SetPath("/music/old-import.flac").
		SetFileName("old-import.flac").
		SetCreatedAt(now.Add(-2 * time.Hour)).
		SetUpdatedAt(now).
		SetArtist(artistItem).
		SetAlbum(albumItem).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	newSong, err := client.Song.Create().
		SetTitle("New import").
		SetPath("/music/new-import.flac").
		SetFileName("new-import.flac").
		SetCreatedAt(now.Add(-1 * time.Hour)).
		SetUpdatedAt(now.Add(-90 * time.Minute)).
		SetArtist(artistItem).
		SetAlbum(albumItem).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	page, err := service.SongsPage(ctx, userItem.ID, "", false, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("expected two songs, got %d", len(page.Items))
	}
	if page.Items[0].ID != newSong.ID || page.Items[1].ID != oldSong.ID {
		t.Fatalf("expected library latest to follow created_at, got ids %v then %v", page.Items[0].ID, page.Items[1].ID)
	}

	if err := client.Song.UpdateOneID(oldSong.ID).SetUpdatedAt(now.Add(time.Hour)).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	page, err = service.SongsPage(ctx, userItem.ID, "", false, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if page.Items[0].ID != newSong.ID || page.Items[1].ID != oldSong.ID {
		t.Fatalf("expected updated_at changes to stay out of library latest, got ids %v then %v", page.Items[0].ID, page.Items[1].ID)
	}

	items, err := client.Song.Query().Order(ent.Desc(song.FieldUpdatedAt)).All(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].ID != oldSong.ID {
		t.Fatalf("test setup expected old song to have newest updated_at, got %+v", items)
	}
}
