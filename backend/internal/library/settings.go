package library

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"lark/backend/ent"
	"lark/backend/ent/appsetting"
	"lark/backend/internal/models"
)

func (s *Service) GetScrobblingSettings(ctx context.Context, userID int) (models.ScrobblingSettings, error) {
	if userID == 0 {
		return models.ScrobblingSettings{}, ErrUnauthenticated
	}
	settings := defaultScrobblingSettings()
	if s.client == nil {
		return settings, nil
	}
	var stored scrobblingSettingsRecord
	if ok, err := s.scrobblingRecord(ctx, userID, &stored); err != nil {
		return models.ScrobblingSettings{}, err
	} else if ok {
		settings.Enabled = stored.Enabled
		settings.Provider = normalizeScrobblingProvider(stored.Provider)
		settings.SubmitNow = stored.SubmitNow
		settings.MinSeconds = normalizeScrobblingMinSeconds(stored.MinSeconds)
		settings.PercentGate = normalizeScrobblingPercentGate(stored.PercentGate)
		settings.HasToken = strings.TrimSpace(stored.Token) != ""
		settings.TokenHint = scrobblingTokenHint(stored.Token)
	}
	return settings, nil
}
func (s *Service) GetUISoundSettings(ctx context.Context, userID int) (models.UISoundSettings, error) {
	if userID == 0 {
		return models.UISoundSettings{}, ErrUnauthenticated
	}
	settings := defaultUISoundSettings()
	if s.client == nil {
		return settings, nil
	}
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(uiSoundSettingsKey(userID))).Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return settings, nil
		}
		return models.UISoundSettings{}, err
	}
	if strings.TrimSpace(item.Value) == "true" || strings.TrimSpace(item.Value) == "false" {
		settings.Enabled = item.Value == "true"
		return settings, nil
	}
	_ = json.Unmarshal([]byte(item.Value), &settings)
	settings.Volume = normalizeUISoundVolume(settings.Volume)
	return settings, nil
}
func (s *Service) SaveUISoundSettings(ctx context.Context, userID int, settings models.UISoundSettings) (models.UISoundSettings, error) {
	if userID == 0 {
		return models.UISoundSettings{}, ErrUnauthenticated
	}
	if s.client == nil {
		return models.UISoundSettings{}, errors.New("database is required")
	}
	settings.Volume = normalizeUISoundVolume(settings.Volume)
	data, err := json.Marshal(settings)
	if err != nil {
		return models.UISoundSettings{}, err
	}
	if err := s.setSetting(ctx, uiSoundSettingsKey(userID), string(data)); err != nil {
		return models.UISoundSettings{}, err
	}
	return s.GetUISoundSettings(ctx, userID)
}
func (s *Service) GetPlaybackHistorySettings(ctx context.Context, userID int) (models.PlaybackHistorySettings, error) {
	if userID == 0 {
		return models.PlaybackHistorySettings{}, ErrUnauthenticated
	}
	settings := models.PlaybackHistorySettings{SeparateByDevice: false}
	if s.client == nil {
		return settings, nil
	}
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(playbackHistorySettingsKey(userID))).Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return settings, nil
		}
		return models.PlaybackHistorySettings{}, err
	}
	settings.SeparateByDevice = item.Value == "true"
	return settings, nil
}
func (s *Service) SavePlaybackHistorySettings(ctx context.Context, userID int, settings models.PlaybackHistorySettings) (models.PlaybackHistorySettings, error) {
	if userID == 0 {
		return models.PlaybackHistorySettings{}, ErrUnauthenticated
	}
	if s.client == nil {
		return models.PlaybackHistorySettings{}, errors.New("database is required")
	}
	if err := s.setSetting(ctx, playbackHistorySettingsKey(userID), strconv.FormatBool(settings.SeparateByDevice)); err != nil {
		return models.PlaybackHistorySettings{}, err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	return s.GetPlaybackHistorySettings(ctx, userID)
}
func (s *Service) GetUserPreferences(ctx context.Context, userID int) (models.UserPreferences, error) {
	if userID == 0 {
		return models.UserPreferences{}, ErrUnauthenticated
	}
	preferences := defaultUserPreferences()
	if s.client == nil {
		return preferences, nil
	}
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(userPreferencesKey(userID))).Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return preferences, nil
		}
		return models.UserPreferences{}, err
	}
	stored := defaultUserPreferences()
	if err := json.Unmarshal([]byte(item.Value), &stored); err != nil {
		return preferences, nil
	}
	return normalizeUserPreferences(stored), nil
}
func (s *Service) SaveUserPreferences(ctx context.Context, userID int, preferences models.UserPreferences) (models.UserPreferences, error) {
	if userID == 0 {
		return models.UserPreferences{}, ErrUnauthenticated
	}
	if s.client == nil {
		return models.UserPreferences{}, errors.New("database is required")
	}
	preferences = normalizeUserPreferences(preferences)
	data, err := json.Marshal(preferences)
	if err != nil {
		return models.UserPreferences{}, err
	}
	if err := s.setSetting(ctx, userPreferencesKey(userID), string(data)); err != nil {
		return models.UserPreferences{}, err
	}
	return s.GetUserPreferences(ctx, userID)
}
func (s *Service) SaveScrobblingSettings(ctx context.Context, userID int, settings models.ScrobblingSettings, token string) (models.ScrobblingSettings, error) {
	if userID == 0 {
		return models.ScrobblingSettings{}, ErrUnauthenticated
	}
	if s.client == nil {
		return models.ScrobblingSettings{}, errors.New("database is required")
	}
	existing := scrobblingSettingsRecord{}
	_, _ = s.scrobblingRecord(ctx, userID, &existing)
	cleanToken := strings.TrimSpace(token)
	if cleanToken == "" {
		cleanToken = existing.Token
	}
	record := scrobblingSettingsRecord{
		Enabled:     settings.Enabled,
		Provider:    normalizeScrobblingProvider(settings.Provider),
		Token:       cleanToken,
		SubmitNow:   settings.SubmitNow,
		MinSeconds:  normalizeScrobblingMinSeconds(settings.MinSeconds),
		PercentGate: normalizeScrobblingPercentGate(settings.PercentGate),
	}
	data, err := json.Marshal(record)
	if err != nil {
		return models.ScrobblingSettings{}, err
	}
	if err := s.setSetting(ctx, scrobblingKey(userID), string(data)); err != nil {
		return models.ScrobblingSettings{}, err
	}
	return s.GetScrobblingSettings(ctx, userID)
}
func (s *Service) GetSettings(ctx context.Context) (models.Settings, error) {
	settings := models.Settings{
		Language:                     "zh-CN",
		Theme:                        "deep-space",
		SleepTimerMins:               0,
		LibraryPath:                  s.libraryDir,
		NeteaseFallback:              true,
		RegistrationEnabled:          false,
		DLNACastEnabled:              false,
		DLNALibraryEnabled:           false,
		DLNAServerName:               "Lark",
		PlaybackSourceTTLHours:       defaultPlaybackSourceTTLHours,
		PlaybackHistoryRetentionDays: defaultPlaybackHistoryRetentionDays,
		LyricsFontSize:               0,
		MetadataGrouping:             false,
		LibraryTagWriteback:          false,
		LibraryPathMetadataAssist:    false,
		SmartPlaylistsEnabled:        false,
		SharingEnabled:               false,
		SubsonicServerEnabled:        false,
		TranscodePolicy:              "auto",
		TranscodeQualityKbps:         192,
	}
	items, err := s.client.AppSetting.Query().All(ctx)
	if err != nil {
		return settings, err
	}
	for _, item := range items {
		switch item.Key {
		case "language":
			settings.Language = item.Value
		case "theme":
			settings.Theme = item.Value
		case "sleep_timer_mins":
			settings.SleepTimerMins, _ = strconv.Atoi(item.Value)
		case "netease_fallback":
			settings.NeteaseFallback = item.Value != "false"
		case settingRegistrationEnabled:
			settings.RegistrationEnabled = item.Value == "true"
		case "diagnostics_enabled":
			settings.DiagnosticsEnabled = item.Value == "true"
		case "dlna_cast_enabled":
			settings.DLNACastEnabled = item.Value == "true"
		case "dlna_library_enabled":
			settings.DLNALibraryEnabled = item.Value == "true"
		case "dlna_server_name":
			settings.DLNAServerName = item.Value
		case "dlna_media_base_url":
			settings.DLNAMediaBaseURL = item.Value
		case "dlna_allowed_ips":
			settings.DLNAAllowedIPs = item.Value
		case "dlna_interfaces":
			settings.DLNAInterfaces = item.Value
		case "playback_source_ttl_hours":
			settings.PlaybackSourceTTLHours, _ = strconv.Atoi(item.Value)
		case "playback_history_retention_days":
			settings.PlaybackHistoryRetentionDays, _ = strconv.Atoi(item.Value)
		case "web_font_family":
			settings.WebFontFamily = item.Value
		case "web_font_url":
			settings.WebFontURL = item.Value
		case "lyrics_auto_save_to_song_dir":
			settings.LyricsAutoSaveToSongDir = item.Value == "true"
		case "lyrics_font_family":
			settings.LyricsFontFamily = item.Value
		case "lyrics_font_url":
			settings.LyricsFontURL = item.Value
		case "lyrics_font_size":
			settings.LyricsFontSize, _ = strconv.Atoi(item.Value)
		case "metadata_grouping":
			settings.MetadataGrouping = item.Value == "true"
		case "library_tag_writeback":
			settings.LibraryTagWriteback = item.Value == "true"
		case "library_path_metadata_assist":
			settings.LibraryPathMetadataAssist = item.Value == "true"
		case "smart_playlists_enabled":
			settings.SmartPlaylistsEnabled = item.Value == "true"
		case "sharing_enabled":
			settings.SharingEnabled = item.Value == "true"
		case "subsonic_server_enabled":
			settings.SubsonicServerEnabled = item.Value == "true"
		case "transcode_policy":
			settings.TranscodePolicy = item.Value
		case "transcode_quality_kbps":
			settings.TranscodeQualityKbps, _ = strconv.Atoi(item.Value)
		}
	}
	settings.PlaybackSourceTTLHours = normalizePlaybackSourceTTLHours(settings.PlaybackSourceTTLHours)
	settings.PlaybackHistoryRetentionDays = normalizePlaybackHistoryRetentionDays(settings.PlaybackHistoryRetentionDays)
	settings.LyricsFontFamily = sanitizeFontFamily(settings.LyricsFontFamily)
	settings.LyricsFontURL = sanitizeFontURL(settings.LyricsFontURL)
	if settings.LyricsFontURL == "" {
		settings.LyricsFontFamily = ""
	}
	settings.LyricsFontSize = normalizeLyricsFontSize(settings.LyricsFontSize)
	settings.TranscodePolicy = normalizeTranscodePolicy(settings.TranscodePolicy)
	settings.TranscodeQualityKbps = normalizeTranscodeQuality(settings.TranscodeQualityKbps)
	settings.DLNAServerName = normalizeDLNAServerName(settings.DLNAServerName)
	settings.DLNAMediaBaseURL = normalizeDLNAMediaBaseURL(settings.DLNAMediaBaseURL)
	settings.DLNAAllowedIPs = normalizeCSVSetting(settings.DLNAAllowedIPs)
	settings.DLNAInterfaces = normalizeCSVSetting(settings.DLNAInterfaces)
	return settings, nil
}
func (s *Service) SaveSettings(ctx context.Context, settings models.Settings) (models.Settings, error) {
	if settings.Language == "" {
		settings.Language = "zh-CN"
	}
	if settings.Theme == "" {
		settings.Theme = "deep-space"
	}
	settings.WebFontFamily = sanitizeFontFamily(settings.WebFontFamily)
	settings.WebFontURL = sanitizeFontURL(settings.WebFontURL)
	settings.LyricsFontFamily = sanitizeFontFamily(settings.LyricsFontFamily)
	settings.LyricsFontURL = sanitizeFontURL(settings.LyricsFontURL)
	if settings.LyricsFontURL == "" {
		settings.LyricsFontFamily = ""
	}
	settings.LyricsFontSize = normalizeLyricsFontSize(settings.LyricsFontSize)
	settings.PlaybackSourceTTLHours = normalizePlaybackSourceTTLHours(settings.PlaybackSourceTTLHours)
	settings.PlaybackHistoryRetentionDays = normalizePlaybackHistoryRetentionDays(settings.PlaybackHistoryRetentionDays)
	settings.TranscodePolicy = normalizeTranscodePolicy(settings.TranscodePolicy)
	settings.TranscodeQualityKbps = normalizeTranscodeQuality(settings.TranscodeQualityKbps)
	settings.DLNAServerName = normalizeDLNAServerName(settings.DLNAServerName)
	settings.DLNAMediaBaseURL = normalizeDLNAMediaBaseURL(settings.DLNAMediaBaseURL)
	settings.DLNAAllowedIPs = normalizeCSVSetting(settings.DLNAAllowedIPs)
	settings.DLNAInterfaces = normalizeCSVSetting(settings.DLNAInterfaces)
	pairs := map[string]string{
		"language":                        settings.Language,
		"theme":                           settings.Theme,
		"sleep_timer_mins":                strconv.Itoa(settings.SleepTimerMins),
		"netease_fallback":                strconv.FormatBool(settings.NeteaseFallback),
		settingRegistrationEnabled:        strconv.FormatBool(settings.RegistrationEnabled),
		"diagnostics_enabled":             strconv.FormatBool(settings.DiagnosticsEnabled),
		"dlna_cast_enabled":               strconv.FormatBool(settings.DLNACastEnabled),
		"dlna_library_enabled":            strconv.FormatBool(settings.DLNALibraryEnabled),
		"dlna_server_name":                settings.DLNAServerName,
		"dlna_media_base_url":             settings.DLNAMediaBaseURL,
		"dlna_allowed_ips":                settings.DLNAAllowedIPs,
		"dlna_interfaces":                 settings.DLNAInterfaces,
		"playback_source_ttl_hours":       strconv.Itoa(settings.PlaybackSourceTTLHours),
		"playback_history_retention_days": strconv.Itoa(settings.PlaybackHistoryRetentionDays),
		"web_font_family":                 settings.WebFontFamily,
		"web_font_url":                    settings.WebFontURL,
		"lyrics_auto_save_to_song_dir":    strconv.FormatBool(settings.LyricsAutoSaveToSongDir),
		"lyrics_font_family":              settings.LyricsFontFamily,
		"lyrics_font_url":                 settings.LyricsFontURL,
		"lyrics_font_size":                strconv.Itoa(settings.LyricsFontSize),
		"metadata_grouping":               strconv.FormatBool(settings.MetadataGrouping),
		"library_tag_writeback":           strconv.FormatBool(settings.LibraryTagWriteback),
		"library_path_metadata_assist":    strconv.FormatBool(settings.LibraryPathMetadataAssist),
		"smart_playlists_enabled":         strconv.FormatBool(settings.SmartPlaylistsEnabled),
		"sharing_enabled":                 strconv.FormatBool(settings.SharingEnabled),
		"subsonic_server_enabled":         strconv.FormatBool(settings.SubsonicServerEnabled),
		"transcode_policy":                settings.TranscodePolicy,
		"transcode_quality_kbps":          strconv.Itoa(settings.TranscodeQualityKbps),
	}
	for key, value := range pairs {
		if err := s.setSetting(ctx, key, value); err != nil {
			return models.Settings{}, err
		}
	}
	return s.GetSettings(ctx)
}
func (s *Service) LoadWebFont(ctx context.Context, name string) ([]byte, string, error) {
	_ = ctx
	filename := safeFontFileName(name)
	if filename == "" || !isSupportedFont(filename) {
		return nil, "", errors.New("font not found")
	}
	path := filepath.Join(s.fontDir(), filename)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	return data, detectFontContentType(path), nil
}
func (s *Service) ListWebFonts(ctx context.Context) ([]models.WebFont, error) {
	_ = ctx
	entries, err := os.ReadDir(s.fontDir())
	if errors.Is(err, os.ErrNotExist) {
		return []models.WebFont{}, nil
	}
	if err != nil {
		return nil, err
	}
	fonts := make([]models.WebFont, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !isSupportedFont(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		fonts = append(fonts, webFontModel(entry.Name(), info.Size()))
	}
	sort.Slice(fonts, func(i, j int) bool { return strings.ToLower(fonts[i].Family) < strings.ToLower(fonts[j].Family) })
	return fonts, nil
}
func (s *Service) DeleteWebFont(ctx context.Context, name string) (models.Settings, error) {
	filename := safeFontFileName(name)
	if filename == "" || !isSupportedFont(filename) {
		return models.Settings{}, errors.New("font not found")
	}
	path := filepath.Join(s.fontDir(), filename)
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return models.Settings{}, err
	}
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return models.Settings{}, err
	}
	if settings.WebFontURL == webFontModel(filename, 0).URL {
		settings.WebFontFamily = ""
		settings.WebFontURL = ""
	}
	if settings.LyricsFontURL == webFontModel(filename, 0).URL {
		settings.LyricsFontFamily = ""
		settings.LyricsFontURL = ""
	}
	return s.SaveSettings(ctx, settings)
}
func webFontModel(filename string, size int64) models.WebFont {
	family := sanitizeFontFamily(strings.TrimSuffix(filename, filepath.Ext(filename)))
	if family == "" {
		family = "Lark Custom Font"
	}
	return models.WebFont{Name: filename, Family: family, URL: "/api/fonts/" + url.PathEscape(filename), Size: size}
}
func safeFontFileName(name string) string {
	base := filepath.Base(strings.TrimSpace(name))
	base = strings.ReplaceAll(base, string(filepath.Separator), "-")
	base = strings.Map(func(r rune) rune {
		if r == '-' || r == '_' || r == '.' || r == ' ' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= 0x4e00 && r <= 0x9fff {
			return r
		}
		return '-'
	}, base)
	base = strings.Trim(base, ". -")
	if base == "" || base == "." || base == ".." {
		return ""
	}
	return base
}
func isSupportedFont(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".woff2", ".woff", ".ttf", ".otf":
		return true
	default:
		return false
	}
}
func detectFontContentType(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".woff2":
		return "font/woff2"
	case ".woff":
		return "font/woff"
	case ".otf":
		return "font/otf"
	case ".ttf":
		return "font/ttf"
	default:
		return "application/octet-stream"
	}
}
func sanitizeFontFamily(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, "'\"")
	value = strings.Map(func(r rune) rune {
		if r == ' ' || r == '-' || r == '_' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= 0x4e00 && r <= 0x9fff {
			return r
		}
		return -1
	}, value)
	return strings.TrimSpace(value)
}
func sanitizeFontURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if !strings.HasPrefix(value, "/api/fonts/") {
		return ""
	}
	return value
}
func normalizeDLNAServerName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "Lark"
	}
	if len([]rune(value)) > 80 {
		return string([]rune(value)[:80])
	}
	return value
}
func normalizeDLNAMediaBaseURL(value string) string {
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	return ""
}
func normalizeCSVSetting(value string) string {
	parts := strings.Split(value, ",")
	clean := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || seen[part] {
			continue
		}
		seen[part] = true
		clean = append(clean, part)
	}
	return strings.Join(clean, ",")
}
func (s *Service) setSetting(ctx context.Context, key, value string) error {
	existing, err := s.client.AppSetting.Query().Where(appsetting.Key(key)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.AppSetting.Create().SetKey(key).SetValue(value).Save(ctx)
		return err
	}
	return existing.Update().SetValue(value).Exec(ctx)
}
