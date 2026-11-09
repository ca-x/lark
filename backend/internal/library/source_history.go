package library

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"slices"

	"lark/backend/ent"
	"lark/backend/internal/models"
)

type SourcePlaybackHistory interface {
	PlaybackHistory(context.Context, int, string, int) ([]models.PlaybackHistoryEntry, error)
}

func (s *Service) SetSourcePlaybackHistory(history SourcePlaybackHistory) {
	s.sourceHistory = history
}

func (s *Service) sourcePlaybackHistory(ctx context.Context, userID int, deviceScope string) ([]models.PlaybackHistoryEntry, error) {
	if s.sourceHistory == nil {
		return nil, nil
	}
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	return s.sourceHistory.PlaybackHistory(ctx, userID, deviceScope, normalizePlaybackHistoryRetentionDays(settings.PlaybackHistoryRetentionDays))
}

func sortPlaybackHistory(entries []models.PlaybackHistoryEntry) {
	slices.SortStableFunc(entries, func(left, right models.PlaybackHistoryEntry) int {
		if order := right.UpdatedAt.Compare(left.UpdatedAt); order != 0 {
			return order
		}
		if order := right.PlayedAt.Compare(left.PlayedAt); order != 0 {
			return order
		}
		return 0
	})
}

func (s *Service) mergeSourcePlaybackHistory(ctx context.Context, userID int, deviceScope string, limit int, local []models.PlaybackHistoryEntry) ([]models.PlaybackHistoryEntry, error) {
	entries, err := s.sourcePlaybackHistory(ctx, userID, deviceScope)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return local, nil
	}
	entries = append(local, entries...)
	sortPlaybackHistory(entries)
	return entries[:min(limit, len(entries))], nil
}

func sourceSongHistoryKey(song models.Song) string {
	if len(song.MyGo) == 0 {
		return fmt.Sprintf("local:%d", song.ID)
	}
	var source struct {
		Plugin   string `json:"plugin"`
		Identity string `json:"identity"`
		Track    string `json:"track"`
	}
	if err := json.Unmarshal(song.MyGo, &source); err != nil {
		return fmt.Sprintf("invalid:%d", song.ID)
	}
	return source.Plugin + "\x00" + source.Identity + "\x00" + source.Track
}

func (s *Service) mergeSourceRecentPlayed(ctx context.Context, userID int, deviceScope string, limit int, local []models.Song, histories []*ent.PlayHistory) ([]models.Song, error) {
	entries, err := s.sourcePlaybackHistory(ctx, userID, deviceScope)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return local, nil
	}
	byID := make(map[int]models.Song, len(local))
	for _, song := range local {
		byID[song.ID] = song
	}
	for _, history := range histories {
		if history.Edges.Song == nil {
			continue
		}
		if song, found := byID[history.Edges.Song.ID]; found {
			entries = append(entries, models.PlaybackHistoryEntry{Song: song, PlayedAt: history.PlayedAt, UpdatedAt: history.UpdatedAt})
			delete(byID, song.ID)
		}
	}
	sortPlaybackHistory(entries)
	seen := make(map[string]bool, len(entries))
	result := make([]models.Song, 0, limit)
	for _, entry := range entries {
		key := sourceSongHistoryKey(entry.Song)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, entry.Song)
		if len(result) == limit {
			break
		}
	}
	return result, nil
}
