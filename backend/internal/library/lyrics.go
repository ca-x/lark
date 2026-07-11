package library

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/song"
	"lark/backend/internal/models"
	"lark/backend/internal/online"
)

func (s *Service) Lyrics(ctx context.Context, id int, sourceID string) (models.Lyrics, error) {
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().Only(ctx)
	if err != nil {
		return models.Lyrics{}, err
	}
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" || strings.EqualFold(sourceID, "embedded") {
		includeSidecar := sourceID == ""
		if lyric, source := s.preferredLocalLyrics(ctx, item, includeSidecar); lyric != "" {
			if item.LyricsSource != source || strings.TrimSpace(item.LyricsEmbedded) != lyric {
				_, _ = item.Update().SetLyricsEmbedded(lyric).SetLyricsSource(source).SetHasLyrics(true).Save(ctx)
				s.invalidateSongCatalog(ctx)
			}
			return models.Lyrics{SongID: id, Source: source, Lyrics: lyric}, nil
		}
		if strings.EqualFold(sourceID, "embedded") {
			return models.Lyrics{SongID: id, Source: "embedded:not-found", Lyrics: ""}, nil
		}
		if strings.TrimSpace(item.LyricsEmbedded) != "" && strings.TrimSpace(item.LyricsSource) != "" {
			lyric := strings.TrimSpace(item.LyricsEmbedded)
			s.saveLyricsSidecarIfEnabled(ctx, ActualAudioPath(item.Path), lyric)
			return models.Lyrics{SongID: id, Source: item.LyricsSource, Lyrics: lyric}, nil
		}
	}
	if sourceID == "" {
		sourceID = strings.TrimSpace(item.NeteaseID)
	}
	artistName := ""
	if item.Edges.Artist != nil {
		artistName = item.Edges.Artist.Name
	}
	cleanArtist, cleanTitle := cleanLyricArtistTitle(artistName, item.Title)
	var lyric, matchedID, matchedSource string
	for index, title := range lyricTitleQueryVariants(cleanTitle) {
		preferredID := sourceID
		if index > 0 {
			preferredID = ""
		}
		var matchErr error
		lyric, matchedID, matchedSource, matchErr = s.matchOnlineLyrics(ctx, title, cleanArtist, preferredID)
		if matchErr != nil {
			return models.Lyrics{}, matchErr
		}
		if strings.TrimSpace(lyric) != "" {
			break
		}
	}
	if strings.TrimSpace(lyric) == "" {
		return models.Lyrics{SongID: id, Source: "online:not-found", Lyrics: ""}, nil
	}
	if matchedSource == "" {
		matchedSource = "online"
	}
	s.saveLyricsSidecarIfEnabled(ctx, ActualAudioPath(item.Path), lyric)
	update := item.Update().SetLyricsEmbedded(lyric).SetLyricsSource(matchedSource).SetHasLyrics(true)
	if matchedSource == "netease" && matchedID != "" {
		update.SetNeteaseID(matchedID)
	}
	_, _ = update.Save(ctx)
	s.invalidateSongCatalog(ctx)
	return models.Lyrics{SongID: id, Source: matchedSource, Lyrics: lyric, Fetched: true}, nil
}
func preferredEmbeddedLyrics(item *ent.Song, fileLyrics string) string {
	if item != nil && item.LyricsSource == "embedded" && strings.TrimSpace(item.LyricsEmbedded) != "" {
		return strings.TrimSpace(item.LyricsEmbedded)
	}
	return strings.TrimSpace(fileLyrics)
}
func (s *Service) LyricCandidates(ctx context.Context, id int) ([]models.LyricCandidate, error) {
	return s.LyricCandidatesForUser(ctx, 0, id, false)
}

func (s *Service) LyricCandidatesForUser(ctx context.Context, userID, id int, refresh bool) ([]models.LyricCandidate, error) {
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().WithAlbum().Only(ctx)
	if err != nil {
		return nil, err
	}
	artistName, albumTitle := "", ""
	if item.Edges.Artist != nil {
		artistName = item.Edges.Artist.Name
	}
	if item.Edges.Album != nil {
		albumTitle = item.Edges.Album.Title
	}
	snapshot := fmt.Sprintf("v1\x00%s\x00%s\x00%s\x00%.3f", strings.TrimSpace(item.Title), strings.TrimSpace(artistName), strings.TrimSpace(albumTitle), item.DurationSeconds)
	payload, err := s.loadCandidateJSON(ctx, CandidateCacheRequest{UserID: userID, TargetType: "song", TargetID: id, Kind: candidateQueryKindLyrics, Snapshot: snapshot, TTL: 24 * time.Hour, Refresh: refresh}, func(loadCtx context.Context) ([]byte, error) {
		items, loadErr := s.lyricCandidatesUncached(loadCtx, id)
		if loadErr != nil {
			return nil, loadErr
		}
		return json.Marshal(items)
	})
	if err != nil {
		return nil, err
	}
	out := []models.LyricCandidate{}
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) lyricCandidatesUncached(ctx context.Context, id int) ([]models.LyricCandidate, error) {
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().Only(ctx)
	if err != nil {
		return nil, err
	}
	artistName := ""
	if item.Edges.Artist != nil {
		artistName = item.Edges.Artist.Name
	}
	out := []models.LyricCandidate{}
	seen := map[string]bool{}
	appendCandidates := func(items []models.LyricCandidate) {
		for _, candidate := range items {
			key := candidate.Source + ":" + candidate.ID
			if candidate.ID == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, candidate)
		}
	}
	cleanArtist, cleanTitle := cleanLyricArtistTitle(artistName, item.Title)
	titleVariants := lyricTitleQueryVariants(cleanTitle)
	if s.netease != nil {
		for _, title := range titleVariants {
			items, _ := s.netease.SearchCandidates(ctx, title, cleanArtist)
			appendCandidates(items)
		}
	}
	if s.qqmusic != nil {
		for _, title := range titleVariants {
			items, _ := s.qqmusic.SearchCandidates(ctx, title, cleanArtist)
			appendCandidates(items)
		}
	}
	for _, provider := range s.online {
		for _, title := range titleVariants {
			items, err := provider.SearchSongs(ctx, title, cleanArtist)
			if err != nil {
				continue
			}
			candidates := make([]models.LyricCandidate, 0, len(items))
			for _, found := range items {
				candidates = append(candidates, models.LyricCandidate{ID: found.ID, Source: provider.Name(), Title: found.Title, Artist: found.Artist})
			}
			appendCandidates(candidates)
		}
	}
	return out, nil
}
func (s *Service) SelectLyrics(ctx context.Context, id int, source, sourceID string) (models.Lyrics, error) {
	return s.SelectLyricsForUser(ctx, 0, id, source, sourceID)
}

func (s *Service) SelectLyricsForUser(ctx context.Context, userID, id int, source, sourceID string) (models.Lyrics, error) {
	source = strings.ToLower(strings.TrimSpace(source))
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return models.Lyrics{}, fmt.Errorf("lyric candidate id is required")
	}
	lyric, err := s.fetchLyricsBySource(ctx, source, sourceID)
	if err != nil {
		return models.Lyrics{}, err
	}
	if strings.TrimSpace(lyric) == "" {
		return models.Lyrics{SongID: id, Source: source + ":not-found", Lyrics: ""}, nil
	}
	item, err := s.client.Song.Query().Where(song.ID(id)).Only(ctx)
	if err != nil {
		return models.Lyrics{}, err
	}
	s.saveLyricsSidecarIfEnabled(ctx, ActualAudioPath(item.Path), lyric)
	update := item.Update().SetLyricsEmbedded(lyric).SetLyricsSource(source).SetHasLyrics(true)
	if source == "netease" {
		update.SetNeteaseID(sourceID)
	}
	if err := update.Exec(ctx); err != nil {
		return models.Lyrics{}, err
	}
	s.invalidateSongCatalog(ctx)
	_ = s.invalidateCandidateCache(ctx, userID, "song", id, candidateQueryKindLyrics)
	return models.Lyrics{SongID: id, Source: source, Lyrics: lyric, Fetched: true}, nil
}
func (s *Service) matchOnlineLyrics(ctx context.Context, title, artist, preferredID string) (string, string, string, error) {
	preferredID = strings.TrimSpace(preferredID)
	if strings.Contains(preferredID, ":") {
		parts := strings.SplitN(preferredID, ":", 2)
		lyric, err := s.fetchLyricsBySource(ctx, parts[0], parts[1])
		return lyric, parts[1], strings.ToLower(strings.TrimSpace(parts[0])), err
	}
	if preferredID != "" && s.netease != nil {
		lyric, err := s.netease.Lyrics(ctx, preferredID)
		if err != nil {
			return "", "", "", err
		}
		if strings.TrimSpace(lyric) != "" {
			return lyric, preferredID, "netease", nil
		}
	}
	if s.netease != nil {
		id, err := s.netease.SearchSongID(ctx, title, artist)
		if err == nil && strings.TrimSpace(id) != "" {
			lyric, lyricErr := s.netease.Lyrics(ctx, id)
			if lyricErr != nil {
				return "", "", "", lyricErr
			}
			if strings.TrimSpace(lyric) != "" {
				return lyric, id, "netease", nil
			}
		}
	}
	if s.qqmusic != nil {
		id, err := s.qqmusic.SearchSongID(ctx, title, artist)
		if err == nil && strings.TrimSpace(id) != "" {
			lyric, lyricErr := s.qqmusic.Lyrics(ctx, id)
			if lyricErr != nil {
				return "", "", "", lyricErr
			}
			if strings.TrimSpace(lyric) != "" {
				return lyric, id, "qq", nil
			}
		}
	}
	for _, provider := range s.online {
		found, err := provider.SearchSongs(ctx, title, artist)
		if err != nil {
			continue
		}
		for _, candidate := range found {
			lyric, lyricErr := provider.Lyrics(ctx, candidate)
			if lyricErr != nil || strings.TrimSpace(lyric) == "" {
				continue
			}
			return lyric, candidate.ID, provider.Name(), nil
		}
	}
	return "", "", "", nil
}
func (s *Service) fetchLyricsBySource(ctx context.Context, source, sourceID string) (string, error) {
	source = strings.ToLower(strings.TrimSpace(source))
	switch source {
	case "netease", "":
		if s.netease == nil {
			return "", nil
		}
		return s.netease.Lyrics(ctx, sourceID)
	case "qq", "qqmusic":
		if s.qqmusic == nil {
			return "", nil
		}
		return s.qqmusic.Lyrics(ctx, sourceID)
	default:
		for _, provider := range s.online {
			if provider.Name() != source {
				continue
			}
			return provider.Lyrics(ctx, online.Song{Source: provider.Name(), ID: sourceID, Extra: map[string]string{"rid": sourceID, "hash": sourceID, "content_id": sourceID, "tsid": sourceID, "track_id": sourceID, "songid": strings.Split(sourceID, "|")[0]}})
		}
		return "", fmt.Errorf("unsupported lyric source")
	}
}
