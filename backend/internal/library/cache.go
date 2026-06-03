package library

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/artist"
	"lark/backend/ent/song"
	"lark/backend/internal/kv"
)

const libraryCachePrefix = "library:v1:"
const artistCatalogCacheKey = libraryCachePrefix + "catalog:v2:artists"
const songCatalogCacheKey = libraryCachePrefix + "catalog:v2:songs"
const searchCatalogBatchSize = 500
const maxCatalogPredicateIDs = 5000
type songSearchCatalogEntry struct {
	ID   int    `json:"id"`
	Text string `json:"text"`
}
type artistSearchCatalogEntry struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Text string `json:"text"`
}
func cacheKey(parts ...any) string {
	var b strings.Builder
	b.WriteString(libraryCachePrefix)
	for i, part := range parts {
		if i > 0 {
			b.WriteByte(':')
		}
		b.WriteString(url.QueryEscape(fmt.Sprint(part)))
	}
	return b.String()
}
func (s *Service) cacheGetJSON(ctx context.Context, key string, out any) (bool, error) {
	if s.cache == nil {
		return false, nil
	}
	data, ok, err := s.cache.Get(ctx, key)
	if err != nil || !ok {
		return false, err
	}
	if err := json.Unmarshal(data, out); err != nil {
		_ = s.cache.Delete(ctx, key)
		return false, nil
	}
	return true, nil
}
func (s *Service) cacheSetJSON(ctx context.Context, key string, value any) error {
	return s.cacheSetJSONWithTTL(ctx, key, value, s.cacheTTL)
}
func (s *Service) cacheSetJSONPermanent(ctx context.Context, key string, value any) error {
	return s.cacheSetJSONWithTTL(ctx, key, value, 0)
}
func (s *Service) cacheSetJSONWithTTL(ctx context.Context, key string, value any, ttl time.Duration) error {
	if s.cache == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.cache.Set(ctx, key, data, ttl)
}
func (s *Service) searchCatalogCacheEnabled() bool {
	if s.cache == nil {
		return false
	}
	switch s.cache.(type) {
	case kv.NoopStore, *kv.MemoryStore:
		return false
	default:
		return true
	}
}
func (s *Service) ReleaseTranscodeWarmLease(ctx context.Context, cachePath string) {
	if s.cache == nil {
		return
	}
	_ = s.cache.Delete(ctx, transcodeWarmLeaseKey(cachePath))
}
func (s *Service) invalidateLibraryCache(ctx context.Context) {
	// Clear the in-memory count caches so the next browse/page load re-queries.
	s.countCacheMu.Lock()
	s.albumSongCountsAll = cachedCounts{}
	s.artistSongCountsAll = cachedCounts{}
	s.artistAlbumCountsAll = cachedCounts{}
	s.countCacheMu.Unlock()
	if s.cache == nil {
		return
	}
	_ = s.cache.DeletePrefix(ctx, libraryCachePrefix)
}
const userVersionPrefix = libraryCachePrefix + "uver:v1:"
const scrobblingPrefix = "user:v1:scrobbling:"
const uiSoundSettingsPrefix = "user:v1:ui-sounds:"
const playbackHistorySettingsPrefix = "user:v1:playback-history:"
const userPreferencesPrefix = "user:v1:preferences:"
func (s *Service) userCacheVersion(ctx context.Context, userID int) int {
	if userID <= 0 || s.cache == nil {
		return 0
	}
	key := fmt.Sprintf("%s%d", userVersionPrefix, userID)
	data, ok, err := s.cache.Get(ctx, key)
	if err != nil || !ok || len(data) == 0 {
		return 0
	}
	v, _ := strconv.Atoi(string(data))
	return v
}
func (s *Service) bumpUserCacheVersion(ctx context.Context, userID int) {
	if userID <= 0 || s.cache == nil {
		return
	}
	key := fmt.Sprintf("%s%d", userVersionPrefix, userID)
	v := s.userCacheVersion(ctx, userID) + 1
	_ = s.cache.Set(ctx, key, []byte(strconv.Itoa(v)), 30*24*time.Hour)
}
func (s *Service) invalidateUserLibraryCache(ctx context.Context, userID int) {
	if s.cache == nil {
		return
	}
	s.bumpUserCacheVersion(ctx, userID)
}
func (s *Service) invalidateArtistCatalog(ctx context.Context) {
	if s.cache != nil {
		_ = s.cache.Delete(ctx, artistCatalogCacheKey)
	}
}
func (s *Service) invalidateSongCatalog(ctx context.Context) {
	if s.cache != nil {
		_ = s.cache.Delete(ctx, songCatalogCacheKey)
	}
}
func (s *Service) invalidateSearchCatalogs(ctx context.Context) {
	s.invalidateArtistCatalog(ctx)
	s.invalidateSongCatalog(ctx)
}
func (s *Service) warmSearchCatalogs(ctx context.Context) error {
	if !s.searchCatalogCacheEnabled() || s.client == nil {
		return nil
	}
	if _, err := s.songSearchCatalog(ctx); err != nil {
		return err
	}
	_, err := s.artistSearchCatalog(ctx)
	return err
}
func (s *Service) songSearchCatalog(ctx context.Context) ([]songSearchCatalogEntry, error) {
	if !s.searchCatalogCacheEnabled() || s.client == nil {
		return nil, nil
	}
	var cached []songSearchCatalogEntry
	if ok, err := s.cacheGetJSON(ctx, songCatalogCacheKey, &cached); err != nil {
		return nil, err
	} else if ok {
		return cached, nil
	}
	out := []songSearchCatalogEntry{}
	lastID := 0
	for {
		items, err := s.client.Song.Query().
			Where(song.IDGT(lastID)).
			WithArtist().
			WithAlbum().
			Order(ent.Asc(song.FieldID)).
			Limit(searchCatalogBatchSize).
			All(ctx)
		if err != nil {
			return nil, err
		}
		if len(items) == 0 {
			break
		}
		for _, item := range items {
			lastID = item.ID
			artistName := ""
			if item.Edges.Artist != nil {
				artistName = item.Edges.Artist.Name
			}
			albumTitle := ""
			albumArtist := ""
			if item.Edges.Album != nil {
				albumTitle = item.Edges.Album.Title
				albumArtist = item.Edges.Album.AlbumArtist
			}
			out = append(out, songSearchCatalogEntry{
				ID: item.ID,
				Text: searchCatalogText(
					item.Title,
					item.FileName,
					item.Format,
					artistName,
					albumTitle,
					albumArtist,
				),
			})
		}
	}
	if err := s.cacheSetJSONPermanent(ctx, songCatalogCacheKey, out); err != nil {
		return nil, err
	}
	return out, nil
}
func (s *Service) songCatalogIDsForTerm(ctx context.Context, term string) ([]int, bool, error) {
	term = searchCatalogTerm(term)
	if term == "" || !s.searchCatalogCacheEnabled() {
		return nil, false, nil
	}
	catalog, err := s.songSearchCatalog(ctx)
	if err != nil {
		return nil, false, err
	}
	ids := make([]int, 0, minInt(len(catalog), maxCatalogPredicateIDs))
	for _, item := range catalog {
		if strings.Contains(item.Text, term) {
			ids = append(ids, item.ID)
			if len(ids) > maxCatalogPredicateIDs {
				return nil, false, nil
			}
		}
	}
	return ids, true, nil
}
func (s *Service) artistSearchCatalog(ctx context.Context) ([]artistSearchCatalogEntry, error) {
	if !s.searchCatalogCacheEnabled() || s.client == nil {
		return nil, nil
	}
	var cached []artistSearchCatalogEntry
	if ok, err := s.cacheGetJSON(ctx, artistCatalogCacheKey, &cached); err != nil {
		return nil, err
	} else if ok {
		return cached, nil
	}
	items, err := s.client.Artist.Query().Order(ent.Asc(artist.FieldName)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]artistSearchCatalogEntry, 0, len(items))
	for _, item := range items {
		out = append(out, artistSearchCatalogEntry{ID: item.ID, Name: item.Name, Text: searchCatalogText(item.Name)})
	}
	if err := s.cacheSetJSONPermanent(ctx, artistCatalogCacheKey, out); err != nil {
		return nil, err
	}
	return out, nil
}
func searchCatalogTerm(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
func searchCatalogText(values ...string) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		value = searchCatalogTerm(value)
		if value != "" {
			parts = append(parts, value)
		}
	}
	return strings.Join(parts, "\x00")
}
func collectionCoverCacheKey(key string) string {
	return strings.NewReplacer("/", "_", "\\", "_", ":", "_").Replace(strings.TrimSpace(key))
}
