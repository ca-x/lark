package mygo

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"

	"lark/backend/internal/models"
)

const MaxHistoryRequestBytes = 128 << 10
const maxHistorySongBytes = 64 << 10
const maxHistoryEntries = 500
const maxHistoryBytes = 8 << 20

type HistoryUpdate struct {
	Song            jsontext.Value `json:"song"`
	ProgressSeconds *float64       `json:"progress_seconds,omitempty"`
	DurationSeconds *float64       `json:"duration_seconds,omitempty"`
	Completed       *bool          `json:"completed,omitempty"`
}

type historySource struct {
	Plugin   string `json:"plugin"`
	Identity string `json:"identity"`
	Track    string `json:"track"`
}

type historyRecord struct {
	ID              int            `json:"id"`
	Song            jsontext.Value `json:"song"`
	Source          historySource  `json:"source"`
	PlayedAt        time.Time      `json:"played_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	ProgressSeconds float64        `json:"progress_seconds"`
	DurationSeconds float64        `json:"duration_seconds"`
	Completed       bool           `json:"completed"`
	DeviceType      string         `json:"device_type"`
}

type historyState struct {
	NextID  int             `json:"next_id"`
	Entries []historyRecord `json:"entries"`
}

func historyKey(user int) string { return fmt.Sprintf("mygo-history-v1:%d", user) }

func (s *Service) historyLocked(ctx context.Context, user int) (historyState, error) {
	contents, err := s.store.Get(ctx, historyKey(user))
	if err != nil {
		return historyState{}, err
	}
	var state historyState
	if len(contents) > maxHistoryBytes {
		return state, errors.New("mygo history exceeds limit")
	}
	if len(contents) > 0 {
		err = json.Unmarshal(contents, &state)
	}
	return state, err
}

func pruneHistory(state *historyState, now time.Time, retentionDays int) {
	if retentionDays > 0 {
		cutoff := now.AddDate(0, 0, -retentionDays)
		state.Entries = slices.DeleteFunc(state.Entries, func(entry historyRecord) bool { return entry.UpdatedAt.Before(cutoff) })
	}
	slices.SortStableFunc(state.Entries, func(left, right historyRecord) int {
		if order := right.UpdatedAt.Compare(left.UpdatedAt); order != 0 {
			return order
		}
		return right.PlayedAt.Compare(left.PlayedAt)
	})
	if len(state.Entries) > maxHistoryEntries {
		state.Entries = state.Entries[:maxHistoryEntries]
	}
}

func (s *Service) saveHistoryLocked(ctx context.Context, user int, state historyState) error {
	for {
		contents, err := json.Marshal(state)
		if err != nil {
			return err
		}
		if len(contents) <= maxHistoryBytes {
			return s.store.Put(ctx, historyKey(user), contents)
		}
		keep := max(0, len(state.Entries)*maxHistoryBytes/len(contents)-1)
		state.Entries = state.Entries[:keep]
	}
}

func validHistorySeconds(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 366*24*60*60
}

func (s *Service) SaveHistory(ctx context.Context, user int, deviceType, deviceScope string, retentionDays int, update HistoryUpdate) error {
	var snapshot models.Song
	var source historySource
	if user <= 0 || len(update.Song) > maxHistorySongBytes || update.Song.Kind() != '{' || json.Unmarshal(update.Song, &snapshot) != nil ||
		snapshot.ID >= 0 || snapshot.ID < -9007199254740991 || strings.TrimSpace(snapshot.Title) == "" ||
		json.Unmarshal(snapshot.MyGo, &source) != nil || !validID.MatchString(source.Plugin) || source.Identity == "" ||
		strings.TrimSpace(source.Track) == "" || len(source.Track) > 4096 || !validHistorySeconds(snapshot.DurationSeconds) {
		return errors.New("invalid mygo history song")
	}
	if deviceType != "pc" && deviceType != "mobile" {
		return errors.New("invalid playback device")
	}
	if deviceScope != "" && deviceScope != deviceType {
		return errors.New("invalid playback device scope")
	}
	for _, value := range []*float64{update.ProgressSeconds, update.DurationSeconds} {
		if value != nil && !validHistorySeconds(*value) {
			return errors.New("invalid playback progress")
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.enabled || s.closed {
		return ErrDisabled
	}
	item, err := s.itemLocked(source.Plugin)
	if err != nil {
		return err
	}
	if source.Identity != item.Identity {
		return errors.New("source identity changed; reload source")
	}
	if !item.Enabled {
		return ErrDisabled
	}
	state, err := s.historyLocked(ctx, user)
	if err != nil {
		return err
	}
	now := time.Now()
	pruneHistory(&state, now, retentionDays)
	progressUpdate := update.ProgressSeconds != nil || update.Completed != nil
	index := -1
	if progressUpdate {
		index = slices.IndexFunc(state.Entries, func(entry historyRecord) bool {
			return entry.Source == source && (deviceScope == "" || entry.DeviceType == deviceScope)
		})
	}
	if index < 0 {
		if state.NextID >= 9007199254740991 {
			return errors.New("mygo history sequence exhausted")
		}
		state.NextID++
		state.Entries = append(state.Entries, historyRecord{ID: -state.NextID, Source: source, PlayedAt: now, DurationSeconds: snapshot.DurationSeconds})
		index = len(state.Entries) - 1
	}
	entry := &state.Entries[index]
	entry.Song = update.Song.Clone()
	entry.DeviceType = deviceType
	entry.UpdatedAt = now
	if update.ProgressSeconds != nil {
		entry.ProgressSeconds = *update.ProgressSeconds
	}
	if update.DurationSeconds != nil && *update.DurationSeconds > 0 {
		entry.DurationSeconds = *update.DurationSeconds
	}
	if update.Completed != nil {
		entry.Completed = *update.Completed
	}
	if entry.DurationSeconds > 0 {
		entry.ProgressSeconds = min(entry.ProgressSeconds, entry.DurationSeconds)
		if entry.DurationSeconds-entry.ProgressSeconds <= 3 {
			entry.Completed = true
		}
	}
	pruneHistory(&state, now, retentionDays)
	return s.saveHistoryLocked(ctx, user, state)
}

func (s *Service) PlaybackHistory(ctx context.Context, user int, deviceScope string, retentionDays int) ([]models.PlaybackHistoryEntry, error) {
	if user <= 0 {
		return nil, errors.New("authenticated user required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.historyLocked(ctx, user)
	if err != nil {
		return nil, err
	}
	previousCount := len(state.Entries)
	pruneHistory(&state, time.Now(), retentionDays)
	if len(state.Entries) != previousCount {
		if err := s.saveHistoryLocked(ctx, user, state); err != nil {
			return nil, err
		}
	}
	entries := make([]models.PlaybackHistoryEntry, 0, len(state.Entries))
	counts := map[historySource]int{}
	latest := map[historySource]historyRecord{}
	for _, entry := range state.Entries {
		if deviceScope != "" && entry.DeviceType != deviceScope {
			continue
		}
		counts[entry.Source]++
		if _, exists := latest[entry.Source]; !exists {
			latest[entry.Source] = entry
		}
	}
	for _, entry := range state.Entries {
		if deviceScope != "" && entry.DeviceType != deviceScope {
			continue
		}
		var song models.Song
		if err := json.Unmarshal(entry.Song, &song); err != nil {
			return nil, err
		}
		last := latest[entry.Source]
		song.PlayCount = counts[entry.Source]
		song.LastPlayedAt = new(last.PlayedAt)
		song.ResumePosition = 0
		if !last.Completed && last.ProgressSeconds >= 5 && (last.DurationSeconds <= 0 || last.ProgressSeconds < last.DurationSeconds-5) {
			song.ResumePosition = last.ProgressSeconds
		}
		entries = append(entries, models.PlaybackHistoryEntry{ID: entry.ID, Song: song, PlayedAt: entry.PlayedAt,
			UpdatedAt: entry.UpdatedAt, ProgressSeconds: entry.ProgressSeconds, DurationSeconds: entry.DurationSeconds,
			Completed: entry.Completed, DeviceType: entry.DeviceType})
	}
	return entries, nil
}
