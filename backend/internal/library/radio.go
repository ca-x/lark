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
	"sort"
	"strconv"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/appsetting"
	"lark/backend/ent/user"
	"lark/backend/ent/userradiofavorite"
	"lark/backend/internal/models"
)

const (
	radioUserAgent         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Lark/1.0"
	radioBrowserBase       = "https://de1.api.radio-browser.info/json"
	radioSourcesSettingKey = "radio_sources"
	defaultCliampRadioURL  = "https://radio.cliamp.stream/streams.m3u"
)

var radioHTTPClient = &http.Client{Timeout: 10 * time.Second}

func RadioUserAgent() string { return radioUserAgent }

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

func (s *Service) TopRadioStations(ctx context.Context, userID, offset, limit int) ([]models.RadioStation, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	endpoint := fmt.Sprintf("%s/stations/topvote/%d?offset=%d&hidebroken=true", radioBrowserBase, limit, offset)
	items, err := fetchRadioStations(ctx, endpoint)
	if err != nil {
		return nil, err
	}
	return s.markRadioStationFavorites(ctx, userID, items)
}

func (s *Service) SearchRadioStations(ctx context.Context, userID int, query string, limit int) ([]models.RadioStation, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return s.TopRadioStations(ctx, userID, 0, limit)
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	endpoint := fmt.Sprintf("%s/stations/byname/%s?limit=%d&order=votes&reverse=true&hidebroken=true", radioBrowserBase, url.PathEscape(query), limit)
	items, err := fetchRadioStations(ctx, endpoint)
	if err != nil {
		return nil, err
	}
	return s.markRadioStationFavorites(ctx, userID, items)
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
			ID:        id,
			Name:      name,
			URL:       streamURL,
			StreamURL: streamURL,
			Country:   strings.TrimSpace(item.Country),
			Tags:      strings.TrimSpace(item.Tags),
			Codec:     strings.TrimSpace(item.Codec),
			Bitrate:   item.Bitrate,
			Votes:     item.Votes,
			Homepage:  strings.TrimSpace(item.Homepage),
			Favicon:   strings.TrimSpace(item.Favicon),
		})
	}
	return out, nil
}

func (s *Service) RadioSources(ctx context.Context, userID int) ([]models.RadioSource, error) {
	items := defaultRadioSources(ctx)
	stored, err := s.storedRadioSources(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, item := range items {
		seen[item.ID] = true
		seen[strings.TrimSpace(item.URL)] = true
	}
	for _, item := range stored {
		item.Name = strings.TrimSpace(item.Name)
		item.URL = strings.TrimSpace(item.URL)
		item.SourceURL = strings.TrimSpace(item.SourceURL)
		item.GroupName = strings.TrimSpace(item.GroupName)
		if item.GroupName == "" {
			item.GroupName = firstString(item.SourceURL, item.Name)
		}
		item.StreamURL = radioSourceStreamURL(item.ID)
		if item.Name == "" || item.URL == "" || seen[item.ID] || seen[item.URL] {
			continue
		}
		items = append(items, item)
		seen[item.ID] = true
		seen[item.URL] = true
	}
	return s.markRadioSourceFavorites(ctx, userID, items)
}

func (s *Service) RadioSource(ctx context.Context, id string) (models.RadioSource, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return models.RadioSource{}, errors.New("radio source not found")
	}
	items, err := s.RadioSources(ctx, 0)
	if err != nil {
		return models.RadioSource{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return models.RadioSource{}, errors.New("radio source not found")
}

func (s *Service) RadioFavorites(ctx context.Context, userID int) ([]models.RadioStation, error) {
	items, err := s.client.UserRadioFavorite.Query().
		Where(userradiofavorite.HasUserWith(user.ID(userID))).
		Order(ent.Desc(userradiofavorite.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.RadioStation, 0, len(items))
	for _, item := range items {
		out = append(out, radioFavoriteToStation(item))
	}
	return out, nil
}

func (s *Service) ToggleRadioFavorite(ctx context.Context, userID int, station models.RadioStation) (models.RadioStation, error) {
	station, err := s.normalizeRadioFavorite(ctx, station)
	if err != nil {
		return models.RadioStation{}, err
	}
	existing, err := s.client.UserRadioFavorite.Query().
		Where(userradiofavorite.HasUserWith(user.ID(userID)), userradiofavorite.StationID(station.ID)).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.RadioStation{}, err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.UserRadioFavorite.Create().
			SetUserID(userID).
			SetStationID(station.ID).
			SetName(station.Name).
			SetURL(station.URL).
			SetSourceURL(station.SourceURL).
			SetGroupName(station.GroupName).
			SetCountry(station.Country).
			SetTags(station.Tags).
			SetCodec(station.Codec).
			SetBitrate(station.Bitrate).
			SetHomepage(station.Homepage).
			SetFavicon(station.Favicon).
			Save(ctx)
		station.Favorite = true
	} else {
		err = s.client.UserRadioFavorite.DeleteOneID(existing.ID).Exec(ctx)
		station.Favorite = false
	}
	if err != nil {
		return models.RadioStation{}, err
	}
	return station, nil
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
	playlistEntries := radioPlaylistEntries(ctx, sourceURL)
	if len(playlistEntries) > 0 {
		var first models.RadioSource
		for _, entry := range playlistEntries {
			entryName := strings.TrimSpace(entry.Name)
			if entryName == "" {
				entryName = name
			}
			item := models.RadioSource{
				ID:        radioID(sourceURL + "|" + entry.URL + "|" + entryName),
				Name:      entryName,
				URL:       entry.URL,
				SourceURL: sourceURL,
				GroupName: name,
			}
			item.StreamURL = radioSourceStreamURL(item.ID)
			if first.ID == "" {
				first = item
			}
			replaced := false
			for i, existing := range items {
				if existing.ID == item.ID || strings.EqualFold(existing.URL, item.URL) {
					items[i] = item
					replaced = true
					break
				}
			}
			if !replaced {
				items = append(items, item)
			}
		}
		return first, s.saveRadioSources(ctx, items)
	}
	item := models.RadioSource{ID: radioID(sourceURL), Name: name, URL: resolvePlaylistURL(ctx, sourceURL), SourceURL: sourceURL, GroupName: name}
	item.StreamURL = radioSourceStreamURL(item.ID)
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
	var target models.RadioSource
	for _, item := range items {
		if item.ID == id {
			target = item
			break
		}
	}
	if target.ID == "" {
		return errors.New("radio source not found")
	}
	deleteSourceURL := strings.TrimSpace(target.SourceURL)
	if deleteSourceURL == "" {
		deleteSourceURL = strings.TrimSpace(target.URL)
	}
	out := items[:0]
	removed := false
	removedIDs := make([]string, 0, 1)
	for _, item := range items {
		itemSourceURL := strings.TrimSpace(item.SourceURL)
		if itemSourceURL == "" {
			itemSourceURL = strings.TrimSpace(item.URL)
		}
		if item.ID == id || (deleteSourceURL != "" && strings.EqualFold(itemSourceURL, deleteSourceURL)) {
			removed = true
			removedIDs = append(removedIDs, item.ID)
			continue
		}
		out = append(out, item)
	}
	if !removed {
		return errors.New("radio source not found")
	}
	if err := s.saveRadioSources(ctx, out); err != nil {
		return err
	}
	if len(removedIDs) > 0 {
		_, _ = s.client.UserRadioFavorite.Delete().Where(userradiofavorite.StationIDIn(removedIDs...)).Exec(ctx)
	}
	return nil
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
		item.GroupName = strings.TrimSpace(item.GroupName)
		if item.SourceURL == "" {
			item.SourceURL = item.URL
		}
		if item.GroupName == "" {
			item.GroupName = firstString(item.SourceURL, item.Name)
		}
		if item.ID == "" {
			item.ID = radioID(item.SourceURL)
		}
		item.StreamURL = radioSourceStreamURL(item.ID)
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

func (s *Service) markRadioSourceFavorites(ctx context.Context, userID int, items []models.RadioSource) ([]models.RadioSource, error) {
	favorites, err := s.radioFavoriteIDSet(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].Favorite = favorites[items[i].ID]
	}
	return items, nil
}

func (s *Service) markRadioStationFavorites(ctx context.Context, userID int, items []models.RadioStation) ([]models.RadioStation, error) {
	favorites, err := s.radioFavoriteIDSet(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].StreamURL = strings.TrimSpace(firstString(items[i].StreamURL, items[i].URL))
		items[i].Favorite = favorites[radioStationID(items[i])]
	}
	return items, nil
}

func (s *Service) radioFavoriteIDSet(ctx context.Context, userID int) (map[string]bool, error) {
	out := map[string]bool{}
	if userID <= 0 {
		return out, nil
	}
	items, err := s.client.UserRadioFavorite.Query().
		Where(userradiofavorite.HasUserWith(user.ID(userID))).
		Select(userradiofavorite.FieldStationID).
		All(ctx)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		out[item.StationID] = true
	}
	return out, nil
}

func (s *Service) normalizeRadioFavorite(ctx context.Context, station models.RadioStation) (models.RadioStation, error) {
	station.Name = strings.TrimSpace(station.Name)
	station.URL = strings.TrimSpace(firstString(station.StreamURL, station.URL))
	station.URL = s.resolveLocalRadioURL(ctx, station.URL)
	station.SourceURL = strings.TrimSpace(station.SourceURL)
	station.GroupName = strings.TrimSpace(station.GroupName)
	station.StreamURL = station.URL
	if station.ID = strings.TrimSpace(station.ID); station.ID == "" {
		station.ID = radioID(station.URL)
	}
	if station.ID == "" || station.Name == "" {
		return models.RadioStation{}, errors.New("radio station name is required")
	}
	if !validStreamLikeURL(station.URL) {
		return models.RadioStation{}, errors.New("valid http(s) radio stream url is required")
	}
	return station, nil
}

func (s *Service) resolveLocalRadioURL(ctx context.Context, value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "/api/radio/stream") {
		if parsed, err := url.Parse(value); err == nil {
			if raw := strings.TrimSpace(parsed.Query().Get("url")); raw != "" {
				return raw
			}
		}
	}
	if strings.HasPrefix(value, "/api/radio/sources/") && strings.HasSuffix(value, "/stream") {
		id := strings.TrimSuffix(strings.TrimPrefix(value, "/api/radio/sources/"), "/stream")
		if id != "" {
			if source, err := s.RadioSource(ctx, id); err == nil && source.URL != "" {
				return source.URL
			}
		}
	}
	return value
}

func radioFavoriteToStation(item *ent.UserRadioFavorite) models.RadioStation {
	return models.RadioStation{
		ID:        item.StationID,
		Name:      item.Name,
		URL:       item.URL,
		SourceURL: item.SourceURL,
		GroupName: item.GroupName,
		StreamURL: item.URL,
		Country:   item.Country,
		Tags:      item.Tags,
		Codec:     item.Codec,
		Bitrate:   item.Bitrate,
		Homepage:  item.Homepage,
		Favicon:   item.Favicon,
		Favorite:  true,
	}
}

func radioStationID(station models.RadioStation) string {
	if id := strings.TrimSpace(station.ID); id != "" {
		return id
	}
	return radioID(firstString(station.StreamURL, station.URL))
}

func defaultRadioSource(ctx context.Context) models.RadioSource {
	item := models.RadioSource{ID: "builtin-cliamp", Name: "cliamp", URL: resolvePlaylistURL(ctx, defaultCliampRadioURL), SourceURL: defaultCliampRadioURL, GroupName: "cliamp", Builtin: true}
	item.StreamURL = radioSourceStreamURL(item.ID)
	return item
}

func defaultRadioSources(ctx context.Context) []models.RadioSource {
	entries := radioPlaylistEntries(ctx, defaultCliampRadioURL)
	if len(entries) == 0 {
		entries = cliampFallbackRadioEntries()
	}
	if len(entries) == 0 {
		return []models.RadioSource{defaultRadioSource(ctx)}
	}
	out := make([]models.RadioSource, 0, len(entries))
	for index, entry := range entries {
		name := strings.TrimSpace(entry.Name)
		if name == "" {
			name = fmt.Sprintf("cliamp %d", index+1)
		}
		item := models.RadioSource{
			ID:        radioID(defaultCliampRadioURL + "|" + entry.URL + "|" + name),
			Name:      name,
			URL:       entry.URL,
			SourceURL: defaultCliampRadioURL,
			GroupName: "cliamp",
			Builtin:   true,
		}
		if index == 0 {
			item.ID = "builtin-cliamp"
		}
		item.StreamURL = radioSourceStreamURL(item.ID)
		out = append(out, item)
	}
	return out
}

func cliampFallbackRadioEntries() []radioPlaylistEntry {
	return []radioPlaylistEntry{
		{Name: "Lofi Stream", URL: "https://radio.cliamp.stream/lofi/stream"},
		{Name: "Synthwave Stream", URL: "https://radio.cliamp.stream/synthwave/stream"},
		{Name: "EDM Stream", URL: "https://radio.cliamp.stream/edm/stream"},
	}
}

func radioSourceStreamURL(id string) string {
	if strings.TrimSpace(id) == "" {
		return ""
	}
	return "/api/radio/sources/" + url.PathEscape(id) + "/stream"
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
	if strings.HasSuffix(lower, ".m3u8") {
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
	contentType := strings.ToLower(res.Header.Get("Content-Type"))
	if strings.Contains(contentType, "mpegurl") && res.ContentLength == 0 {
		return streamURL
	}
	scanner := bufio.NewScanner(io.LimitReader(res.Body, 256<<10))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "[") {
			continue
		}
		if strings.HasPrefix(strings.ToUpper(line), "#EXTINF:") {
			continue
		}
		if strings.HasPrefix(line, "#") {
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

type radioPlaylistEntry struct {
	Name string
	URL  string
}

func radioPlaylistEntries(ctx context.Context, playlistURL string) []radioPlaylistEntry {
	playlistURL = strings.TrimSpace(playlistURL)
	lower := strings.ToLower(strings.Split(playlistURL, "?")[0])
	isPLS := strings.HasSuffix(lower, ".pls")
	isM3U := strings.HasSuffix(lower, ".m3u") || strings.HasSuffix(lower, ".m3u8")
	if !isPLS && !isM3U {
		return nil
	}
	if strings.HasSuffix(lower, ".m3u8") {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, playlistURL, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", radioUserAgent)
	res, err := radioHTTPClient.Do(req)
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil
	}
	baseURL, _ := url.Parse(playlistURL)
	reader := io.LimitReader(res.Body, 4<<20)
	var entries []radioPlaylistEntry
	if isPLS {
		entries = parseRadioPLS(ctx, reader, baseURL)
	} else {
		entries = parseRadioM3U(ctx, reader, baseURL)
	}
	if len(entries) > 200 {
		return entries[:200]
	}
	return entries
}

func parseRadioPLS(ctx context.Context, r io.Reader, baseURL *url.URL) []radioPlaylistEntry {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	titles := map[int]string{}
	files := map[int]string{}
	order := []int{}
	for scanner.Scan() {
		line := strings.TrimPrefix(scanner.Text(), "\xef\xbb\xbf")
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "[") || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.ToLower(strings.TrimSpace(key))
		value = strings.TrimSpace(value)
		if strings.HasPrefix(key, "file") {
			idx, err := strconv.Atoi(strings.TrimPrefix(key, "file"))
			if err != nil || idx <= 0 {
				continue
			}
			if _, exists := files[idx]; !exists {
				order = append(order, idx)
			}
			files[idx] = value
			continue
		}
		if strings.HasPrefix(key, "title") {
			idx, err := strconv.Atoi(strings.TrimPrefix(key, "title"))
			if err == nil && idx > 0 {
				titles[idx] = value
			}
		}
	}
	if len(order) == 0 {
		for idx := range files {
			order = append(order, idx)
		}
	}
	sort.Ints(order)
	entries := make([]radioPlaylistEntry, 0, len(order))
	for _, idx := range order {
		entryURL := resolveRadioPlaylistEntryURL(files[idx], baseURL)
		if validStreamLikeURL(entryURL) {
			entries = append(entries, radioPlaylistEntry{Name: stripPLSMirrorSuffix(titles[idx]), URL: resolvePlaylistURL(ctx, entryURL)})
		}
	}
	if allRadioPlaylistEntriesAreStreams(entries) && len(entries) > 1 {
		return entries[:1]
	}
	return entries
}

func allRadioPlaylistEntriesAreStreams(entries []radioPlaylistEntry) bool {
	if len(entries) == 0 {
		return false
	}
	for _, entry := range entries {
		if !validStreamLikeURL(entry.URL) {
			return false
		}
	}
	return true
}

func stripPLSMirrorSuffix(value string) string {
	value = strings.TrimSpace(value)
	if i := strings.LastIndex(value, "(#"); i >= 0 && strings.HasSuffix(value, ")") {
		return strings.TrimRight(value[:i], " :")
	}
	return value
}

func parseRadioM3U(ctx context.Context, r io.Reader, baseURL *url.URL) []radioPlaylistEntry {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	var entries []radioPlaylistEntry
	var title string
	for scanner.Scan() {
		line := strings.TrimPrefix(scanner.Text(), "\xef\xbb\xbf")
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "[") {
			continue
		}
		upper := strings.ToUpper(line)
		if strings.HasPrefix(upper, "#EXT-X-") {
			return nil
		}
		if strings.HasPrefix(upper, "#EXTM3U") {
			continue
		}
		if strings.HasPrefix(upper, "#EXTINF:") {
			title = radioExtinfTitle(line)
			continue
		}
		if strings.HasPrefix(line, "#") {
			continue
		}
		entryURL := resolveRadioPlaylistEntryURL(line, baseURL)
		if validStreamLikeURL(entryURL) {
			entries = append(entries, radioPlaylistEntry{Name: title, URL: resolvePlaylistURL(ctx, entryURL)})
			title = ""
		}
	}
	return entries
}

func radioExtinfTitle(line string) string {
	_, value, ok := strings.Cut(line, ",")
	if !ok {
		return ""
	}
	title := strings.TrimSpace(value)
	if unquoted, err := strconv.Unquote(title); err == nil {
		return strings.TrimSpace(unquoted)
	}
	return title
}

func resolveRadioPlaylistEntryURL(value string, baseURL *url.URL) string {
	value = strings.TrimSpace(value)
	if validStreamLikeURL(value) || baseURL == nil {
		return value
	}
	ref, err := url.Parse(value)
	if err != nil {
		return value
	}
	return baseURL.ResolveReference(ref).String()
}

func validStreamLikeURL(value string) bool {
	u, err := url.Parse(strings.TrimSpace(value))
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func radioID(value string) string {
	sum := sha1.Sum([]byte(strings.TrimSpace(strings.ToLower(value))))
	return hex.EncodeToString(sum[:10])
}

func (s *Service) LibrarySources(ctx context.Context) []models.LibrarySource {
	sources, _ := s.NetworkSources(ctx)
	configured := map[string]int{}
	for _, source := range sources {
		configured[source.Provider]++
	}
	status := func(provider string) string {
		if configured[provider] > 0 {
			return "configured"
		}
		if provider == "spotify" {
			return "needs-oauth"
		}
		return "available"
	}
	return []models.LibrarySource{
		{ID: "local", Name: "Local Library", Kind: "local", Status: "connected", Description: "Scanned audio files stored in the Lark library directory."},
		{ID: "navidrome", Name: "Navidrome / Subsonic", Kind: "network", Status: status("navidrome"), Description: "Connect with a Subsonic-compatible server URL, username and password."},
		{ID: "plex", Name: "Plex", Kind: "network", Status: status("plex"), Description: "Connect to a Plex Media Server with a server URL and X-Plex-Token."},
		{ID: "jellyfin", Name: "Jellyfin", Kind: "network", Status: status("jellyfin"), Description: "Connect with a Jellyfin server URL and an API token or username/password."},
		{ID: "spotify", Name: "Spotify", Kind: "network", Status: status("spotify"), Description: "Spotify needs an OAuth + playback handoff flow; it is listed here but not yet enabled for direct playback."},
	}
}
