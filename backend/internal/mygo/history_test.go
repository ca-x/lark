package mygo

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"lark/backend/internal/models"
)

func historySong(t *testing.T, service *Service, track string) jsontext.Value {
	t.Helper()
	metadata, err := json.Marshal(map[string]any{
		"plugin": "demo", "identity": service.List()[0].Identity, "track": track,
		"image": "https://example.com/cover.jpg", "sourceName": "Original source", "album": "Album",
		"artists": jsontext.Value(`[{"id":"artist-1","name":"Artist"}]`), "precise": jsontext.Value(`900719925474099312345`),
	})
	if err != nil {
		t.Fatal(err)
	}
	contents, err := json.Marshal(models.Song{ID: -42, Title: "Source track", Format: "mygo", DurationSeconds: 120, MyGo: metadata})
	if err != nil {
		t.Fatal(err)
	}
	return contents
}

func loadHistory(t *testing.T, service *Service, user int, scope string) []models.PlaybackHistoryEntry {
	t.Helper()
	entries, err := service.PlaybackHistory(t.Context(), user, scope, 0)
	if err != nil {
		t.Fatal(err)
	}
	return entries
}

func TestHistoryUserDeviceIsolationAndProgress(t *testing.T) {
	service := installedService(t, `export function search(){return []}`)
	song := historySong(t, service, "one")
	start := HistoryUpdate{Song: song, DurationSeconds: new(120.0)}
	if err := service.SaveHistory(t.Context(), 1, "pc", "", 0, start); err != nil {
		t.Fatal(err)
	}
	first := loadHistory(t, service, 1, "")[0]
	if err := service.SaveHistory(t.Context(), 1, "mobile", "", 0, HistoryUpdate{Song: song, ProgressSeconds: new(30.0)}); err != nil {
		t.Fatal(err)
	}
	entries := loadHistory(t, service, 1, "")
	if len(entries) != 1 || entries[0].ID != first.ID || !entries[0].PlayedAt.Equal(first.PlayedAt) || entries[0].ProgressSeconds != 30 || entries[0].Song.ResumePosition != 30 || entries[0].DeviceType != "mobile" {
		t.Fatalf("shared progress did not update original history: %+v", entries)
	}
	if len(loadHistory(t, service, 2, "")) != 0 || len(loadHistory(t, service, 1, "pc")) != 0 {
		t.Fatal("history leaked across users or device scopes")
	}
	if err := service.SaveHistory(t.Context(), 1, "pc", "pc", 0, start); err != nil {
		t.Fatal(err)
	}
	if err := service.SaveHistory(t.Context(), 1, "pc", "pc", 0, HistoryUpdate{Song: song, ProgressSeconds: new(60.0)}); err != nil {
		t.Fatal(err)
	}
	pc := loadHistory(t, service, 1, "pc")
	mobile := loadHistory(t, service, 1, "mobile")
	if len(pc) != 1 || len(mobile) != 1 || pc[0].ProgressSeconds != 60 || mobile[0].ProgressSeconds != 30 || pc[0].Song.PlayCount != 1 {
		t.Fatalf("device progress isolation failed: pc=%+v mobile=%+v", pc, mobile)
	}
	if err := service.SaveHistory(t.Context(), 1, "pc", "pc", 0, start); err != nil {
		t.Fatal(err)
	}
	if entries := loadHistory(t, service, 1, "pc"); len(entries) != 2 || entries[0].Song.PlayCount != 2 || entries[0].ProgressSeconds != 0 {
		t.Fatalf("duration-only start did not create a fresh play: %+v", entries)
	}
	if err := service.SaveHistory(t.Context(), 1, "pc", "pc", 0, HistoryUpdate{Song: song, ProgressSeconds: new(125.0)}); err != nil {
		t.Fatal(err)
	}
	if entry := loadHistory(t, service, 1, "pc")[0]; entry.ProgressSeconds != 120 || !entry.Completed || entry.Song.ResumePosition != 0 {
		t.Fatalf("completion not clamped: %+v", entry)
	}
}

func TestHistorySurvivesRestartDisableRemovalAndReplacement(t *testing.T) {
	service := installedService(t, `export function search(){return []}`)
	song := historySong(t, service, "one")
	if err := service.SaveHistory(t.Context(), 1, "pc", "", 0, HistoryUpdate{Song: song, ProgressSeconds: new(10.0)}); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(t.Context(), service.store, service.dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = restarted.Close(t.Context()) })
	entries := loadHistory(t, restarted, 1, "")
	if len(entries) != 1 || entries[0].Song.ID != -42 || entries[0].ProgressSeconds != 10 {
		t.Fatalf("history not restored: %+v", entries)
	}
	encoded, err := json.Marshal(entries)
	if err != nil || !strings.Contains(string(encoded), "900719925474099312345") || !strings.Contains(string(encoded), "Original source") || !strings.Contains(string(encoded), "artist-1") || !strings.Contains(string(encoded), "cover.jpg") {
		t.Fatalf("source metadata changed: %s %v", encoded, err)
	}
	if err := service.Suspend(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := service.SaveHistory(t.Context(), 1, "pc", "", 0, HistoryUpdate{Song: song}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled platform accepted history: %v", err)
	}
	if len(loadHistory(t, service, 1, "")) != 1 {
		t.Fatal("platform disable removed history")
	}
	if err := service.Resume(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := service.SetEnabled(t.Context(), "demo", false); err != nil {
		t.Fatal(err)
	}
	if err := service.SaveHistory(t.Context(), 1, "pc", "", 0, HistoryUpdate{Song: song}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled source accepted history: %v", err)
	}
	if len(loadHistory(t, service, 1, "")) != 1 {
		t.Fatal("source disable removed history")
	}
	if err := service.Delete(t.Context(), "demo"); err != nil {
		t.Fatal(err)
	}
	if len(loadHistory(t, service, 1, "")) != 1 {
		t.Fatal("source removal removed history")
	}
	preview, err := service.Preview(t.Context(), testPackage(t, `export function search(){return ["replacement"]}`, nil), "replacement")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Install(t.Context(), preview.Token); err != nil {
		t.Fatal(err)
	}
	if err := service.SetEnabled(t.Context(), "demo", true); err != nil {
		t.Fatal(err)
	}
	if err := service.SaveHistory(t.Context(), 1, "pc", "", 0, HistoryUpdate{Song: song, ProgressSeconds: new(80.0)}); err == nil {
		t.Fatal("replacement source accepted stale history")
	}
	replacement := historySong(t, service, "one")
	if err := service.SaveHistory(t.Context(), 1, "pc", "", 0, HistoryUpdate{Song: replacement, ProgressSeconds: new(80.0)}); err != nil {
		t.Fatal(err)
	}
	entries = loadHistory(t, service, 1, "")
	if len(entries) != 2 || entries[0].ProgressSeconds != 80 || entries[1].ProgressSeconds != 10 || string(entries[0].Song.MyGo) == string(entries[1].Song.MyGo) {
		t.Fatalf("replacement polluted original history: %+v", entries)
	}
}

func TestHistoryRejectsBadInput(t *testing.T) {
	service := installedService(t, `export function search(){return []}`)
	valid := historySong(t, service, "one")
	for name, update := range map[string]HistoryUpdate{
		"missing": {}, "null": {Song: jsontext.Value(`null`)}, "array": {Song: jsontext.Value(`[]`)},
		"local":       {Song: jsontext.Value(strings.Replace(string(valid), `"id":-42`, `"id":42`, 1))},
		"no identity": {Song: jsontext.Value(`{"id":-1,"title":"Track","mygo":{"plugin":"demo","track":"one"}}`)},
		"blank track": {Song: jsontext.Value(strings.Replace(string(valid), `"track":"one"`, `"track":" "`, 1))},
		"negative":    {Song: valid, ProgressSeconds: new(-1.0)}, "nan": {Song: valid, ProgressSeconds: new(math.NaN())},
		"infinity": {Song: valid, DurationSeconds: new(math.Inf(1))}, "oversized": {Song: jsontext.Value(strings.Repeat(" ", maxHistorySongBytes+1))},
	} {
		t.Run(name, func(t *testing.T) {
			if err := service.SaveHistory(t.Context(), 1, "pc", "", 0, update); err == nil {
				t.Fatal("invalid history accepted")
			}
		})
	}
	if err := service.SaveHistory(t.Context(), 0, "pc", "", 0, HistoryUpdate{Song: valid}); err == nil {
		t.Fatal("unauthenticated history accepted")
	}
	if err := service.SaveHistory(t.Context(), 1, "invalid", "", 0, HistoryUpdate{Song: valid}); err == nil {
		t.Fatal("invalid device accepted")
	}
	if len(loadHistory(t, service, 1, "")) != 0 {
		t.Fatal("invalid writes changed history")
	}
}

func TestHistoryConcurrentWritesDoNotLoseEntries(t *testing.T) {
	service := installedService(t, `export function search(){return []}`)
	song := historySong(t, service, "one")
	var workers sync.WaitGroup
	for range 32 {
		workers.Go(func() {
			if err := service.SaveHistory(t.Context(), 1, "pc", "", 0, HistoryUpdate{Song: song}); err != nil {
				t.Error(err)
			}
		})
	}
	workers.Wait()
	entries := loadHistory(t, service, 1, "")
	if len(entries) != 32 {
		t.Fatalf("concurrent entries lost: %d", len(entries))
	}
	seen := map[int]bool{}
	for _, entry := range entries {
		if seen[entry.ID] || entry.Song.PlayCount != 32 {
			t.Fatalf("invalid concurrent entry: %+v", entry)
		}
		seen[entry.ID] = true
	}
}

func TestHistoryRetentionAndEntryLimit(t *testing.T) {
	service := installedService(t, `export function search(){return []}`)
	song := historySong(t, service, "one")
	var source historySource
	if err := json.Unmarshal(serviceMetadata(t, song), &source); err != nil {
		t.Fatal(err)
	}
	state := historyState{NextID: maxHistoryEntries + 5}
	for index := range maxHistoryEntries + 5 {
		stamp := time.Now().Add(-time.Duration(index) * time.Hour)
		state.Entries = append(state.Entries, historyRecord{ID: -index - 1, Song: song, Source: source, PlayedAt: stamp, UpdatedAt: stamp, DeviceType: "pc"})
	}
	encoded, _ := json.Marshal(state)
	if err := service.store.Put(t.Context(), historyKey(1), encoded); err != nil {
		t.Fatal(err)
	}
	if err := service.store.Put(t.Context(), historyKey(2), encoded); err != nil {
		t.Fatal(err)
	}
	if entries := loadHistory(t, service, 1, ""); len(entries) != maxHistoryEntries {
		t.Fatalf("history limit not applied: %d", len(entries))
	}
	entries, err := service.PlaybackHistory(t.Context(), 1, "", 1)
	if err != nil || len(entries) < 23 || len(entries) > 24 {
		t.Fatalf("retention not applied: %d %v", len(entries), err)
	}
	if len(loadHistory(t, service, 2, "")) != maxHistoryEntries {
		t.Fatal("retention changed another user's history")
	}
	stored, _ := service.historyLocked(t.Context(), 1)
	if len(stored.Entries) != len(entries) {
		t.Fatal("expired history was not removed from storage")
	}
}

func serviceMetadata(t *testing.T, song jsontext.Value) jsontext.Value {
	t.Helper()
	var snapshot models.Song
	if err := json.Unmarshal(song, &snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot.MyGo
}

func TestHistoryTotalBytesLimit(t *testing.T) {
	service := installedService(t, `export function search(){return []}`)
	var snapshot models.Song
	if err := json.Unmarshal(historySong(t, service, "one"), &snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot.Title = strings.Repeat("large", 12000)
	song, err := json.Marshal(snapshot)
	if err != nil || len(song) > maxHistorySongBytes {
		t.Fatalf("bad large fixture: %d %v", len(song), err)
	}
	var state historyState
	for index := range 200 {
		now := time.Now().Add(-time.Duration(index) * time.Second)
		state.NextID++
		state.Entries = append(state.Entries, historyRecord{ID: -state.NextID, Song: song, DeviceType: "pc", PlayedAt: now, UpdatedAt: now})
	}
	for {
		encoded, _ := json.Marshal(state)
		if len(encoded) <= maxHistoryBytes {
			if err := service.store.Put(t.Context(), historyKey(1), encoded); err != nil {
				t.Fatal(err)
			}
			break
		}
		state.Entries = state.Entries[:len(state.Entries)-1]
	}
	previousCount := len(state.Entries)
	if err := service.SaveHistory(t.Context(), 1, "pc", "", 0, HistoryUpdate{Song: song}); err != nil {
		t.Fatal(err)
	}
	contents, _ := service.store.Get(t.Context(), historyKey(1))
	if len(contents) > maxHistoryBytes {
		t.Fatalf("total history exceeded byte limit: %d", len(contents))
	}
	if entries := loadHistory(t, service, 1, ""); len(entries) > previousCount || len(entries) == 0 || entries[0].ID != -(state.NextID+1) {
		t.Fatalf("size eviction did not retain latest: %d", len(entries))
	}
}
