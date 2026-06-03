package library

import (
	"context"
	"fmt"
	"testing"
	"time"

	"lark/backend/ent/enttest"
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
