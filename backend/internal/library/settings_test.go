package library

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"lark/backend/ent/enttest"
	"lark/backend/ent/playhistory"
	"lark/backend/ent/user"
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
	if loaded.PlaybackHistoryRetentionDays != defaultPlaybackHistoryRetentionDays {
		t.Fatalf("expected default playback history retention %d, got %d", defaultPlaybackHistoryRetentionDays, loaded.PlaybackHistoryRetentionDays)
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

func TestSettingsPersistPlaybackHistoryRetention(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	saved, err := service.SaveSettings(ctx, models.Settings{
		Language:                     "zh-CN",
		Theme:                        "deep-space",
		NeteaseFallback:              true,
		PlaybackSourceTTLHours:       24,
		PlaybackHistoryRetentionDays: 90,
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.PlaybackHistoryRetentionDays != 90 {
		t.Fatalf("expected saved playback history retention 90, got %d", saved.PlaybackHistoryRetentionDays)
	}
	loaded, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.PlaybackHistoryRetentionDays != 90 {
		t.Fatalf("expected playback history retention to persist, got %d", loaded.PlaybackHistoryRetentionDays)
	}

	forever, err := service.SaveSettings(ctx, models.Settings{
		Language:                     "zh-CN",
		Theme:                        "deep-space",
		NeteaseFallback:              true,
		PlaybackSourceTTLHours:       24,
		PlaybackHistoryRetentionDays: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if forever.PlaybackHistoryRetentionDays != 0 {
		t.Fatalf("expected zero retention to mean forever, got %d", forever.PlaybackHistoryRetentionDays)
	}
}

func TestSettingsPersistLyricsAndTagWritebackOptions(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	saved, err := service.SaveSettings(ctx, models.Settings{
		Language:                  "zh-CN",
		Theme:                     "deep-space",
		NeteaseFallback:           true,
		LyricsAutoSaveToSongDir:   true,
		LyricsFontFamily:          `"LXGW WenKai"`,
		LyricsFontURL:             "/api/fonts/LXGW%20WenKai.woff2",
		LyricsFontSize:            99,
		LibraryTagWriteback:       true,
		LibraryPathMetadataAssist: true,
		PlaybackSourceTTLHours:    24,
		TranscodePolicy:           "auto",
		TranscodeQualityKbps:      192,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !saved.LyricsAutoSaveToSongDir || saved.LyricsFontFamily != "LXGW WenKai" || saved.LyricsFontURL != "/api/fonts/LXGW%20WenKai.woff2" || saved.LyricsFontSize != 72 || !saved.LibraryTagWriteback || !saved.LibraryPathMetadataAssist {
		t.Fatalf("unexpected saved lyrics/tag settings: %#v", saved)
	}
	loaded, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.LyricsAutoSaveToSongDir || loaded.LyricsFontFamily != "LXGW WenKai" || loaded.LyricsFontURL != "/api/fonts/LXGW%20WenKai.woff2" || loaded.LyricsFontSize != 72 || !loaded.LibraryTagWriteback || !loaded.LibraryPathMetadataAssist {
		t.Fatalf("expected lyrics/tag settings to persist, got %#v", loaded)
	}

	cleared, err := service.SaveSettings(ctx, models.Settings{
		Language:               "zh-CN",
		Theme:                  "deep-space",
		NeteaseFallback:        true,
		LyricsFontFamily:       "Legacy Free Text",
		PlaybackSourceTTLHours: 24,
		TranscodePolicy:        "auto",
		TranscodeQualityKbps:   192,
	})
	if err != nil {
		t.Fatal(err)
	}
	if cleared.LyricsFontFamily != "" || cleared.LyricsFontURL != "" {
		t.Fatalf("expected lyrics font without uploaded font URL to be cleared, got %#v", cleared)
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
	if settings.MetadataGrouping || settings.LibraryTagWriteback || settings.LibraryPathMetadataAssist || settings.LyricsAutoSaveToSongDir || settings.LyricsFontFamily != "" || settings.LyricsFontURL != "" || settings.LyricsFontSize != 0 || settings.SmartPlaylistsEnabled || settings.SharingEnabled || settings.SubsonicServerEnabled {
		t.Fatalf("expected new feature toggles to default disabled, got %#v", settings)
	}
}

func TestCollectionCoverCacheStoresHitsAndMisses(t *testing.T) {
	service := &Service{dataDir: t.TempDir()}

	if err := service.writeCollectionCoverCache("albums", "12", "image/png", []byte("cover")); err != nil {
		t.Fatal(err)
	}
	data, mimeType, ok, err := service.readCollectionCoverCache("albums", "12")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || string(data) != "cover" || mimeType != "image/png" {
		t.Fatalf("expected cached album cover hit, got ok=%v mime=%q data=%q", ok, mimeType, string(data))
	}

	if err := service.writeCollectionCoverMiss("albums", "12"); err != nil {
		t.Fatal(err)
	}
	data, mimeType, ok, err = service.readCollectionCoverCache("albums", "12")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || len(data) != 0 || mimeType != "" {
		t.Fatalf("expected cached album cover miss, got ok=%v mime=%q data=%q", ok, mimeType, string(data))
	}
	if _, err := os.Stat(filepath.Join(service.collectionCoverCacheDir("albums"), "12.png")); !os.IsNotExist(err) {
		t.Fatalf("expected hit cache to be removed after miss write, got err=%v", err)
	}
}

func TestUISoundSettingsDefaultDisabledAndPersistPerUser(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	defaults, err := service.GetUISoundSettings(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if defaults.Enabled {
		t.Fatal("expected UI sounds to default disabled")
	}
	if defaults.Volume <= 0 {
		t.Fatalf("expected default UI sound volume, got %f", defaults.Volume)
	}

	saved, err := service.SaveUISoundSettings(ctx, 7, models.UISoundSettings{Enabled: true, Volume: 0.42})
	if err != nil {
		t.Fatal(err)
	}
	if !saved.Enabled || saved.Volume != 0.42 {
		t.Fatalf("expected saved UI sounds setting to persist, got %#v", saved)
	}
	muted, err := service.SaveUISoundSettings(ctx, 7, models.UISoundSettings{Enabled: true, Volume: 0})
	if err != nil {
		t.Fatal(err)
	}
	if muted.Volume != 0 {
		t.Fatalf("expected zero UI sound volume to be preserved, got %#v", muted)
	}
	otherUser, err := service.GetUISoundSettings(ctx, 8)
	if err != nil {
		t.Fatal(err)
	}
	if otherUser.Enabled {
		t.Fatal("expected UI sounds setting to be scoped per user")
	}
}

func TestUserPreferencesPersistPerUser(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	defaults, err := service.GetUserPreferences(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if defaults.HomePlayerStyle != "vinyl" || defaults.MobileHomePlayerStyle != "neon-console" || defaults.ArtistAlbumDisplayStyle != "classic" || defaults.LyricsDisplayStyle != "immersive" || !defaults.LyricsDragSeekEnabled || defaults.TerminalShellTheme != "operator" {
		t.Fatalf("expected default user preferences, got %#v", defaults)
	}

	saved, err := service.SaveUserPreferences(ctx, 7, models.UserPreferences{
		HomePlayerStyle:         "running-kitten",
		MobileHomePlayerStyle:   "smartisan-classic",
		ArtistAlbumDisplayStyle: "showcase",
		LyricsDisplayStyle:      "classic",
		LyricsDragSeekEnabled:   false,
		TerminalShellTheme:      "dusk",
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.HomePlayerStyle != "running-kitten" || saved.MobileHomePlayerStyle != "smartisan-classic" || saved.ArtistAlbumDisplayStyle != "showcase" || saved.LyricsDisplayStyle != "classic" || saved.LyricsDragSeekEnabled || saved.TerminalShellTheme != "dusk" {
		t.Fatalf("expected saved user preferences to persist, got %#v", saved)
	}
	loaded, err := service.GetUserPreferences(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.HomePlayerStyle != "running-kitten" || loaded.MobileHomePlayerStyle != "smartisan-classic" || loaded.ArtistAlbumDisplayStyle != "showcase" || loaded.LyricsDisplayStyle != "classic" || loaded.LyricsDragSeekEnabled || loaded.TerminalShellTheme != "dusk" {
		t.Fatalf("expected user preferences to load from database, got %#v", loaded)
	}

	otherUser, err := service.GetUserPreferences(ctx, 8)
	if err != nil {
		t.Fatal(err)
	}
	if otherUser.HomePlayerStyle != "vinyl" || otherUser.MobileHomePlayerStyle != "neon-console" || otherUser.ArtistAlbumDisplayStyle != "classic" || otherUser.LyricsDisplayStyle != "immersive" || !otherUser.LyricsDragSeekEnabled || otherUser.TerminalShellTheme != "operator" {
		t.Fatalf("expected user preferences to be scoped per user, got %#v", otherUser)
	}

	if err := service.setSetting(ctx, userPreferencesKey(9), `{"home_player_style":"cassette","mobile_home_player_style":"soft-vinyl","artist_album_display_style":"showcase"}`); err != nil {
		t.Fatal(err)
	}
	legacy, err := service.GetUserPreferences(ctx, 9)
	if err != nil {
		t.Fatal(err)
	}
	if legacy.HomePlayerStyle != "cassette" || legacy.MobileHomePlayerStyle != "soft-vinyl" || legacy.ArtistAlbumDisplayStyle != "showcase" || legacy.LyricsDisplayStyle != "immersive" || !legacy.LyricsDragSeekEnabled || legacy.TerminalShellTheme != "operator" {
		t.Fatalf("expected legacy user preferences to keep lyrics display default and drag seek enabled, got %#v", legacy)
	}

	normalized, err := service.SaveUserPreferences(ctx, 7, models.UserPreferences{
		HomePlayerStyle:         "bad-value",
		MobileHomePlayerStyle:   "bad-value",
		ArtistAlbumDisplayStyle: "bad-value",
		TerminalShellTheme:      "bad-value",
	})
	if err != nil {
		t.Fatal(err)
	}
	if normalized.HomePlayerStyle != "vinyl" || normalized.MobileHomePlayerStyle != "neon-console" || normalized.ArtistAlbumDisplayStyle != "classic" || normalized.LyricsDisplayStyle != "immersive" || normalized.LyricsDragSeekEnabled || normalized.TerminalShellTheme != "operator" {
		t.Fatalf("expected invalid user preferences to normalize, got %#v", normalized)
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
	song, err := client.Song.Create().
		SetTitle("Song").
		SetPath("/music/song.flac").
		SetFileName("song.flac").
		SetArtist(artist).
		SetAlbum(album).
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
	if _, err := service.SavePlaybackQueue(ctx, 7, []int{song.ID}, song.ID); err != nil {
		t.Fatal(err)
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
	queue, err := service.PlaybackQueue(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if queue == nil || queue.Source == nil || queue.Source.SourceID != artist.ID || !slices.Equal(queue.SongIDs, []int{song.ID}) || queue.CurrentID != song.ID {
		t.Fatalf("expected source save to preserve playback queue session, got %+v", queue)
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

	key, err := service.playbackSourceKey(ctx, 9)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.cacheSetJSONWithTTL(ctx, key, models.PlaybackSource{Type: "folder", SourceID: 1}, time.Hour); err != nil {
		t.Fatal(err)
	}
	loaded, err := service.PlaybackSource(ctx, 9)
	if err != nil {
		t.Fatal(err)
	}
	if loaded != nil {
		t.Fatalf("expected invalid playback source to be ignored, got %+v", loaded)
	}
	if _, ok, err := store.Get(ctx, key); err != nil || ok {
		t.Fatalf("expected invalid playback source KV to be deleted, ok=%v err=%v", ok, err)
	}
}

func TestPlaybackSourceMigratesLegacyKVIntoQueueSession(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	store := kv.NewMemoryStore()
	defer store.Close()
	service := &Service{client: client, cache: store}

	userItem, err := client.User.Create().SetUsername("legacy-source-user").SetPasswordHash("hash").Save(ctx)
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
	songItem, err := client.Song.Create().SetTitle("Song").SetPath("/music/song.flac").SetFileName("song.flac").SetArtist(artistItem).SetAlbum(albumItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	key, err := service.playbackSourceKey(ctx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.cacheSetJSONWithTTL(ctx, key, models.PlaybackSource{Type: "album", SourceID: albumItem.ID, UpdatedAt: time.Now().Add(-time.Hour)}, time.Hour); err != nil {
		t.Fatal(err)
	}

	queue, err := service.PlaybackQueue(ctx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if queue == nil || queue.Source == nil || queue.Source.Type != "album" || queue.Source.SourceID != albumItem.ID {
		t.Fatalf("expected legacy source to migrate into queue session, got %+v", queue)
	}
	if _, ok, err := store.Get(ctx, key); err != nil || ok {
		t.Fatalf("expected legacy playback source key to be deleted after migration, ok=%v err=%v", ok, err)
	}

	if _, err := service.SavePlaybackQueue(ctx, userItem.ID, []int{songItem.ID}, songItem.ID); err != nil {
		t.Fatal(err)
	}
	queue, err = service.PlaybackQueue(ctx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if queue == nil || queue.Source == nil || queue.Source.SourceID != albumItem.ID || !slices.Equal(queue.SongIDs, []int{songItem.ID}) {
		t.Fatalf("expected queue and source to share one session, got %+v", queue)
	}
}

func TestPlaybackHistoryRetentionDeletesOldEntries(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	userItem, err := client.User.Create().SetUsername("history-retention-user").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	otherUser, err := client.User.Create().SetUsername("other-history-user").SetPasswordHash("hash").Save(ctx)
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
	oldSong, err := client.Song.Create().SetTitle("Old").SetPath("/music/old.flac").SetFileName("old.flac").SetArtist(artistItem).SetAlbum(albumItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	newSong, err := client.Song.Create().SetTitle("New").SetPath("/music/new.flac").SetFileName("new.flac").SetArtist(artistItem).SetAlbum(albumItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().AddDate(0, 0, -3)
	if _, err := client.PlayHistory.Create().SetUserID(userItem.ID).SetSongID(oldSong.ID).SetPlayedAt(oldTime).SetUpdatedAt(oldTime).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PlayHistory.Create().SetUserID(otherUser.ID).SetSongID(oldSong.ID).SetPlayedAt(oldTime).SetUpdatedAt(oldTime).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveSettings(ctx, models.Settings{
		Language:                     "zh-CN",
		Theme:                        "deep-space",
		NeteaseFallback:              true,
		PlaybackSourceTTLHours:       24,
		PlaybackHistoryRetentionDays: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := service.MarkPlayed(ctx, userItem.ID, newSong.ID); err != nil {
		t.Fatal(err)
	}

	userCount, err := client.PlayHistory.Query().Where(playhistory.HasUserWith(user.ID(userItem.ID))).Count(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if userCount != 1 {
		t.Fatalf("expected only recent user history to remain, got %d", userCount)
	}
	otherCount, err := client.PlayHistory.Query().Where(playhistory.HasUserWith(user.ID(otherUser.ID))).Count(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if otherCount != 1 {
		t.Fatalf("expected other user's history to be untouched, got %d", otherCount)
	}
}

func TestPlaybackHistoryCanSeparateDeviceState(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	store := kv.NewMemoryStore()
	defer store.Close()
	service := &Service{client: client, cache: store}

	userItem, err := client.User.Create().SetUsername("history-user").SetPasswordHash("hash").Save(ctx)
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
	if _, err := service.SavePlaybackHistorySettings(ctx, userItem.ID, models.PlaybackHistorySettings{SeparateByDevice: true}); err != nil {
		t.Fatal(err)
	}

	pcCtx := WithPlaybackDeviceType(ctx, "pc")
	mobileCtx := WithPlaybackDeviceType(ctx, "mobile")
	if err := service.SavePlaybackProgress(pcCtx, userItem.ID, songItem.ID, 20, 120, false); err != nil {
		t.Fatal(err)
	}
	if err := service.SavePlaybackProgress(mobileCtx, userItem.ID, songItem.ID, 70, 120, false); err != nil {
		t.Fatal(err)
	}
	pcSong, err := service.Song(pcCtx, userItem.ID, songItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	mobileSong, err := service.Song(mobileCtx, userItem.ID, songItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pcSong.ResumePosition != 20 || mobileSong.ResumePosition != 70 {
		t.Fatalf("expected device-specific resume positions, got pc=%f mobile=%f", pcSong.ResumePosition, mobileSong.ResumePosition)
	}

	if _, err := service.SavePlaybackSource(pcCtx, userItem.ID, "album", albumItem.ID); err != nil {
		t.Fatal(err)
	}
	if source, err := service.PlaybackSource(mobileCtx, userItem.ID); err != nil {
		t.Fatal(err)
	} else if source != nil {
		t.Fatalf("expected mobile source to start isolated, got %+v", source)
	}
	if _, err := service.SavePlaybackSource(mobileCtx, userItem.ID, "artist", artistItem.ID); err != nil {
		t.Fatal(err)
	}
	pcSource, err := service.PlaybackSource(pcCtx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	mobileSource, err := service.PlaybackSource(mobileCtx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pcSource == nil || pcSource.Type != "album" || pcSource.SourceID != albumItem.ID {
		t.Fatalf("expected pc album playback source, got %+v", pcSource)
	}
	if mobileSource == nil || mobileSource.Type != "artist" || mobileSource.SourceID != artistItem.ID {
		t.Fatalf("expected mobile artist playback source, got %+v", mobileSource)
	}
}

func TestPlaybackSourceAcceptsOwnedPlaylist(t *testing.T) {
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
	other, err := client.User.Create().SetUsername("playlist-other").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	playlistItem, err := client.Playlist.Create().SetName("Road Queue").SetOwnerID(owner.ID).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	saved, err := service.SavePlaybackSource(ctx, owner.ID, "playlist", playlistItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Type != "playlist" || saved.SourceID != playlistItem.ID {
		t.Fatalf("unexpected playlist playback source: %+v", saved)
	}
	loaded, err := service.PlaybackSource(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.Type != "playlist" || loaded.SourceID != playlistItem.ID {
		t.Fatalf("expected playlist playback source to load, got %+v", loaded)
	}
	if _, err := service.SavePlaybackSource(ctx, other.ID, "playlist", playlistItem.ID); err == nil {
		t.Fatal("expected playlist playback source to require ownership")
	}
}

func TestPlaybackQueueUsesSharedAndDeviceScopedKV(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	store := kv.NewMemoryStore()
	defer store.Close()
	service := &Service{client: client, cache: store}

	userItem, err := client.User.Create().SetUsername("queue-user").SetPasswordHash("hash").Save(ctx)
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
	songA, err := client.Song.Create().SetTitle("A").SetPath("/music/a.flac").SetFileName("a.flac").SetArtist(artistItem).SetAlbum(albumItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	songB, err := client.Song.Create().SetTitle("B").SetPath("/music/b.flac").SetFileName("b.flac").SetArtist(artistItem).SetAlbum(albumItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	songC, err := client.Song.Create().SetTitle("C").SetPath("/music/c.flac").SetFileName("c.flac").SetArtist(artistItem).SetAlbum(albumItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	pcCtx := WithPlaybackDeviceType(ctx, "pc")
	mobileCtx := WithPlaybackDeviceType(ctx, "mobile")
	if _, err := service.SavePlaybackQueue(pcCtx, userItem.ID, []int{songA.ID, songB.ID, songA.ID, 9999}, songB.ID); err != nil {
		t.Fatal(err)
	}
	shared, err := service.PlaybackQueue(mobileCtx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if shared == nil || !slices.Equal(shared.SongIDs, []int{songA.ID, songB.ID}) || shared.CurrentID != songB.ID {
		t.Fatalf("expected queue to be shared before device separation, got %+v", shared)
	}
	radioStation := models.RadioStation{
		ID:        "station-a",
		Name:      "Station A",
		URL:       "https://example.com/station-a.mp3",
		StreamURL: "https://example.com/station-a.mp3",
	}
	if _, err := service.SavePlaybackQueueSession(pcCtx, userItem.ID, nil, 0, nil, true, &models.PlaybackRadio{
		Current: radioStation,
		Queue: []models.RadioStation{
			radioStation,
			{
				ID:        "station-b",
				Name:      "Station B",
				URL:       "https://example.com/station-b.mp3",
				StreamURL: "https://example.com/station-b.mp3",
			},
			{
				ID:   "broken",
				Name: "Broken",
			},
		},
	}, true); err != nil {
		t.Fatal(err)
	}
	sharedRadio, err := service.PlaybackQueue(mobileCtx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sharedRadio == nil || sharedRadio.Radio == nil || sharedRadio.Radio.Current.ID != "station-a" || len(sharedRadio.Radio.Queue) != 2 || len(sharedRadio.SongIDs) != 0 || sharedRadio.Source != nil {
		t.Fatalf("expected radio queue to be shared and normalized before device separation, got %+v", sharedRadio)
	}

	if _, err := service.SavePlaybackHistorySettings(ctx, userItem.ID, models.PlaybackHistorySettings{SeparateByDevice: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SavePlaybackQueue(pcCtx, userItem.ID, []int{songA.ID}, songA.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SavePlaybackQueue(mobileCtx, userItem.ID, []int{songB.ID}, songC.ID); err != nil {
		t.Fatal(err)
	}
	pcQueue, err := service.PlaybackQueue(pcCtx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	mobileQueue, err := service.PlaybackQueue(mobileCtx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pcQueue == nil || !slices.Equal(pcQueue.SongIDs, []int{songA.ID}) || pcQueue.CurrentID != songA.ID {
		t.Fatalf("expected pc queue to stay isolated, got %+v", pcQueue)
	}
	if mobileQueue == nil || !slices.Equal(mobileQueue.SongIDs, []int{songC.ID, songB.ID}) || mobileQueue.CurrentID != songC.ID {
		t.Fatalf("expected mobile queue to prepend current song and stay isolated, got %+v", mobileQueue)
	}
	if _, err := service.SavePlaybackQueueSession(pcCtx, userItem.ID, nil, 0, nil, true, &models.PlaybackRadio{Current: radioStation}, true); err != nil {
		t.Fatal(err)
	}
	pcRadioQueue, err := service.PlaybackQueue(pcCtx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	mobileSongQueue, err := service.PlaybackQueue(mobileCtx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pcRadioQueue == nil || pcRadioQueue.Radio == nil || pcRadioQueue.Radio.Current.ID != "station-a" || len(pcRadioQueue.SongIDs) != 0 {
		t.Fatalf("expected pc radio queue to replace pc song queue, got %+v", pcRadioQueue)
	}
	if mobileSongQueue == nil || mobileSongQueue.Radio != nil || mobileSongQueue.CurrentID != songC.ID {
		t.Fatalf("expected mobile song queue to survive pc radio save, got %+v", mobileSongQueue)
	}
	if err := service.ClearPlaybackQueue(pcCtx, userItem.ID); err != nil {
		t.Fatal(err)
	}
	if cleared, err := service.PlaybackQueue(pcCtx, userItem.ID); err != nil {
		t.Fatal(err)
	} else if cleared != nil {
		t.Fatalf("expected pc queue to be cleared, got %+v", cleared)
	}
	if stillMobile, err := service.PlaybackQueue(mobileCtx, userItem.ID); err != nil {
		t.Fatal(err)
	} else if stillMobile == nil || stillMobile.CurrentID != songC.ID {
		t.Fatalf("expected mobile queue to survive pc clear, got %+v", stillMobile)
	}
}
