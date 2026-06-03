package library

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/cespare/xxhash/v2"

	"lark/backend/ent"
	"lark/backend/ent/playlist"
	"lark/backend/ent/song"
	"lark/backend/ent/user"
	"lark/backend/internal/models"
)

func (s *Service) DailyMix(ctx context.Context, userID, limit int) ([]models.Song, error) {
	if limit <= 0 || limit > 50 {
		limit = 24
	}
	key := cacheKey("daily-mix", time.Now().Format("2006-01-02"), userID, s.userCacheVersion(ctx, userID), limit)
	var cached []models.Song
	if ok, err := s.cacheGetJSON(ctx, key, &cached); err != nil {
		return nil, err
	} else if ok {
		return cached, nil
	}
	total, err := s.client.Song.Query().Count(ctx)
	if err != nil {
		return nil, err
	}
	if total == 0 {
		return []models.Song{}, nil
	}
	candidateLimit := minInt(total, maxInt(limit*8, 200))
	offset := dailyCandidateOffset(time.Now().Format("2006-01-02"), userID, total, candidateLimit)
	query := s.client.Song.Query().WithArtist().WithAlbum().Order(ent.Asc(song.FieldID)).Limit(candidateLimit)
	if offset > 0 {
		query = query.Offset(offset)
	}
	items, err := query.All(ctx)
	if err != nil {
		return nil, err
	}
	if len(items) < candidateLimit && offset > 0 {
		wrapped, err := s.client.Song.Query().
			WithArtist().
			WithAlbum().
			Order(ent.Asc(song.FieldID)).
			Limit(candidateLimit - len(items)).
			All(ctx)
		if err != nil {
			return nil, err
		}
		items = append(items, wrapped...)
	}
	out, err := s.applySongUserState(ctx, userID, mapSongs(items))
	if err != nil {
		return nil, err
	}
	if len(out) <= limit {
		_ = s.cacheSetJSON(ctx, key, out)
		return out, nil
	}
	today := time.Now().Format("2006-01-02")
	type scoredSong struct {
		song  models.Song
		score uint64
	}
	scored := make([]scoredSong, 0, len(out))
	for _, item := range out {
		score := dailyScore(today, userID, item)
		scored = append(scored, scoredSong{song: item, score: score})
	}
	sort.SliceStable(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})
	selected := make([]models.Song, 0, limit)
	for len(selected) < limit && len(scored) > 0 {
		pick := 0
		for i := 0; i < len(scored); i++ {
			if !recentArtistInMix(selected, scored[i].song.ArtistID, 3) {
				pick = i
				break
			}
		}
		selected = append(selected, scored[pick].song)
		scored = append(scored[:pick], scored[pick+1:]...)
	}
	_ = s.cacheSetJSON(ctx, key, selected)
	return selected, nil
}
func (s *Service) SmartPlaylistSongs(ctx context.Context, userID int, id string, limit int) ([]models.Song, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	switch strings.TrimSpace(id) {
	case "daily-mix":
		return s.DailyMix(ctx, userID, limit)
	case "recently-played":
		return s.RecentPlayedSongs(ctx, userID, limit)
	case "recently-added":
		return s.RecentAddedSongs(ctx, userID, limit)
	case "favorites":
		return s.Songs(ctx, userID, "", true, limit)
	case "unplayed":
		deviceScope, err := s.playbackHistoryDeviceScope(ctx, userID)
		if err != nil {
			return nil, err
		}
		items, err := s.client.Song.Query().
			WithArtist().
			WithAlbum().
			Where(song.Not(song.HasPlayHistoryWith(playHistoryUserPredicates(userID, deviceScope)...))).
			Order(ent.Desc(song.FieldCreatedAt), ent.Desc(song.FieldID)).
			Limit(limit).
			All(ctx)
		if err != nil {
			return nil, err
		}
		return s.applySongUserState(ctx, userID, mapSongs(items))
	case "hi-res":
		items, err := s.client.Song.Query().
			WithArtist().
			WithAlbum().
			Where(song.Or(song.BitDepthGTE(24), song.SampleRateGTE(96000))).
			Order(ent.Desc(song.FieldBitDepth), ent.Desc(song.FieldSampleRate), ent.Desc(song.FieldUpdatedAt)).
			Limit(limit).
			All(ctx)
		if err != nil {
			return nil, err
		}
		return s.applySongUserState(ctx, userID, mapSongs(items))
	case "needs-lyrics":
		items, err := s.client.Song.Query().
			WithArtist().
			WithAlbum().
			Where(song.LyricsEmbedded("")).
			Order(ent.Desc(song.FieldUpdatedAt), ent.Desc(song.FieldID)).
			Limit(limit).
			All(ctx)
		if err != nil {
			return nil, err
		}
		return s.applySongUserState(ctx, userID, mapSongs(items))
	default:
		return nil, fmt.Errorf("smart playlist not found")
	}
}
func dailyCandidateOffset(day string, userID, total, candidateLimit int) int {
	if total <= candidateLimit {
		return 0
	}
	return int(dailySeed(day, userID) % uint64(total-candidateLimit+1))
}
func songContentHash(artist, album, title string) string {
	parts := []string{
		normalizeSongContentHashPart(artist),
		normalizeSongContentHashPart(album),
		normalizeSongContentHashPart(title),
	}
	if parts[0] == "" && parts[1] == "" && parts[2] == "" {
		return ""
	}
	return fmt.Sprintf("%x", xxhash.Sum64String(strings.Join(parts, "|")))
}
func (s *Service) PlaybackSource(ctx context.Context, userID int) (*models.PlaybackSource, error) {
	if s.cache == nil {
		return nil, nil
	}
	key, err := s.playbackSourceKey(ctx, userID)
	if err != nil {
		return nil, err
	}
	var source models.PlaybackSource
	ok, err := s.cacheGetJSON(ctx, key, &source)
	if err != nil || !ok {
		return nil, err
	}
	if source.SourceID <= 0 || (source.Type != "album" && source.Type != "artist" && source.Type != "playlist") {
		_ = s.ClearPlaybackSource(ctx, userID)
		return nil, nil
	}
	return &source, nil
}
func (s *Service) SavePlaybackSource(ctx context.Context, userID int, sourceType string, sourceID int) (models.PlaybackSource, error) {
	sourceType = strings.ToLower(strings.TrimSpace(sourceType))
	if sourceID <= 0 || (sourceType != "album" && sourceType != "artist" && sourceType != "playlist") {
		return models.PlaybackSource{}, errors.New("playback source must be album, artist or playlist")
	}
	switch sourceType {
	case "album":
		if _, err := s.client.Album.Get(ctx, sourceID); err != nil {
			return models.PlaybackSource{}, err
		}
	case "artist":
		if _, err := s.client.Artist.Get(ctx, sourceID); err != nil {
			return models.PlaybackSource{}, err
		}
	case "playlist":
		if _, err := s.client.Playlist.Query().Where(playlist.ID(sourceID), playlist.HasOwnerWith(user.ID(userID))).Only(ctx); err != nil {
			return models.PlaybackSource{}, err
		}
	}
	source := models.PlaybackSource{Type: sourceType, SourceID: sourceID, UpdatedAt: time.Now()}
	ttl := s.playbackSourceTTL(ctx)
	key, err := s.playbackSourceKey(ctx, userID)
	if err != nil {
		return models.PlaybackSource{}, err
	}
	if err := s.cacheSetJSONWithTTL(ctx, key, source, ttl); err != nil {
		return models.PlaybackSource{}, err
	}
	return source, nil
}
func (s *Service) ClearPlaybackSource(ctx context.Context, userID int) error {
	if s.cache == nil {
		return nil
	}
	key, err := s.playbackSourceKey(ctx, userID)
	if err != nil {
		return err
	}
	return s.cache.Delete(ctx, key)
}
func (s *Service) PlaybackQueue(ctx context.Context, userID int) (*models.PlaybackQueue, error) {
	if s.cache == nil {
		return nil, nil
	}
	key, err := s.playbackQueueKey(ctx, userID)
	if err != nil {
		return nil, err
	}
	var queue models.PlaybackQueue
	ok, err := s.cacheGetJSON(ctx, key, &queue)
	if err != nil || !ok {
		return nil, err
	}
	queue.SongIDs = normalizePlaybackQueueSongIDs(queue.SongIDs, queue.CurrentID)
	if len(queue.SongIDs) == 0 {
		_ = s.ClearPlaybackQueue(ctx, userID)
		return nil, nil
	}
	if queue.CurrentID <= 0 || !intSliceContains(queue.SongIDs, queue.CurrentID) {
		queue.CurrentID = queue.SongIDs[0]
	}
	return &queue, nil
}
func (s *Service) SavePlaybackQueue(ctx context.Context, userID int, songIDs []int, currentID int) (models.PlaybackQueue, error) {
	if s.cache == nil {
		return models.PlaybackQueue{}, nil
	}
	ids := normalizePlaybackQueueSongIDs(songIDs, currentID)
	if len(ids) == 0 {
		return models.PlaybackQueue{}, s.ClearPlaybackQueue(ctx, userID)
	}
	existing, err := s.client.Song.Query().Where(song.IDIn(ids...)).Select(song.FieldID).All(ctx)
	if err != nil {
		return models.PlaybackQueue{}, err
	}
	exists := make(map[int]bool, len(existing))
	for _, item := range existing {
		exists[item.ID] = true
	}
	filtered := ids[:0]
	for _, id := range ids {
		if exists[id] {
			filtered = append(filtered, id)
		}
	}
	if len(filtered) == 0 {
		return models.PlaybackQueue{}, s.ClearPlaybackQueue(ctx, userID)
	}
	if currentID <= 0 || !intSliceContains(filtered, currentID) {
		currentID = filtered[0]
	}
	queue := models.PlaybackQueue{SongIDs: append([]int{}, filtered...), CurrentID: currentID, UpdatedAt: time.Now()}
	key, err := s.playbackQueueKey(ctx, userID)
	if err != nil {
		return models.PlaybackQueue{}, err
	}
	if err := s.cacheSetJSONWithTTL(ctx, key, queue, s.playbackSourceTTL(ctx)); err != nil {
		return models.PlaybackQueue{}, err
	}
	return queue, nil
}
func (s *Service) ClearPlaybackQueue(ctx context.Context, userID int) error {
	if s.cache == nil {
		return nil
	}
	key, err := s.playbackQueueKey(ctx, userID)
	if err != nil {
		return err
	}
	return s.cache.Delete(ctx, key)
}
func (s *Service) playbackSourceTTL(ctx context.Context) time.Duration {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return time.Duration(defaultPlaybackSourceTTLHours) * time.Hour
	}
	return time.Duration(normalizePlaybackSourceTTLHours(settings.PlaybackSourceTTLHours)) * time.Hour
}
func (s *Service) playbackSourceKey(ctx context.Context, userID int) (string, error) {
	deviceScope, err := s.playbackHistoryDeviceScope(ctx, userID)
	if err != nil {
		return "", err
	}
	if deviceScope == "" {
		return playbackSourcePrefix + strconv.Itoa(userID), nil
	}
	return playbackSourcePrefix + strconv.Itoa(userID) + ":" + deviceScope, nil
}
func (s *Service) playbackQueueKey(ctx context.Context, userID int) (string, error) {
	if userID == 0 {
		return "", ErrUnauthenticated
	}
	settings, err := s.GetPlaybackHistorySettings(ctx, userID)
	if err != nil {
		return "", err
	}
	if !settings.SeparateByDevice {
		return playbackQueuePrefix + strconv.Itoa(userID), nil
	}
	deviceScope := playbackDeviceTypeFromContext(ctx)
	return playbackQueuePrefix + strconv.Itoa(userID) + ":" + deviceScope, nil
}
func normalizePlaybackQueueSongIDs(songIDs []int, currentID int) []int {
	seen := map[int]bool{}
	out := make([]int, 0, minInt(len(songIDs)+1, maxPlaybackQueueSongs))
	appendID := func(id int) {
		if id <= 0 || seen[id] || len(out) >= maxPlaybackQueueSongs {
			return
		}
		seen[id] = true
		out = append(out, id)
	}
	for _, id := range songIDs {
		appendID(id)
	}
	if currentID > 0 && !seen[currentID] {
		if len(out) >= maxPlaybackQueueSongs {
			out = out[:maxPlaybackQueueSongs-1]
		}
		out = append([]int{currentID}, out...)
	}
	return out
}
func intSliceContains(items []int, target int) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
func normalizePlaybackSourceTTLHours(hours int) int {
	if hours <= 0 {
		return defaultPlaybackSourceTTLHours
	}
	if hours > 720 {
		return 720
	}
	return hours
}
