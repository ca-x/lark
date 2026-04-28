package library

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/appsetting"
	"lark/backend/internal/models"
)

const (
	radioUserAgent         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Lark/1.0"
	radioBrowserBase       = "https://de1.api.radio-browser.info/json"
	radioSourcesSettingKey = "radio_sources"
	defaultCliampRadioURL  = "https://radio.cliamp.stream/lofi/stream.pls"
)

var radioHTTPClient = &http.Client{Timeout: 10 * time.Second}

type radioBrowserStation struct {
	StationUUID string `json:"stationuuid"`
	Name        string `json:"name"`
	URL         string `json:"url_resolved"`
	FallbackURL string `json:"url"`
	Country     string `json:"country"`
	Tags        string `json:"tags"`
	Codec       string `json:"codec"`
	Bitrate     int    `json:"bitrate"`
	Votes       int    `json:"votes"`
	Homepage    string `json:"homepage"`
	Favicon     string `json:"favicon"`
}

func (s *Service) TopRadioStations(ctx context.Context, offset, limit int) ([]models.RadioStation, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	endpoint := fmt.Sprintf("%s/stations/topvote/%d?offset=%d&hidebroken=true", radioBrowserBase, limit, offset)
	return fetchRadioStations(ctx, endpoint)
}

func (s *Service) SearchRadioStations(ctx context.Context, query string, limit int) ([]models.RadioStation, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return s.TopRadioStations(ctx, 0, limit)
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	endpoint := fmt.Sprintf("%s/stations/byname/%s?limit=%d&order=votes&reverse=true&hidebroken=true", radioBrowserBase, url.PathEscape(query), limit)
	return fetchRadioStations(ctx, endpoint)
}

func fetchRadioStations(ctx context.Context, endpoint string) ([]models.RadioStation, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", radioUserAgent)
	req.Header.Set("Accept", "application/json")
	res, err := radioHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("radio-browser status %d", res.StatusCode)
	}
	var raw []radioBrowserStation
	if err := json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&raw); err != nil {
		return nil, err
	}
	out := make([]models.RadioStation, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		streamURL := strings.TrimSpace(firstString(item.URL, item.FallbackURL))
		streamURL = resolvePlaylistURL(ctx, streamURL)
		name := strings.TrimSpace(item.Name)
		if streamURL == "" || name == "" || seen[streamURL] {
			continue
		}
		seen[streamURL] = true
		id := strings.TrimSpace(item.StationUUID)
		if id == "" {
			id = radioID(streamURL)
		}
		out = append(out, models.RadioStation{
			ID:       id,
			Name:     name,
			URL:      streamURL,
			Country:  strings.TrimSpace(item.Country),
			Tags:     strings.TrimSpace(item.Tags),
			Codec:    strings.TrimSpace(item.Codec),
			Bitrate:  item.Bitrate,
			Votes:    item.Votes,
			Homepage: strings.TrimSpace(item.Homepage),
			Favicon:  strings.TrimSpace(item.Favicon),
		})
	}
	return out, nil
}

func (s *Service) RadioSources(ctx context.Context) ([]models.RadioSource, error) {
	items := []models.RadioSource{defaultRadioSource(ctx)}
	stored, err := s.storedRadioSources(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{items[0].ID: true, strings.TrimSpace(items[0].URL): true}
	for _, item := range stored {
		item.Name = strings.TrimSpace(item.Name)
		item.URL = strings.TrimSpace(item.URL)
		if item.Name == "" || item.URL == "" || seen[item.ID] || seen[item.URL] {
			continue
		}
		items = append(items, item)
		seen[item.ID] = true
		seen[item.URL] = true
	}
	return items, nil
}

func (s *Service) AddRadioSource(ctx context.Context, name, sourceURL string) (models.RadioSource, error) {
	name = strings.TrimSpace(name)
	sourceURL = strings.TrimSpace(sourceURL)
	if name == "" {
		return models.RadioSource{}, errors.New("radio source name is required")
	}
	if !validStreamLikeURL(sourceURL) {
		return models.RadioSource{}, errors.New("valid http(s) radio source url is required")
	}
	items, err := s.storedRadioSources(ctx)
	if err != nil {
		return models.RadioSource{}, err
	}
	item := models.RadioSource{ID: radioID(sourceURL), Name: name, URL: resolvePlaylistURL(ctx, sourceURL), SourceURL: sourceURL}
	for i, existing := range items {
		if existing.ID == item.ID || strings.EqualFold(existing.URL, item.URL) || strings.EqualFold(existing.SourceURL, item.SourceURL) {
			items[i] = item
			return item, s.saveRadioSources(ctx, items)
		}
	}
	items = append(items, item)
	return item, s.saveRadioSources(ctx, items)
}

func (s *Service) DeleteRadioSource(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" || id == defaultRadioSource(ctx).ID {
		return errors.New("default radio source cannot be deleted")
	}
	items, err := s.storedRadioSources(ctx)
	if err != nil {
		return err
	}
	out := items[:0]
	removed := false
	for _, item := range items {
		if item.ID == id {
			removed = true
			continue
		}
		out = append(out, item)
	}
	if !removed {
		return errors.New("radio source not found")
	}
	return s.saveRadioSources(ctx, out)
}

func (s *Service) storedRadioSources(ctx context.Context) ([]models.RadioSource, error) {
	setting, err := s.client.AppSetting.Query().Where(appsetting.Key(radioSourcesSettingKey)).Only(ctx)
	if ent.IsNotFound(err) {
		return []models.RadioSource{}, nil
	}
	if err != nil {
		return nil, err
	}
	var items []models.RadioSource
	if strings.TrimSpace(setting.Value) == "" {
		return []models.RadioSource{}, nil
	}
	if err := json.Unmarshal([]byte(setting.Value), &items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) saveRadioSources(ctx context.Context, items []models.RadioSource) error {
	clean := make([]models.RadioSource, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		item.Name = strings.TrimSpace(item.Name)
		item.URL = strings.TrimSpace(item.URL)
		item.SourceURL = strings.TrimSpace(item.SourceURL)
		if item.SourceURL == "" {
			item.SourceURL = item.URL
		}
		if item.ID == "" {
			item.ID = radioID(item.SourceURL)
		}
		if item.Name == "" || item.URL == "" || seen[item.ID] {
			continue
		}
		item.Builtin = false
		clean = append(clean, item)
		seen[item.ID] = true
	}
	data, err := json.Marshal(clean)
	if err != nil {
		return err
	}
	return s.setSetting(ctx, radioSourcesSettingKey, string(data))
}

func defaultRadioSource(ctx context.Context) models.RadioSource {
	return models.RadioSource{ID: "builtin-cliamp", Name: "cliamp", URL: resolvePlaylistURL(ctx, defaultCliampRadioURL), SourceURL: defaultCliampRadioURL, Builtin: true}
}

func resolvePlaylistURL(ctx context.Context, streamURL string) string {
	streamURL = strings.TrimSpace(streamURL)
	if streamURL == "" {
		return ""
	}
	lower := strings.ToLower(strings.Split(streamURL, "?")[0])
	if !strings.HasSuffix(lower, ".pls") && !strings.HasSuffix(lower, ".m3u") && !strings.HasSuffix(lower, ".m3u8") {
		return streamURL
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, streamURL, nil)
	if err != nil {
		return streamURL
	}
	req.Header.Set("User-Agent", radioUserAgent)
	res, err := radioHTTPClient.Do(req)
	if err != nil {
		return streamURL
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return streamURL
	}
	scanner := bufio.NewScanner(io.LimitReader(res.Body, 256<<10))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") {
			continue
		}
		if strings.Contains(line, "=") {
			key, value, _ := strings.Cut(line, "=")
			if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(key)), "file") {
				continue
			}
			line = strings.TrimSpace(value)
		}
		if validStreamLikeURL(line) {
			return line
		}
	}
	return streamURL
}

func validStreamLikeURL(value string) bool {
	u, err := url.Parse(strings.TrimSpace(value))
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func radioID(value string) string {
	sum := sha1.Sum([]byte(strings.TrimSpace(strings.ToLower(value))))
	return hex.EncodeToString(sum[:10])
}

func (s *Service) LibrarySources(context.Context) []models.LibrarySource {
	return []models.LibrarySource{
		{ID: "local", Name: "Local Library", Kind: "local", Status: "connected", Description: "Scanned audio files stored in the Lark library directory."},
		{ID: "spotify", Name: "Spotify", Kind: "network", Status: "available", Description: "Direct-connect entry reserved for Spotify account/library integration."},
		{ID: "navidrome", Name: "Navidrome", Kind: "network", Status: "available", Description: "Subsonic/Navidrome-compatible server entry."},
		{ID: "plex", Name: "Plex", Kind: "network", Status: "available", Description: "Plex music library direct-connect entry."},
		{ID: "jellyfin", Name: "Jellyfin", Kind: "network", Status: "available", Description: "Jellyfin music library direct-connect entry."},
	}
}
