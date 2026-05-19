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

func TestSettingsPersistLyricsAndTagWritebackOptions(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	saved, err := service.SaveSettings(ctx, models.Settings{
		Language:                "zh-CN",
		Theme:                   "deep-space",
		NeteaseFallback:         true,
		LyricsAutoSaveToSongDir: true,
		LyricsFontFamily:        `"LXGW WenKai"`,
		LyricsFontURL:           "/api/fonts/LXGW%20WenKai.woff2",
		LyricsFontSize:          99,
		LibraryTagWriteback:     true,
		PlaybackSourceTTLHours:  24,
		TranscodePolicy:         "auto",
		TranscodeQualityKbps:    192,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !saved.LyricsAutoSaveToSongDir || saved.LyricsFontFamily != "LXGW WenKai" || saved.LyricsFontURL != "/api/fonts/LXGW%20WenKai.woff2" || saved.LyricsFontSize != 72 || !saved.LibraryTagWriteback {
		t.Fatalf("unexpected saved lyrics/tag settings: %#v", saved)
	}
	loaded, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.LyricsAutoSaveToSongDir || loaded.LyricsFontFamily != "LXGW WenKai" || loaded.LyricsFontURL != "/api/fonts/LXGW%20WenKai.woff2" || loaded.LyricsFontSize != 72 || !loaded.LibraryTagWriteback {
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
	if settings.MetadataGrouping || settings.LibraryTagWriteback || settings.LyricsAutoSaveToSongDir || settings.LyricsFontFamily != "" || settings.LyricsFontURL != "" || settings.LyricsFontSize != 0 || settings.SmartPlaylistsEnabled || settings.SharingEnabled || settings.SubsonicServerEnabled {
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
