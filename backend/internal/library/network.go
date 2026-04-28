package library

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/appsetting"
	"lark/backend/internal/models"
)

const networkSourcesSettingKey = "network_sources"

var networkHTTPClient = &http.Client{Timeout: 15 * time.Second}

func (s *Service) NetworkSources(ctx context.Context) ([]models.NetworkSource, error) {
	items, err := s.storedNetworkSources(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.NetworkSource, 0, len(items))
	for _, item := range items {
		out = append(out, sanitizeNetworkSource(item))
	}
	return out, nil
}

func (s *Service) UpsertNetworkSource(ctx context.Context, item models.NetworkSource) (models.NetworkSource, error) {
	item.Provider = normalizeNetworkProvider(item.Provider)
	item.Name = strings.TrimSpace(item.Name)
	item.BaseURL = strings.TrimRight(strings.TrimSpace(item.BaseURL), "/")
	item.Username = strings.TrimSpace(item.Username)
	item.Password = strings.TrimSpace(item.Password)
	item.Token = strings.TrimSpace(item.Token)
	if item.Provider == "" {
		return models.NetworkSource{}, errors.New("network provider is required")
	}
	if item.Provider == "spotify" {
		return models.NetworkSource{}, errors.New("spotify requires an OAuth playback flow and is not configurable from this direct-connect form yet")
	}
	if item.Name == "" {
		item.Name = networkProviderName(item.Provider)
	}
	if !validBaseURL(item.BaseURL) {
		return models.NetworkSource{}, errors.New("valid http(s) base url is required")
	}
	if item.Provider == "navidrome" && (item.Username == "" || item.Password == "") {
		return models.NetworkSource{}, errors.New("navidrome requires username and password")
	}
	if (item.Provider == "plex" || item.Provider == "jellyfin") && item.Token == "" && (item.Username == "" || item.Password == "") {
		return models.NetworkSource{}, errors.New("token or username/password is required")
	}
	if item.ID == "" {
		item.ID = networkSourceID(item.Provider, item.BaseURL, item.Username, item.Name)
	}
	item.Status = "configured"
	item.LastError = ""

	items, err := s.storedNetworkSources(ctx)
	if err != nil {
		return models.NetworkSource{}, err
	}
	replaced := false
	for i, existing := range items {
		if existing.ID == item.ID {
			if item.Password == "" {
				item.Password = existing.Password
			}
			if item.Token == "" {
				item.Token = existing.Token
			}
			items[i] = item
			replaced = true
			break
		}
	}
	if !replaced {
		items = append(items, item)
	}
	if err := s.saveNetworkSources(ctx, items); err != nil {
		return models.NetworkSource{}, err
	}
	return sanitizeNetworkSource(item), nil
}

func (s *Service) DeleteNetworkSource(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("network source id is required")
	}
	items, err := s.storedNetworkSources(ctx)
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
		return errors.New("network source not found")
	}
	return s.saveNetworkSources(ctx, out)
}

func (s *Service) TestNetworkSource(ctx context.Context, id string) (models.NetworkSource, error) {
	source, err := s.networkSource(ctx, id)
	if err != nil {
		return models.NetworkSource{}, err
	}
	if err := testNetworkSource(ctx, source); err != nil {
		source.Status = "error"
		source.LastError = err.Error()
		_ = s.updateNetworkSourceStatus(ctx, source)
		return sanitizeNetworkSource(source), err
	}
	source.Status = "connected"
	source.LastError = ""
	if err := s.updateNetworkSourceStatus(ctx, source); err != nil {
		return models.NetworkSource{}, err
	}
	return sanitizeNetworkSource(source), nil
}

func (s *Service) SearchNetworkTracks(ctx context.Context, sourceID, query string, limit int) ([]models.NetworkTrack, error) {
	source, err := s.networkSource(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return []models.NetworkTrack{}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	var tracks []models.NetworkTrack
	switch source.Provider {
	case "navidrome":
		tracks, err = searchNavidrome(ctx, source, query, limit)
	case "jellyfin":
		tracks, err = searchJellyfin(ctx, source, query, limit)
	case "plex":
		tracks, err = searchPlex(ctx, source, query, limit)
	default:
		err = fmt.Errorf("%s search is not available", source.Provider)
	}
	if err != nil {
		return nil, err
	}
	for i := range tracks {
		tracks[i].SourceID = source.ID
		tracks[i].Provider = source.Provider
		tracks[i].StreamURL = fmt.Sprintf("/api/network/sources/%s/tracks/%s/stream", url.PathEscape(source.ID), url.PathEscape(tracks[i].ID))
	}
	return tracks, nil
}

func (s *Service) NetworkTrackStreamURL(ctx context.Context, sourceID, trackID string) (string, error) {
	source, err := s.networkSource(ctx, sourceID)
	if err != nil {
		return "", err
	}
	trackID = strings.TrimSpace(trackID)
	if trackID == "" {
		return "", errors.New("network track id is required")
	}
	switch source.Provider {
	case "navidrome":
		return navidromeURL(source, "stream.view", url.Values{"id": {trackID}}), nil
	case "jellyfin":
		token, err := jellyfinToken(ctx, source)
		if err != nil {
			return "", err
		}
		return source.BaseURL + path.Join("/", "Items", trackID, "Download") + "?api_key=" + url.QueryEscape(token), nil
	case "plex":
		partKey, err := base64.RawURLEncoding.DecodeString(trackID)
		if err != nil {
			return "", err
		}
		return source.BaseURL + string(partKey) + "?X-Plex-Token=" + url.QueryEscape(source.Token), nil
	default:
		return "", fmt.Errorf("%s streaming is not available", source.Provider)
	}
}

func (s *Service) storedNetworkSources(ctx context.Context) ([]models.NetworkSource, error) {
	setting, err := s.client.AppSetting.Query().Where(appsetting.Key(networkSourcesSettingKey)).Only(ctx)
	if ent.IsNotFound(err) {
		return []models.NetworkSource{}, nil
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(setting.Value) == "" {
		return []models.NetworkSource{}, nil
	}
	var items []models.NetworkSource
	if err := json.Unmarshal([]byte(setting.Value), &items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) saveNetworkSources(ctx context.Context, items []models.NetworkSource) error {
	clean := make([]models.NetworkSource, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		item.Provider = normalizeNetworkProvider(item.Provider)
		item.Name = strings.TrimSpace(item.Name)
		item.BaseURL = strings.TrimRight(strings.TrimSpace(item.BaseURL), "/")
		item.Username = strings.TrimSpace(item.Username)
		item.Password = strings.TrimSpace(item.Password)
		item.Token = strings.TrimSpace(item.Token)
		if item.Provider == "" || item.Name == "" || item.BaseURL == "" {
			continue
		}
		if item.ID == "" {
			item.ID = networkSourceID(item.Provider, item.BaseURL, item.Username, item.Name)
		}
		if seen[item.ID] {
			continue
		}
		clean = append(clean, item)
		seen[item.ID] = true
	}
	data, err := json.Marshal(clean)
	if err != nil {
		return err
	}
	return s.setSetting(ctx, networkSourcesSettingKey, string(data))
}

func (s *Service) networkSource(ctx context.Context, id string) (models.NetworkSource, error) {
	items, err := s.storedNetworkSources(ctx)
	if err != nil {
		return models.NetworkSource{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return models.NetworkSource{}, errors.New("network source not found")
}

func (s *Service) updateNetworkSourceStatus(ctx context.Context, source models.NetworkSource) error {
	items, err := s.storedNetworkSources(ctx)
	if err != nil {
		return err
	}
	for i := range items {
		if items[i].ID == source.ID {
			items[i].Status = source.Status
			items[i].LastError = source.LastError
			return s.saveNetworkSources(ctx, items)
		}
	}
	return errors.New("network source not found")
}

func sanitizeNetworkSource(item models.NetworkSource) models.NetworkSource {
	item.HasPassword = item.Password != ""
	item.HasToken = item.Token != ""
	item.Password = ""
	item.Token = ""
	if item.Status == "" {
		item.Status = "configured"
	}
	return item
}

func testNetworkSource(ctx context.Context, source models.NetworkSource) error {
	switch source.Provider {
	case "navidrome":
		var out struct {
			SubsonicResponse struct {
				Status string         `json:"status"`
				Error  *subsonicError `json:"error"`
			} `json:"subsonic-response"`
		}
		return subsonicGet(ctx, source, "ping.view", nil, &out)
	case "jellyfin":
		_, err := jellyfinUserID(ctx, source)
		return err
	case "plex":
		var out struct {
			MediaContainer struct {
				FriendlyName string `json:"friendlyName"`
			} `json:"MediaContainer"`
		}
		return plexGet(ctx, source, "/", nil, &out)
	default:
		return fmt.Errorf("%s is not supported", source.Provider)
	}
}

type subsonicError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type subsonicSong struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Album    string `json:"album"`
	Year     int    `json:"year"`
	CoverArt string `json:"coverArt"`
	Duration int    `json:"duration"`
}

func searchNavidrome(ctx context.Context, source models.NetworkSource, query string, limit int) ([]models.NetworkTrack, error) {
	var out struct {
		SubsonicResponse struct {
			SearchResult3 struct {
				Song []subsonicSong `json:"song"`
			} `json:"searchResult3"`
		} `json:"subsonic-response"`
	}
	if err := subsonicGet(ctx, source, "search3.view", url.Values{"query": {query}, "songCount": {fmt.Sprint(limit)}, "albumCount": {"0"}, "artistCount": {"0"}}, &out); err != nil {
		return nil, err
	}
	tracks := make([]models.NetworkTrack, 0, len(out.SubsonicResponse.SearchResult3.Song))
	for _, song := range out.SubsonicResponse.SearchResult3.Song {
		if strings.TrimSpace(song.ID) == "" {
			continue
		}
		cover := ""
		if song.CoverArt != "" {
			cover = navidromeURL(source, "getCoverArt.view", url.Values{"id": {song.CoverArt}})
		}
		tracks = append(tracks, models.NetworkTrack{
			ID:              song.ID,
			Title:           firstString(song.Title, "Unknown Title"),
			Artist:          firstString(song.Artist, "Unknown Artist"),
			Album:           strings.TrimSpace(song.Album),
			Year:            song.Year,
			DurationSeconds: float64(song.Duration),
			CoverURL:        cover,
		})
	}
	return tracks, nil
}

func subsonicGet(ctx context.Context, source models.NetworkSource, endpoint string, params url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, navidromeURL(source, endpoint, params), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", radioUserAgent)
	res, err := networkHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("navidrome: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("navidrome: http status %s", res.Status)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 10<<20))
	if err != nil {
		return err
	}
	var env struct {
		SubsonicResponse struct {
			Status string         `json:"status"`
			Error  *subsonicError `json:"error"`
		} `json:"subsonic-response"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return err
	}
	if env.SubsonicResponse.Status != "" && env.SubsonicResponse.Status != "ok" {
		if env.SubsonicResponse.Error != nil {
			return fmt.Errorf("navidrome: %s", env.SubsonicResponse.Error.Message)
		}
		return fmt.Errorf("navidrome: status %s", env.SubsonicResponse.Status)
	}
	return json.Unmarshal(body, out)
}

func navidromeURL(source models.NetworkSource, endpoint string, params url.Values) string {
	if params == nil {
		params = url.Values{}
	}
	saltBytes := make([]byte, 8)
	if _, err := io.ReadFull(rand.Reader, saltBytes); err != nil {
		saltBytes = []byte(fmt.Sprintf("%d", time.Now().UnixNano()))
	}
	salt := hex.EncodeToString(saltBytes)
	hash := md5.Sum([]byte(source.Password + salt))
	params.Set("u", source.Username)
	params.Set("t", hex.EncodeToString(hash[:]))
	params.Set("s", salt)
	params.Set("v", "1.16.1")
	params.Set("c", "lark")
	params.Set("f", "json")
	return source.BaseURL + "/rest/" + strings.TrimLeft(endpoint, "/") + "?" + params.Encode()
}

type jellyfinItem struct {
	ID             string   `json:"Id"`
	Name           string   `json:"Name"`
	Album          string   `json:"Album"`
	AlbumArtist    string   `json:"AlbumArtist"`
	Artists        []string `json:"Artists"`
	ProductionYear int      `json:"ProductionYear"`
	RunTimeTicks   int64    `json:"RunTimeTicks"`
}

func searchJellyfin(ctx context.Context, source models.NetworkSource, query string, limit int) ([]models.NetworkTrack, error) {
	userID, err := jellyfinUserID(ctx, source)
	if err != nil {
		return nil, err
	}
	var out struct {
		Items []jellyfinItem `json:"Items"`
	}
	params := url.Values{
		"userId":                 {userID},
		"recursive":              {"true"},
		"includeItemTypes":       {"Audio"},
		"searchTerm":             {query},
		"fields":                 {"RunTimeTicks,ProductionYear"},
		"enableTotalRecordCount": {"false"},
		"limit":                  {fmt.Sprint(limit)},
	}
	if err := jellyfinGet(ctx, source, "/Users/"+url.PathEscape(userID)+"/Items", params, &out); err != nil {
		return nil, err
	}
	token, _ := jellyfinToken(ctx, source)
	tracks := make([]models.NetworkTrack, 0, len(out.Items))
	for _, item := range out.Items {
		artist := item.AlbumArtist
		if artist == "" && len(item.Artists) > 0 {
			artist = item.Artists[0]
		}
		cover := ""
		if token != "" {
			cover = source.BaseURL + path.Join("/", "Items", item.ID, "Images", "Primary") + "?api_key=" + url.QueryEscape(token)
		}
		tracks = append(tracks, models.NetworkTrack{
			ID:              item.ID,
			Title:           firstString(item.Name, "Unknown Title"),
			Artist:          firstString(artist, "Unknown Artist"),
			Album:           item.Album,
			Year:            item.ProductionYear,
			DurationSeconds: float64(item.RunTimeTicks) / 10_000_000,
			CoverURL:        cover,
		})
	}
	return tracks, nil
}

func jellyfinUserID(ctx context.Context, source models.NetworkSource) (string, error) {
	var out struct {
		ID string `json:"Id"`
	}
	if err := jellyfinGet(ctx, source, "/Users/Me", nil, &out); err != nil {
		return "", err
	}
	if out.ID == "" {
		return "", errors.New("jellyfin: current user id missing")
	}
	return out.ID, nil
}

func jellyfinToken(ctx context.Context, source models.NetworkSource) (string, error) {
	if source.Token != "" {
		return source.Token, nil
	}
	if source.Username == "" || source.Password == "" {
		return "", errors.New("jellyfin token or username/password required")
	}
	body, _ := json.Marshal(map[string]string{"Username": source.Username, "Pw": source.Password})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, source.BaseURL+"/Users/AuthenticateByName", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Emby-Authorization", `MediaBrowser Client="Lark", Device="Browser", DeviceId="lark", Version="1.0"`)
	res, err := networkHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("jellyfin: auth: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("jellyfin: auth status %s", res.Status)
	}
	var out struct {
		AccessToken string `json:"AccessToken"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&out); err != nil {
		return "", err
	}
	if out.AccessToken == "" {
		return "", errors.New("jellyfin: missing access token")
	}
	return out.AccessToken, nil
}

func jellyfinGet(ctx context.Context, source models.NetworkSource, p string, params url.Values, out any) error {
	token, err := jellyfinToken(ctx, source)
	if err != nil {
		return err
	}
	u := source.BaseURL + p
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Emby-Token", token)
	req.Header.Set("X-Emby-Authorization", `MediaBrowser Client="Lark", Device="Browser", DeviceId="lark", Version="1.0"`)
	res, err := networkHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("jellyfin: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("jellyfin: http status %s", res.Status)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 10<<20)).Decode(out)
}

type plexTrack struct {
	RatingKey        string `json:"ratingKey"`
	Title            string `json:"title"`
	GrandparentTitle string `json:"grandparentTitle"`
	ParentTitle      string `json:"parentTitle"`
	Year             int    `json:"year"`
	Duration         int    `json:"duration"`
	Thumb            string `json:"thumb"`
	Media            []struct {
		Part []struct {
			Key string `json:"key"`
		} `json:"Part"`
	} `json:"Media"`
}

func searchPlex(ctx context.Context, source models.NetworkSource, query string, limit int) ([]models.NetworkTrack, error) {
	var out struct {
		MediaContainer struct {
			Metadata []plexTrack `json:"Metadata"`
		} `json:"MediaContainer"`
	}
	params := url.Values{"query": {query}, "type": {"10"}, "limit": {fmt.Sprint(limit)}}
	if err := plexGet(ctx, source, "/library/search", params, &out); err != nil {
		return nil, err
	}
	tracks := make([]models.NetworkTrack, 0, len(out.MediaContainer.Metadata))
	for _, item := range out.MediaContainer.Metadata {
		partKey := ""
		if len(item.Media) > 0 && len(item.Media[0].Part) > 0 {
			partKey = item.Media[0].Part[0].Key
		}
		if partKey == "" {
			continue
		}
		cover := ""
		if item.Thumb != "" {
			cover = source.BaseURL + item.Thumb + "?X-Plex-Token=" + url.QueryEscape(source.Token)
		}
		tracks = append(tracks, models.NetworkTrack{
			ID:              base64.RawURLEncoding.EncodeToString([]byte(partKey)),
			Title:           firstString(item.Title, "Unknown Title"),
			Artist:          firstString(item.GrandparentTitle, "Unknown Artist"),
			Album:           item.ParentTitle,
			Year:            item.Year,
			DurationSeconds: float64(item.Duration) / 1000,
			CoverURL:        cover,
		})
	}
	return tracks, nil
}

func plexGet(ctx context.Context, source models.NetworkSource, p string, params url.Values, out any) error {
	if source.Token == "" {
		return errors.New("plex token is required")
	}
	if params == nil {
		params = url.Values{}
	}
	params.Set("X-Plex-Token", source.Token)
	u := source.BaseURL + p + "?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Plex-Product", "Lark")
	req.Header.Set("X-Plex-Client-Identifier", "lark")
	res, err := networkHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("plex: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized {
		return errors.New("plex: token invalid or expired")
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("plex: http status %s", res.Status)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 10<<20)).Decode(out)
}

func normalizeNetworkProvider(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "subsonic", "navidrome":
		return "navidrome"
	case "jellyfin":
		return "jellyfin"
	case "plex":
		return "plex"
	case "spotify":
		return "spotify"
	default:
		return ""
	}
}

func networkProviderName(provider string) string {
	switch provider {
	case "navidrome":
		return "Navidrome"
	case "jellyfin":
		return "Jellyfin"
	case "plex":
		return "Plex"
	case "spotify":
		return "Spotify"
	default:
		return "Network Library"
	}
}

func networkSourceID(parts ...string) string {
	sum := sha1.Sum([]byte(strings.ToLower(strings.Join(parts, "|"))))
	return hex.EncodeToString(sum[:10])
}

func validBaseURL(value string) bool {
	u, err := url.Parse(strings.TrimSpace(value))
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}
