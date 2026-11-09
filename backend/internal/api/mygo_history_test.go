package api

import (
	"archive/zip"
	"bytes"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"lark/backend/internal/library"
	"lark/backend/internal/models"
	"lark/backend/internal/mygo"
	"lark/backend/internal/plugin"
	"lark/backend/internal/pluginapp"
)

func newMygoHistoryFixture(t *testing.T) (sharingFixture, *mygo.Service, *pluginapp.EntStore, []byte, string) {
	t.Helper()
	fixture := newSharingFixture(t)
	store := pluginapp.NewEntStore(fixture.client)
	directory := t.TempDir()
	service, err := mygo.New(t.Context(), store, directory)
	if err != nil {
		t.Fatal(err)
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, contents := range map[string]string{
		"plugin.json": `{"id":"history","name":"Original source","permissions":{}}`,
		"index.js":    `export function search(){return []}`,
	} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(contents)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	archive := buffer.Bytes()
	preview, err := service.Preview(t.Context(), archive, "https://github.com/example/original")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Install(t.Context(), preview.Token); err != nil {
		t.Fatal(err)
	}
	if err := service.SetEnabled(t.Context(), "history", true); err != nil {
		t.Fatal(err)
	}
	manager := plugin.NewManager(plugin.NewEntRepository(fixture.client), t.TempDir(), t.TempDir())
	platform := pluginapp.New(store, plugin.Adapter{Manager: manager}, service)
	if err := platform.Set(t.Context(), pluginapp.State{MyGo: true}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = platform.Close(t.Context()) })
	fixture.server = New(fixture.client, fixture.service, "*", WithPluginPlatform(platform, service, mygo.NewCatalog(http.DefaultClient)))
	return fixture, service, store, archive, directory
}

func apiHistorySong(t *testing.T, service *mygo.Service) jsontext.Value {
	t.Helper()
	metadata, err := json.Marshal(map[string]any{
		"plugin": "history", "identity": service.List()[0].Identity, "track": "remote-1",
		"sourceName": "Original source", "image": "https://example.com/cover.jpg", "album": "Remote album",
		"artists": jsontext.Value(`[{"id":"remote-artist","name":"Remote artist"}]`),
		"precise": jsontext.Value(`900719925474099312345`),
	})
	if err != nil {
		t.Fatal(err)
	}
	song, err := json.Marshal(models.Song{ID: -15, Title: "Remote song", Artist: "Remote artist", Album: "Remote album", Format: "mygo", DurationSeconds: 120, MyGo: metadata})
	if err != nil {
		t.Fatal(err)
	}
	return song
}

func historyRequest(t *testing.T, fixture sharingFixture, method, path, body, device string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Lark-Device-Type", device)
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	fixture.server.echo.ServeHTTP(response, request)
	return response
}

func apiHistoryEntries(t *testing.T, fixture sharingFixture, device string, cookie *http.Cookie) []models.PlaybackHistoryEntry {
	t.Helper()
	response := historyRequest(t, fixture, http.MethodGet, "/api/playback/history", "", device, cookie)
	var entries []models.PlaybackHistoryEntry
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &entries) != nil {
		t.Fatalf("history response: %d %s", response.Code, response.Body.String())
	}
	return entries
}

func TestMygoHistoryAPIMergesLocalAndIsolatesUsersDevices(t *testing.T) {
	fixture, service, _, _, _ := newMygoHistoryFixture(t)
	if err := fixture.service.MarkPlayed(t.Context(), fixture.memberID, fixture.songIDs[0]); err != nil {
		t.Fatal(err)
	}
	song := apiHistorySong(t, service)
	start := fmt.Sprintf(`{"song":%s,"duration_seconds":120}`, song)
	response := historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", start, "pc", fixture.member)
	if response.Code != http.StatusNoContent {
		t.Fatal(response.Code, response.Body.String())
	}
	entries := apiHistoryEntries(t, fixture, "pc", fixture.member)
	if len(entries) != 2 || entries[0].Song.ID != -15 || entries[1].Song.ID != fixture.songIDs[0] || entries[0].ID >= 0 {
		t.Fatalf("history did not merge chronologically: %+v", entries)
	}
	playedAt := entries[0].PlayedAt
	progress := fmt.Sprintf(`{"song":%s,"progress_seconds":32,"duration_seconds":120,"completed":false}`, song)
	response = historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", progress, "pc", fixture.member)
	if response.Code != http.StatusNoContent {
		t.Fatal(response.Body.String())
	}
	entries = apiHistoryEntries(t, fixture, "pc", fixture.member)
	if len(entries) != 2 || !entries[0].PlayedAt.Equal(playedAt) || entries[0].ProgressSeconds != 32 || entries[0].Song.ResumePosition != 32 {
		t.Fatalf("progress created or reset a play: %+v", entries)
	}
	if len(apiHistoryEntries(t, fixture, "pc", fixture.admin)) != 0 {
		t.Fatal("source history leaked to another user")
	}
	response = historyRequest(t, fixture, http.MethodGet, "/api/playback/history?limit=1", "", "pc", fixture.member)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "900719925474099312345") || !strings.Contains(response.Body.String(), "Original source") || !strings.Contains(response.Body.String(), "remote-artist") {
		t.Fatal("snapshot lost metadata or numeric precision", response.Body.String())
	}
	var limited []models.PlaybackHistoryEntry
	if err := json.Unmarshal(response.Body.Bytes(), &limited); err != nil || len(limited) != 1 || limited[0].Song.ID != -15 {
		t.Fatalf("history limit was not applied after merge: %+v %v", limited, err)
	}
	response = historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", start, "pc", fixture.member)
	if response.Code != http.StatusNoContent || len(apiHistoryEntries(t, fixture, "pc", fixture.member)) != 3 {
		t.Fatal("repeat play was not retained", response.Body.String())
	}
	response = historyRequest(t, fixture, http.MethodGet, "/api/songs/recent-played?limit=2", "", "pc", fixture.member)
	var recent []models.Song
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &recent) != nil || len(recent) != 2 || recent[0].ID != -15 || recent[1].ID != fixture.songIDs[0] {
		t.Fatal("recent songs did not merge and deduplicate", response.Body.String())
	}
	response = historyRequest(t, fixture, http.MethodGet, "/api/songs/recent-played?limit=1", "", "pc", fixture.member)
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &recent) != nil || len(recent) != 1 || recent[0].ID != -15 {
		t.Fatal("recent songs limit not applied after merge", response.Body.String())
	}
	if _, err := fixture.service.SavePlaybackHistorySettings(t.Context(), fixture.memberID, models.PlaybackHistorySettings{SeparateByDevice: true}); err != nil {
		t.Fatal(err)
	}
	if len(apiHistoryEntries(t, fixture, "mobile", fixture.member)) != 0 {
		t.Fatal("pc history leaked to mobile")
	}
	response = historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", progress, "mobile", fixture.member)
	if response.Code != http.StatusNoContent || len(apiHistoryEntries(t, fixture, "mobile", fixture.member)) != 1 || len(apiHistoryEntries(t, fixture, "pc", fixture.member)) != 3 {
		t.Fatal("device-specific progress did not remain isolated", response.Body.String())
	}
	response = historyRequest(t, fixture, http.MethodGet, "/api/songs/recent-played", "", "mobile", fixture.member)
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &recent) != nil || len(recent) != 1 || recent[0].ID != -15 {
		t.Fatal("mobile recent leaked pc or local history", response.Body.String())
	}
	if count := fixture.client.Song.Query().CountX(t.Context()); count != len(fixture.songIDs) {
		t.Fatalf("source history changed local song inventory: %d", count)
	}
	if count := fixture.client.PlayHistory.Query().CountX(t.Context()); count != 1 {
		t.Fatalf("source history wrote local foreign keys: %d", count)
	}
	if err := fixture.service.MarkPlayed(t.Context(), fixture.memberID, fixture.songIDs[1]); err != nil {
		t.Fatal(err)
	}
	response = historyRequest(t, fixture, http.MethodGet, "/api/songs/recent-played?limit=1", "", "pc", fixture.member)
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &recent) != nil || len(recent) != 1 || recent[0].ID != fixture.songIDs[1] {
		t.Fatal("new local play did not outrank source history", response.Body.String())
	}
}

func TestMygoHistoryAPIRejectsBadInputAndStaleSources(t *testing.T) {
	fixture, service, _, archive, _ := newMygoHistoryFixture(t)
	song := apiHistorySong(t, service)
	valid := fmt.Sprintf(`{"song":%s}`, song)
	response := historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", valid, "pc", nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatal("history is not authenticated", response.Code)
	}
	for _, body := range []string{
		`{`, `{}`, `{"song":null}`, `{"song":[],"progress_seconds":1}`, valid + `{}`,
		fmt.Sprintf(`{"song":%s,"progress_seconds":-1}`, song), fmt.Sprintf(`{"song":%s,"progress_seconds":"bad"}`, song),
		fmt.Sprintf(`{"song":%s,"extra":true}`, song), strings.Replace(valid, `"id":-15`, `"id":15`, 1),
		strings.Replace(valid, `"track":"remote-1"`, `"track":""`, 1),
		strings.Replace(valid, service.List()[0].Identity, "different-source", 1), strings.Repeat(" ", mygo.MaxHistoryRequestBytes+1),
	} {
		response = historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", body, "pc", fixture.member)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("bad history accepted: code=%d body=%s", response.Code, response.Body.String())
		}
	}
	if len(apiHistoryEntries(t, fixture, "pc", fixture.member)) != 0 {
		t.Fatal("bad requests wrote history")
	}
	response = historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", valid, "pc", fixture.member)
	if response.Code != http.StatusNoContent {
		t.Fatal(response.Body.String())
	}
	if err := service.SetEnabled(t.Context(), "history", false); err != nil {
		t.Fatal(err)
	}
	response = historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", valid, "pc", fixture.member)
	if response.Code != http.StatusServiceUnavailable || len(apiHistoryEntries(t, fixture, "pc", fixture.member)) != 1 {
		t.Fatal("disabled source lost history or accepted a write", response.Code, response.Body.String())
	}
	if err := service.Delete(t.Context(), "history"); err != nil {
		t.Fatal(err)
	}
	if len(apiHistoryEntries(t, fixture, "pc", fixture.member)) != 1 {
		t.Fatal("uninstall removed source history")
	}
	preview, err := service.Preview(t.Context(), archive, "https://github.com/example/replacement")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Install(t.Context(), preview.Token); err != nil {
		t.Fatal(err)
	}
	if err := service.SetEnabled(t.Context(), "history", true); err != nil {
		t.Fatal(err)
	}
	response = historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", valid, "pc", fixture.member)
	if response.Code != http.StatusBadRequest {
		t.Fatal("replacement accepted stale identity", response.Code, response.Body.String())
	}
	replacement := apiHistorySong(t, service)
	response = historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", fmt.Sprintf(`{"song":%s,"progress_seconds":70}`, replacement), "pc", fixture.member)
	if response.Code != http.StatusNoContent {
		t.Fatal(response.Body.String())
	}
	entries := apiHistoryEntries(t, fixture, "pc", fixture.member)
	if len(entries) != 2 || entries[0].ProgressSeconds != 70 || entries[1].ProgressSeconds != 0 {
		t.Fatalf("replacement polluted original history: %+v", entries)
	}
	response = historyRequest(t, fixture, http.MethodGet, "/api/songs/recent-played", "", "pc", fixture.member)
	var recent []models.Song
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &recent) != nil || len(recent) != 2 {
		t.Fatal("recent dedup rebound distinct identities sharing a song id", response.Body.String())
	}
}

func TestMygoHistoryAPIRestartAndRetention(t *testing.T) {
	fixture, service, store, _, directory := newMygoHistoryFixture(t)
	song := apiHistorySong(t, service)
	body := fmt.Sprintf(`{"song":%s,"progress_seconds":25}`, song)
	for _, cookie := range []*http.Cookie{fixture.member, fixture.admin} {
		response := historyRequest(t, fixture, http.MethodPost, "/api/mygo/history", body, "pc", cookie)
		if response.Code != http.StatusNoContent {
			t.Fatal(response.Body.String())
		}
	}
	restarted, err := mygo.New(t.Context(), store, directory)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = restarted.Close(t.Context()) })
	fixture.service = library.New(fixture.client, t.TempDir(), fixture.root, "", "", nil, nil)
	platform := pluginapp.New(store, nil, restarted)
	fixture.server = New(fixture.client, fixture.service, "*", WithPluginPlatform(platform, restarted, mygo.NewCatalog(http.DefaultClient)))
	entries := apiHistoryEntries(t, fixture, "pc", fixture.member)
	if len(entries) != 1 || entries[0].ProgressSeconds != 25 || entries[0].Song.ID != -15 {
		t.Fatalf("restart lost persisted source history: %+v", entries)
	}
	settings, err := fixture.service.GetSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	settings.PlaybackHistoryRetentionDays = 1
	if _, err := fixture.service.SaveSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	key := fmt.Sprintf("mygo-history-v1:%d", fixture.memberID)
	contents, err := store.Get(t.Context(), key)
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]jsontext.Value
	var records []map[string]jsontext.Value
	if err := json.Unmarshal(contents, &state); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(state["entries"], &records); err != nil {
		t.Fatal(err)
	}
	stamp, _ := json.Marshal(time.Now().AddDate(0, 0, -3))
	records[0]["updated_at"] = stamp
	state["entries"], _ = json.Marshal(records)
	contents, _ = json.Marshal(state)
	if err := store.Put(t.Context(), key, contents); err != nil {
		t.Fatal(err)
	}
	if len(apiHistoryEntries(t, fixture, "pc", fixture.member)) != 0 || len(apiHistoryEntries(t, fixture, "pc", fixture.admin)) != 1 {
		t.Fatal("retention did not prune by user")
	}
	response := historyRequest(t, fixture, http.MethodGet, "/api/songs/recent-played", "", "pc", fixture.member)
	var recent []models.Song
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &recent) != nil || len(recent) != 0 {
		t.Fatal("expired source remains in recent songs", response.Body.String())
	}
}
