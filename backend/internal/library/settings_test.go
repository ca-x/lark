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

func TestSettingsPersistDiagnosticsEnabled(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	saved, err := service.SaveSettings(ctx, models.Settings{
		Language:           "zh-CN",
		Theme:              "deep-space",
		NeteaseFallback:    true,
		DiagnosticsEnabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !saved.DiagnosticsEnabled {
		t.Fatal("expected saved diagnostics setting to be enabled")
	}
	loaded, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.DiagnosticsEnabled {
		t.Fatal("expected diagnostics setting to persist")
	}
	if loaded.PlaybackSourceTTLHours != defaultPlaybackSourceTTLHours {
		t.Fatalf("expected default playback source TTL %d, got %d", defaultPlaybackSourceTTLHours, loaded.PlaybackSourceTTLHours)
	}
}

func TestSettingsPersistPlaybackSourceTTL(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	saved, err := service.SaveSettings(ctx, models.Settings{
		Language:               "zh-CN",
		Theme:                  "deep-space",
		NeteaseFallback:        true,
		PlaybackSourceTTLHours: 48,
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.PlaybackSourceTTLHours != 48 {
		t.Fatalf("expected saved playback source TTL 48, got %d", saved.PlaybackSourceTTLHours)
	}
	loaded, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.PlaybackSourceTTLHours != 48 {
		t.Fatalf("expected playback source TTL to persist, got %d", loaded.PlaybackSourceTTLHours)
	}
}

func TestNewFeatureSettingsDefaultDisabled(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	settings, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if settings.MetadataGrouping || settings.SmartPlaylistsEnabled || settings.SharingEnabled || settings.SubsonicServerEnabled {
		t.Fatalf("expected new feature toggles to default disabled, got %#v", settings)
	}
}

func TestScrobblingSettingsPersistInDatabase(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client, cache: kv.NoopStore{}}

	saved, err := service.SaveScrobblingSettings(ctx, 9, models.ScrobblingSettings{
		Enabled:     true,
		Provider:    "last.fm",
		SubmitNow:   true,
		MinSeconds:  45,
		PercentGate: 60,
	}, "secret-token")
	if err != nil {
		t.Fatal(err)
	}
	if !saved.Enabled || saved.Provider != "lastfm" || !saved.HasToken {
		t.Fatalf("unexpected saved scrobbling settings: %#v", saved)
	}
	loaded, err := service.GetScrobblingSettings(ctx, 9)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.Enabled || loaded.Provider != "lastfm" || !loaded.HasToken || loaded.MinSeconds != 45 || loaded.PercentGate != 60 {
		t.Fatalf("expected scrobbling settings to persist in database, got %#v", loaded)
	}
}

func TestPlaybackSourceUsesKVRecordPerUser(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	store := kv.NewMemoryStore()
	defer store.Close()
	service := &Service{client: client, cache: store}

	artist, err := client.Artist.Create().SetName("Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	album, err := client.Album.Create().
		SetTitle("Album").
		SetAlbumArtist(artist.Name).
		SetArtist(artist).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	saved, err := service.SavePlaybackSource(ctx, 7, "album", album.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Type != "album" || saved.SourceID != album.ID || saved.UpdatedAt.IsZero() {
		t.Fatalf("unexpected saved playback source: %+v", saved)
	}
	loaded, err := service.PlaybackSource(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.Type != "album" || loaded.SourceID != album.ID {
		t.Fatalf("expected album playback source, got %+v", loaded)
	}

	saved, err = service.SavePlaybackSource(ctx, 7, "artist", artist.ID)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err = service.PlaybackSource(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.Type != "artist" || loaded.SourceID != artist.ID || saved.SourceID != artist.ID {
		t.Fatalf("expected artist playback source overwrite, got saved=%+v loaded=%+v", saved, loaded)
	}

	if err := service.ClearPlaybackSource(ctx, 7); err != nil {
		t.Fatal(err)
	}
	loaded, err = service.PlaybackSource(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if loaded != nil {
		t.Fatalf("expected playback source to be cleared, got %+v", loaded)
	}
}

func TestPlaybackSourceDropsInvalidKVRecord(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	store := kv.NewMemoryStore()
	defer store.Close()
	service := &Service{client: client, cache: store}

	if err := service.cacheSetJSONWithTTL(ctx, playbackSourceKey(9), models.PlaybackSource{Type: "playlist", SourceID: 1}, time.Hour); err != nil {
		t.Fatal(err)
	}
	loaded, err := service.PlaybackSource(ctx, 9)
	if err != nil {
		t.Fatal(err)
	}
	if loaded != nil {
		t.Fatalf("expected invalid playback source to be ignored, got %+v", loaded)
	}
	if _, ok, err := store.Get(ctx, playbackSourceKey(9)); err != nil || ok {
		t.Fatalf("expected invalid playback source KV to be deleted, ok=%v err=%v", ok, err)
	}
}
