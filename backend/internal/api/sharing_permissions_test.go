package api

import (
	"bytes"
	"encoding/json/v2"
	"errors"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/enttest"
	"lark/backend/internal/library"
	"lark/backend/internal/models"

	_ "github.com/lib-x/entsqlite"
)

type sharingFixture struct {
	server     *Server
	client     *ent.Client
	service    *library.Service
	admin      *http.Cookie
	adminID    int
	member     *http.Cookie
	memberID   int
	songIDs    []int
	albumID    int
	artistID   int
	playlistID int
	root       string
}

func newSharingFixture(t *testing.T) sharingFixture {
	t.Helper()
	ctx := t.Context()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	t.Cleanup(func() { _ = client.Close() })
	root := t.TempDir()
	var cover bytes.Buffer
	if err := png.Encode(&cover, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "cover.png"), cover.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	service := library.New(client, t.TempDir(), root, "", "", nil, nil)
	admin, adminToken, err := service.SetupAdmin(ctx, "admin", "test-password")
	if err != nil {
		t.Fatal(err)
	}
	settings, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	settings.SharingEnabled = true
	settings.RegistrationEnabled = true
	if _, err := service.SaveSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	member, memberToken, err := service.Register(ctx, "listener", "test-password")
	if err != nil {
		t.Fatal(err)
	}
	artistItem := client.Artist.Create().SetName("Shared artist").SaveX(ctx)
	albumItem := client.Album.Create().SetTitle("Shared album").SetArtist(artistItem).SaveX(ctx)
	songIDs := make([]int, 0, 3)
	for index := range 3 {
		path := filepath.Join(root, fmt.Sprintf("private-track-%d.mp3", index))
		if err := os.WriteFile(path, []byte("ID3-shared-audio-fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
		item := client.Song.Create().SetTitle(fmt.Sprintf("Track %d", index)).SetPath(path).
			SetFileName(filepath.Base(path)).SetFormat("mp3").SetMime("audio/mpeg").
			SetSizeBytes(24).SetDurationSeconds(60).SetArtist(artistItem).SetAlbum(albumItem).
			SetSourceData("private-provider-credential").SetDedupKey("private-provider-key").SaveX(ctx)
		songIDs = append(songIDs, item.ID)
	}
	playlistItem := client.Playlist.Create().SetName("Shared playlist").SetOwnerID(member.ID).
		AddSongIDs(songIDs[0], songIDs[2]).SaveX(ctx)
	return sharingFixture{
		server: New(client, service, "*"), client: client, service: service,
		admin: &http.Cookie{Name: sessionCookieName, Value: adminToken}, adminID: admin.ID,
		member: &http.Cookie{Name: sessionCookieName, Value: memberToken}, memberID: member.ID,
		songIDs: songIDs, albumID: albumItem.ID, artistID: artistItem.ID, playlistID: playlistItem.ID, root: root,
	}
}

func performShareRequest(server *Server, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	server.echo.ServeHTTP(response, request)
	return response
}

func createTestShare(t *testing.T, fixture sharingFixture, body string) models.Share {
	t.Helper()
	response := performShareRequest(fixture.server, http.MethodPost, "/api/shares", body, fixture.member)
	if response.Code != http.StatusCreated {
		t.Fatalf("create share status=%d body=%s", response.Code, response.Body.String())
	}
	var share models.Share
	if err := json.Unmarshal(response.Body.Bytes(), &share); err != nil {
		t.Fatal(err)
	}
	return share
}

func TestPublicSelectionSharingPreservesOrderAndRestrictsAnonymousAccess(t *testing.T) {
	fixture := newSharingFixture(t)
	share := createTestShare(t, fixture, fmt.Sprintf(`{"type":"songs","song_ids":[%d,%d,%d]}`, fixture.songIDs[2], fixture.songIDs[0], fixture.songIDs[2]))
	response := performShareRequest(fixture.server, http.MethodGet, "/api/public/shares/"+share.Token, "", nil)
	if response.Code != http.StatusOK {
		t.Fatalf("public selection status=%d body=%s", response.Code, response.Body.String())
	}
	var public models.PublicShare
	if err := json.Unmarshal(response.Body.Bytes(), &public); err != nil {
		t.Fatal(err)
	}
	actual := make([]int, 0, len(public.Songs))
	for _, item := range public.Songs {
		actual = append(actual, item.ID)
	}
	if !slices.Equal(actual, []int{fixture.songIDs[2], fixture.songIDs[0]}) {
		t.Fatalf("selection order=%v", actual)
	}
	for _, marker := range []string{fixture.root, "private-provider-credential", "private-provider-key"} {
		if strings.Contains(response.Body.String(), marker) {
			t.Errorf("public response exposes private field %q", marker)
		}
	}
	for _, endpoint := range []string{"stream", "cover"} {
		path := fmt.Sprintf("/api/public/shares/%s/%s/%d", share.Token, endpoint, fixture.songIDs[1])
		if result := performShareRequest(fixture.server, http.MethodGet, path, "", nil); result.Code != http.StatusNotFound {
			t.Errorf("unshared %s status=%d body=%s", endpoint, result.Code, result.Body.String())
		}
	}
	path := fmt.Sprintf("/api/public/shares/%s/stream/%d?mode=raw", share.Token, fixture.songIDs[2])
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Header.Set("Range", "bytes=0-3")
	ranged := httptest.NewRecorder()
	fixture.server.echo.ServeHTTP(ranged, request)
	if ranged.Code != http.StatusPartialContent || ranged.Body.String() != "ID3-" || ranged.Header().Get("Content-Range") == "" {
		t.Fatalf("anonymous range status=%d body=%q headers=%v", ranged.Code, ranged.Body.String(), ranged.Header())
	}
	for _, path := range []string{"/api/songs", fmt.Sprintf("/api/songs/%d/stream", fixture.songIDs[0])} {
		if result := performShareRequest(fixture.server, http.MethodGet, path, "", nil); result.Code != http.StatusUnauthorized {
			t.Errorf("unscoped anonymous path %s status=%d", path, result.Code)
		}
	}

	reloaded := library.New(fixture.client, t.TempDir(), fixture.root, "", "", nil, nil)
	persisted, err := reloaded.PublicShare(t.Context(), share.Token, "")
	if err != nil {
		t.Fatal(err)
	}
	persistedIDs := make([]int, 0, len(persisted.Songs))
	for _, item := range persisted.Songs {
		persistedIDs = append(persistedIDs, item.ID)
	}
	if !slices.Equal(persistedIDs, actual) {
		t.Errorf("selection after reload=%v want=%v", persistedIDs, actual)
	}
}

func TestPublicSharingLegacyTargetsPrivacyAndLifecycle(t *testing.T) {
	fixture := newSharingFixture(t)
	for _, target := range []struct {
		kind    string
		id      int
		songIDs []int
	}{
		{kind: "song", id: fixture.songIDs[0]},
		{kind: "album", id: fixture.albumID},
		{kind: "artist", id: fixture.artistID},
		{kind: "playlist", id: fixture.playlistID},
		{kind: "songs", songIDs: fixture.songIDs[:2]},
	} {
		t.Run(target.kind, func(t *testing.T) {
			body, err := json.Marshal(map[string]any{"type": target.kind, "id": target.id, "song_ids": target.songIDs})
			if err != nil {
				t.Fatal(err)
			}
			share := createTestShare(t, fixture, string(body))
			path := "/api/public/shares/" + share.Token
			response := performShareRequest(fixture.server, http.MethodGet, path, "", nil)
			if response.Code != http.StatusOK || strings.Contains(response.Body.String(), fixture.root) || strings.Contains(response.Body.String(), "private-provider-") {
				t.Errorf("legacy public response status=%d body=%s", response.Code, response.Body.String())
			}
			stream := performShareRequest(fixture.server, http.MethodGet, fmt.Sprintf("%s/stream/%d?mode=raw", path, fixture.songIDs[0]), "", nil)
			if stream.Code != http.StatusOK || stream.Body.String() != "ID3-shared-audio-fixture" {
				t.Errorf("anonymous stream status=%d body=%q", stream.Code, stream.Body.String())
			}
			cover := performShareRequest(fixture.server, http.MethodGet, fmt.Sprintf("%s/cover/%d", path, fixture.songIDs[0]), "", nil)
			if cover.Code != http.StatusOK || !strings.HasPrefix(cover.Header().Get("Content-Type"), "image/") {
				t.Errorf("anonymous cover status=%d headers=%v", cover.Code, cover.Header())
			}
			if response := performShareRequest(fixture.server, http.MethodPatch, "/api/shares/"+share.Token, `{"expires_at":null}`, fixture.admin); response.Code != http.StatusForbidden {
				t.Errorf("other user edit status=%d", response.Code)
			}
			if response := performShareRequest(fixture.server, http.MethodDelete, "/api/shares/"+share.Token, "", fixture.admin); response.Code != http.StatusForbidden {
				t.Errorf("other user revoke status=%d", response.Code)
			}
			if response := performShareRequest(fixture.server, http.MethodDelete, "/api/shares/"+share.Token, "", fixture.member); response.Code != http.StatusNoContent {
				t.Fatalf("owner revoke status=%d body=%s", response.Code, response.Body.String())
			}
			if response := performShareRequest(fixture.server, http.MethodGet, path, "", nil); response.Code != http.StatusNotFound {
				t.Errorf("revoked share status=%d", response.Code)
			}
		})
	}
	share := createTestShare(t, fixture, fmt.Sprintf(`{"type":"songs","song_ids":[%d]}`, fixture.songIDs[0]))
	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	updated := performShareRequest(fixture.server, http.MethodPatch, "/api/shares/"+share.Token, fmt.Sprintf(`{"expires_at":%q}`, past), fixture.member)
	if updated.Code != http.StatusOK {
		t.Fatalf("expire share status=%d body=%s", updated.Code, updated.Body.String())
	}
	if response := performShareRequest(fixture.server, http.MethodGet, "/api/public/shares/"+share.Token, "", nil); response.Code != http.StatusNotFound {
		t.Errorf("expired share status=%d", response.Code)
	}
	share = createTestShare(t, fixture, fmt.Sprintf(`{"type":"songs","song_ids":[%d]}`, fixture.songIDs[0]))
	settings, err := fixture.service.GetSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	settings.SharingEnabled = false
	if _, err := fixture.service.SaveSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	if response := performShareRequest(fixture.server, http.MethodGet, "/api/public/shares/"+share.Token, "", nil); response.Code != http.StatusForbidden {
		t.Errorf("disabled sharing status=%d", response.Code)
	}
	if response := performShareRequest(fixture.server, http.MethodPost, "/api/shares", fmt.Sprintf(`{"type":"songs","song_ids":[%d]}`, fixture.songIDs[0]), fixture.member); response.Code != http.StatusForbidden {
		t.Errorf("create disabled sharing status=%d", response.Code)
	}
}

func TestShareSelectionsRejectInvalidInputsWithoutPersisting(t *testing.T) {
	fixture := newSharingFixture(t)
	for _, body := range []string{
		`{"type":"songs","song_ids":[]}`,
		`{"type":"songs","song_ids":[0]}`,
		`{"type":"songs","song_ids":[-1]}`,
		`{"type":"song","id":1,"song_ids":[1]}`,
		`{"type":"songs","song_ids":[` + strings.Repeat("1,", 500) + `1]}`,
	} {
		response := performShareRequest(fixture.server, http.MethodPost, "/api/shares", body, fixture.member)
		if response.Code != http.StatusBadRequest {
			t.Errorf("invalid selection status=%d body=%s", response.Code, response.Body.String())
		}
	}
	missing := performShareRequest(fixture.server, http.MethodPost, "/api/shares", fmt.Sprintf(`{"type":"songs","song_ids":[%d,99999]}`, fixture.songIDs[0]), fixture.member)
	if missing.Code != http.StatusNotFound {
		t.Errorf("missing song status=%d body=%s", missing.Code, missing.Body.String())
	}
	shares, err := fixture.service.ListShares(t.Context(), fixture.memberID, "")
	if err != nil || len(shares.Shares) != 0 {
		t.Fatalf("invalid selections persisted: %#v err=%v", shares, err)
	}
}

func TestLibraryManagementRequiresAdminAtHTTPAndServiceBoundaries(t *testing.T) {
	fixture := newSharingFixture(t)
	for _, route := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/library/sources"},
		{http.MethodGet, "/api/library/directories"},
		{http.MethodPost, "/api/library/directories/check"},
		{http.MethodPost, "/api/library/directories"},
		{http.MethodPatch, "/api/library/directories/env"},
		{http.MethodDelete, "/api/library/directories/1"},
		{http.MethodPost, "/api/library/scan"},
		{http.MethodGet, "/api/library/scan/status"},
		{http.MethodPost, "/api/library/upload"},
	} {
		response := performShareRequest(fixture.server, route.method, route.path, `{}`, fixture.member)
		if response.Code != http.StatusForbidden {
			t.Errorf("member %s %s status=%d body=%s", route.method, route.path, response.Code, response.Body.String())
		}
	}
	if response := performShareRequest(fixture.server, http.MethodGet, "/api/library/directories", "", fixture.admin); response.Code != http.StatusOK {
		t.Fatalf("admin directories status=%d body=%s", response.Code, response.Body.String())
	}
	if _, err := fixture.service.AddLibraryDirectory(t.Context(), fixture.memberID, t.TempDir(), "blocked"); !errors.Is(err, library.ErrForbidden) {
		t.Errorf("member direct add error=%v", err)
	}
	if _, err := fixture.service.CheckLibraryDirectories(t.Context(), fixture.memberID); !errors.Is(err, library.ErrForbidden) {
		t.Errorf("member direct check error=%v", err)
	}
	if _, err := fixture.service.UpdateLibraryDirectory(t.Context(), fixture.memberID, "env", false); !errors.Is(err, library.ErrForbidden) {
		t.Errorf("member direct update error=%v", err)
	}
	directory := fixture.client.LibraryDirectory.Create().SetUserID(fixture.memberID).SetPath(t.TempDir()).SaveX(t.Context())
	if err := fixture.service.DeleteLibraryDirectory(t.Context(), fixture.memberID, directory.ID); !errors.Is(err, library.ErrForbidden) {
		t.Errorf("member direct delete error=%v", err)
	}
}

func TestMemberSettingsAndAnonymousHealthHideLibraryConfiguration(t *testing.T) {
	fixture := newSharingFixture(t)
	settings, err := fixture.service.GetSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	settings.LibraryTagWriteback = true
	settings.LibraryPathMetadataAssist = true
	settings.LyricsAutoSaveToSongDir = true
	if _, err := fixture.service.SaveSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	member := performShareRequest(fixture.server, http.MethodGet, "/api/settings", "", fixture.member)
	if member.Code != http.StatusOK {
		t.Fatalf("member settings status=%d body=%s", member.Code, member.Body.String())
	}
	var visible map[string]any
	if err := json.Unmarshal(member.Body.Bytes(), &visible); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"library_path", "library_tag_writeback", "library_path_metadata_assist", "lyrics_auto_save_to_song_dir", "metadata_grouping", "dlna_allowed_ips", "dlna_interfaces", "dlna_media_base_url"} {
		if _, exists := visible[key]; exists {
			t.Errorf("member settings expose %s", key)
		}
	}
	if visible["sharing_enabled"] != true || visible["language"] == nil || visible["transcode_policy"] == nil {
		t.Errorf("member playback settings missing: %#v", visible)
	}
	admin := performShareRequest(fixture.server, http.MethodGet, "/api/settings", "", fixture.admin)
	if admin.Code != http.StatusOK || !strings.Contains(admin.Body.String(), `"library_tag_writeback":true`) || !strings.Contains(admin.Body.String(), fixture.root) {
		t.Errorf("admin settings incomplete: status=%d body=%s", admin.Code, admin.Body.String())
	}
	if updated := performShareRequest(fixture.server, http.MethodPut, "/api/settings", `{}`, fixture.member); updated.Code != http.StatusForbidden {
		t.Errorf("member settings mutation status=%d", updated.Code)
	}
	health := performShareRequest(fixture.server, http.MethodGet, "/api/health", "", nil)
	if health.Code != http.StatusOK || strings.Contains(health.Body.String(), fixture.root) {
		t.Errorf("anonymous health leaks library root: status=%d body=%s", health.Code, health.Body.String())
	}
}

func TestSubsonicAndDirectScanRequireAdministrator(t *testing.T) {
	fixture := newSharingFixture(t)
	settings, err := fixture.service.GetSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	settings.SubsonicServerEnabled = true
	if _, err := fixture.service.SaveSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.SaveSubsonicCredential(t.Context(), fixture.memberID, "listener-subsonic", "test-password", ""); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []string{"startScan", "getScanStatus"} {
		response := performShareRequest(fixture.server, http.MethodGet, "/rest/"+endpoint+".view?u=listener-subsonic&p=test-password&f=json", "", nil)
		var envelope subsonicResponseEnvelope
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Response.Status != "failed" || envelope.Response.Error == nil || envelope.Response.Error.Code != 50 {
			t.Errorf("member Subsonic %s status=%d body=%s", endpoint, response.Code, response.Body.String())
		}
	}
	if _, err := fixture.service.Scan(t.Context(), fixture.memberID); !errors.Is(err, library.ErrForbidden) {
		t.Errorf("member direct scan error=%v", err)
	}
	if _, err := fixture.service.Scan(t.Context(), 0); !errors.Is(err, library.ErrUnauthenticated) {
		t.Errorf("anonymous direct scan error=%v", err)
	}
	if _, err := fixture.service.SaveSubsonicCredential(t.Context(), fixture.adminID, "admin-subsonic", "test-password", ""); err != nil {
		t.Fatal(err)
	}
	response := performShareRequest(fixture.server, http.MethodGet, "/rest/getScanStatus.view?u=admin-subsonic&p=test-password&f=json", "", nil)
	var envelope subsonicResponseEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Response.Status != "ok" || envelope.Response.ScanStatus == nil {
		t.Errorf("admin Subsonic scan status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAnonymousShareMediaFailuresHideInternalPaths(t *testing.T) {
	fixture := newSharingFixture(t)
	share := createTestShare(t, fixture, fmt.Sprintf(`{"type":"song","id":%d}`, fixture.songIDs[0]))
	service := library.New(fixture.client, t.TempDir(), fixture.root, "", "ffmpeg", nil, nil)
	server := New(fixture.client, service, "*")
	if err := os.Remove(filepath.Join(fixture.root, "private-track-0.mp3")); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []string{"cover", "stream"} {
		path := fmt.Sprintf("/api/public/shares/%s/%s/%d?mode=transcode&cache=true", share.Token, endpoint, fixture.songIDs[0])
		response := performShareRequest(server, http.MethodGet, path, "", nil)
		if response.Code != http.StatusInternalServerError {
			t.Errorf("missing %s status=%d body=%s", endpoint, response.Code, response.Body.String())
		}
		for _, marker := range []string{fixture.root, "private-track-0.mp3", "stat "} {
			if strings.Contains(response.Body.String(), marker) {
				t.Errorf("anonymous %s error exposes %q: %s", endpoint, marker, response.Body.String())
			}
		}
	}
	badMode := performShareRequest(server, http.MethodGet, fmt.Sprintf("/api/public/shares/%s/stream/%d?mode=invalid", share.Token, fixture.songIDs[0]), "", nil)
	if badMode.Code != http.StatusBadRequest {
		t.Errorf("invalid mode status=%d body=%s", badMode.Code, badMode.Body.String())
	}
	missingTool := library.New(fixture.client, t.TempDir(), fixture.root, "", filepath.Join(fixture.root, "private-ffmpeg-config"), nil, nil)
	toolServer := New(fixture.client, missingTool, "*")
	toolFailure := performShareRequest(toolServer, http.MethodGet, fmt.Sprintf("/api/public/shares/%s/stream/%d?mode=transcode", share.Token, fixture.songIDs[0]), "", nil)
	if toolFailure.Code != http.StatusUnsupportedMediaType || strings.Contains(toolFailure.Body.String(), fixture.root) || strings.Contains(toolFailure.Body.String(), "private-ffmpeg-config") {
		t.Errorf("anonymous transcoder error leaks configuration: status=%d body=%s", toolFailure.Code, toolFailure.Body.String())
	}
}
