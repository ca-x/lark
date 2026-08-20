package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/appsetting"
)

const (
	RegistryMaxDepth      = 20
	RegistryMaxPlugins    = 500
	RegistryMaxBody       = 2 << 20
	RegistryTimeout       = 15 * time.Second
	PluginDownloadTimeout = 90 * time.Second
	pluginRegistryKey     = "plugin_registries"
)

var (
	ErrInvalidRegistryURL = errors.New("plugin registry URL must be HTTPS and public")
	ErrRegistryTooLarge   = errors.New("plugin registry response exceeds 2 MiB")
	ErrRegistryDepth      = errors.New("plugin registry include depth exceeded")
)

type RegistryConfig struct {
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Homepage  string    `json:"homepage,omitempty"`
	Enabled   bool      `json:"enabled"`
	Token     string    `json:"token,omitempty"`
	LastSync  time.Time `json:"last_sync,omitempty"`
	LastError string    `json:"last_error,omitempty"`
}

const DefaultRegistryURL = "https://raw.githubusercontent.com/deerwan/songloft-plugin-market/main/registry.json"
const DefaultRegistryHomepage = "https://songloft-store.lllh.de/#/"

var DefaultRegistries = []RegistryConfig{{
	Name: "SongLoft 社区插件市场", URL: DefaultRegistryURL,
	Homepage: DefaultRegistryHomepage, Enabled: true,
}}

type RegistryJSON struct {
	Name     string   `json:"name,omitempty"`
	Includes []string `json:"includes,omitempty"`
	Plugins  []string `json:"plugins,omitempty"`
}

type RegistryEntry struct {
	Name           string   `json:"name,omitempty"`
	EntryPath      string   `json:"entry_path,omitempty"`
	Version        string   `json:"version,omitempty"`
	Description    string   `json:"description,omitempty"`
	Author         string   `json:"author,omitempty"`
	Homepage       string   `json:"homepage,omitempty"`
	Icon           string   `json:"icon,omitempty"`
	DownloadURL    string   `json:"download_url,omitempty"`
	UpdateURL      string   `json:"update_url,omitempty"`
	MinHostVersion string   `json:"min_host_version,omitempty"`
	SourceNames    []string `json:"source_names,omitempty"`
	SourceURLs     []string `json:"source_urls,omitempty"`
}

type RegistryStore interface {
	Load(context.Context) ([]RegistryConfig, bool, error)
	Save(context.Context, []RegistryConfig) error
}

type EntRegistryStore struct{ client *ent.Client }

func NewEntRegistryStore(client *ent.Client) *EntRegistryStore {
	return &EntRegistryStore{client: client}
}

func (s *EntRegistryStore) Load(ctx context.Context) ([]RegistryConfig, bool, error) {
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(pluginRegistryKey)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var value struct {
		Registries []RegistryConfig `json:"registries"`
	}
	if err := json.Unmarshal([]byte(item.Value), &value); err != nil {
		return nil, true, fmt.Errorf("decode plugin registries: %w", err)
	}
	if value.Registries == nil {
		value.Registries = []RegistryConfig{}
	}
	return value.Registries, true, nil
}

func (s *EntRegistryStore) Save(ctx context.Context, registries []RegistryConfig) error {
	data, err := json.Marshal(struct {
		Registries []RegistryConfig `json:"registries"`
	}{Registries: registries})
	if err != nil {
		return err
	}
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(pluginRegistryKey)).Only(ctx)
	if ent.IsNotFound(err) {
		_, err = s.client.AppSetting.Create().SetKey(pluginRegistryKey).SetValue(string(data)).Save(ctx)
		return err
	}
	if err != nil {
		return err
	}
	return item.Update().SetValue(string(data)).Exec(ctx)
}

type RegistryService struct {
	httpClient *http.Client
	store      RegistryStore
	mu         sync.Mutex
}

func NewRegistryService(args ...any) *RegistryService {
	s := &RegistryService{}
	for _, arg := range args {
		switch value := arg.(type) {
		case *http.Client:
			s.httpClient = value
		case RegistryStore:
			s.store = value
		}
	}
	s.httpClient = clonePublicHTTPClient(s.httpClient, RegistryTimeout)
	return s
}

func cloneRegistries(value []RegistryConfig) []RegistryConfig {
	return append([]RegistryConfig(nil), value...)
}

func (s *RegistryService) LoadRegistries(ctx context.Context) ([]RegistryConfig, error) {
	if s.store == nil {
		return cloneRegistries(DefaultRegistries), nil
	}
	registries, exists, err := s.store.Load(ctx)
	if err != nil {
		return nil, err
	}
	if exists {
		return cloneRegistries(registries), nil
	}
	defaults := cloneRegistries(DefaultRegistries)
	if err := s.store.Save(ctx, defaults); err != nil {
		return nil, err
	}
	return defaults, nil
}

func (s *RegistryService) SaveRegistries(ctx context.Context, registries []RegistryConfig) error {
	for i := range registries {
		if err := ValidateRegistryURL(registries[i].URL); err != nil {
			return fmt.Errorf("registry %d: %w", i, err)
		}
		registries[i].URL = strings.TrimSpace(registries[i].URL)
		registries[i].Name = strings.TrimSpace(registries[i].Name)
		registries[i].Homepage = strings.TrimSpace(registries[i].Homepage)
		if registries[i].Homepage != "" {
			if err := ValidateRegistryURL(registries[i].Homepage); err != nil {
				return fmt.Errorf("registry %d homepage: %w", i, err)
			}
		}
	}
	if s.store == nil {
		return errors.New("registry store is not configured")
	}
	return s.store.Save(ctx, cloneRegistries(registries))
}

func ValidateRegistryURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !strings.EqualFold(u.Scheme, "https") || u.Hostname() == "" || u.User != nil {
		return ErrInvalidRegistryURL
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return ErrInvalidRegistryURL
	}
	if address, parseErr := netip.ParseAddr(host); parseErr == nil && !isPublicIP(address) {
		return ErrInvalidRegistryURL
	}
	return nil
}

func (s *RegistryService) FetchAndMerge(ctx context.Context, source any) ([]RegistryEntry, []string, error) {
	sources := []RegistryConfig{}
	switch value := source.(type) {
	case string:
		sources = append(sources, RegistryConfig{URL: value, Enabled: true})
	case RegistryConfig:
		sources = append(sources, value)
	case []RegistryConfig:
		sources = append(sources, value...)
	default:
		return nil, nil, fmt.Errorf("unsupported registry source %T", source)
	}
	return s.FetchAndMergeMulti(ctx, sources)
}

func (s *RegistryService) FetchAndMergeMulti(ctx context.Context, sources []RegistryConfig) ([]RegistryEntry, []string, error) {
	merged := make(map[string]int)
	result := make([]RegistryEntry, 0)
	warnings := make([]string, 0)
	for _, source := range sources {
		if !source.Enabled || strings.TrimSpace(source.URL) == "" {
			continue
		}
		entries, sourceWarnings, err := s.fetchSource(ctx, source)
		warnings = append(warnings, sourceWarnings...)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("source %q: %v", source.Name, err))
			continue
		}
		for _, entry := range entries {
			key := registryIdentity(entry)
			if idx, ok := merged[key]; ok {
				if CompareSemver(entry.Version, result[idx].Version) > 0 {
					entry.SourceNames = appendUnique(entry.SourceNames, result[idx].SourceNames...)
					entry.SourceURLs = appendUnique(entry.SourceURLs, result[idx].SourceURLs...)
					result[idx] = entry
				} else {
					result[idx].SourceNames = appendUnique(result[idx].SourceNames, entry.SourceNames...)
					result[idx].SourceURLs = appendUnique(result[idx].SourceURLs, entry.SourceURLs...)
				}
				continue
			}
			merged[key] = len(result)
			result = append(result, entry)
			if len(result) >= RegistryMaxPlugins {
				return result, warnings, nil
			}
		}
	}
	return result, warnings, nil
}

func (s *RegistryService) fetchSource(ctx context.Context, source RegistryConfig) ([]RegistryEntry, []string, error) {
	if err := ValidateRegistryURL(source.URL); err != nil {
		return nil, nil, err
	}
	visited := make(map[string]bool)
	pluginURLs := make([]string, 0)
	warnings := make([]string, 0)
	if err := s.fetchRecursive(ctx, source.URL, source.Token, 0, visited, &pluginURLs, &warnings); err != nil {
		return nil, warnings, err
	}
	if len(pluginURLs) > RegistryMaxPlugins {
		pluginURLs = pluginURLs[:RegistryMaxPlugins]
	}
	entries := make([]RegistryEntry, 0, len(pluginURLs))
	for _, rawURL := range pluginURLs {
		token := ""
		if sameRegistryHost(source.URL, rawURL) {
			token = source.Token
		}
		entry, err := s.fetchPlugin(ctx, rawURL, token)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("plugin manifest %q: %v", rawURL, err))
			continue
		}
		if entry.EntryPath == "" || entry.DownloadURL == "" {
			continue
		}
		entry.SourceNames = []string{source.Name}
		entry.SourceURLs = []string{source.URL}
		entries = append(entries, entry)
	}
	return entries, warnings, nil
}

func (s *RegistryService) fetchRecursive(ctx context.Context, rawURL, token string, depth int, visited map[string]bool, plugins *[]string, warnings *[]string) error {
	if depth > RegistryMaxDepth {
		*warnings = append(*warnings, ErrRegistryDepth.Error())
		return nil
	}
	if err := ValidateRegistryURL(rawURL); err != nil {
		if depth == 0 {
			return err
		}
		*warnings = append(*warnings, fmt.Sprintf("include %q rejected: %v", rawURL, err))
		return nil
	}
	canonical := strings.TrimRight(rawURL, "/")
	if visited[canonical] {
		return nil
	}
	visited[canonical] = true
	var registry RegistryJSON
	if err := s.fetchJSON(ctx, rawURL, token, &registry); err != nil {
		if depth == 0 {
			return err
		}
		*warnings = append(*warnings, fmt.Sprintf("include %q failed: %v", rawURL, err))
		return nil
	}
	*plugins = append(*plugins, registry.Plugins...)
	for _, include := range registry.Includes {
		if len(*plugins) >= RegistryMaxPlugins {
			break
		}
		if sameRegistryHost(rawURL, include) {
			if err := s.fetchRecursive(ctx, include, token, depth+1, visited, plugins, warnings); err != nil {
				return err
			}
		} else if err := s.fetchRecursive(ctx, include, "", depth+1, visited, plugins, warnings); err != nil {
			return err
		}
	}
	return nil
}

func (s *RegistryService) fetchPlugin(ctx context.Context, rawURL, token string) (RegistryEntry, error) {
	var manifest Manifest
	if err := s.fetchJSON(ctx, rawURL, token, &manifest); err != nil {
		return RegistryEntry{}, err
	}
	if manifest.DownloadURL == "" && manifest.UpdateURL != "" {
		var update Manifest
		updateToken := ""
		if sameRegistryHost(rawURL, manifest.UpdateURL) {
			updateToken = token
		}
		if err := s.fetchJSON(ctx, manifest.UpdateURL, updateToken, &update); err == nil && update.DownloadURL != "" {
			manifest.DownloadURL = update.DownloadURL
		}
	}
	if err := ValidateRegistryURL(manifest.DownloadURL); err != nil {
		return RegistryEntry{}, fmt.Errorf("download URL: %w", err)
	}
	if manifest.Homepage != "" {
		if err := ValidateRegistryURL(manifest.Homepage); err != nil {
			manifest.Homepage = ""
		}
	}
	return RegistryEntry{Name: manifest.Name, EntryPath: manifest.EntryPath, Version: manifest.Version,
		Description: manifest.Description, Author: manifest.Author, Homepage: manifest.Homepage,
		Icon: manifest.Icon, DownloadURL: manifest.DownloadURL, UpdateURL: manifest.UpdateURL,
		MinHostVersion: manifest.MinHostVersion}, nil
}

func (s *RegistryService) fetchJSON(ctx context.Context, rawURL, token string, out any) error {
	body, err := s.fetchBody(ctx, rawURL, token)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("parse registry JSON: %w", err)
	}
	return nil
}

func (s *RegistryService) fetchBody(ctx context.Context, rawURL, token string) ([]byte, error) {
	if err := ValidateRegistryURL(rawURL); err != nil {
		return nil, err
	}
	requestCtx, cancel := context.WithTimeout(ctx, RegistryTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	clone := *clonePublicHTTPClient(s.httpClient, RegistryTimeout)
	clone.CheckRedirect = publicRedirectPolicy(clone.CheckRedirect)
	response, err := clone.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.Request == nil || !strings.EqualFold(response.Request.URL.Scheme, "https") {
		return nil, ErrInvalidRegistryURL
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP status %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, RegistryMaxBody+1))
	if err != nil {
		return nil, err
	}
	if len(body) > RegistryMaxBody {
		return nil, ErrRegistryTooLarge
	}
	return body, nil
}

func sameRegistryHost(a, b string) bool {
	ua, errA := url.Parse(a)
	ub, errB := url.Parse(b)
	return errA == nil && errB == nil && strings.EqualFold(ua.Host, ub.Host)
}

func registryIdentity(entry RegistryEntry) string {
	identity := strings.ToLower(strings.TrimSpace(entry.Author))
	if identity == "" {
		identity = strings.ToLower(strings.TrimSpace(entry.UpdateURL))
	}
	return strings.ToLower(strings.TrimSpace(entry.EntryPath)) + "\x00" + identity
}

func appendUnique(values []string, additions ...string) []string {
	seen := make(map[string]struct{}, len(values)+len(additions))
	for _, value := range values {
		seen[value] = struct{}{}
	}
	for _, value := range additions {
		if value != "" {
			if _, ok := seen[value]; !ok {
				values = append(values, value)
				seen[value] = struct{}{}
			}
		}
	}
	return values
}

func CompareSemver(a, b string) int {
	parse := func(value string) (major, minor, patch int, pre []string) {
		parts := strings.SplitN(strings.TrimSpace(value), "+", 2)[0]
		base := strings.SplitN(parts, "-", 2)
		nums := strings.Split(base[0], ".")
		if len(nums) > 0 {
			fmt.Sscanf(nums[0], "%d", &major)
		}
		if len(nums) > 1 {
			fmt.Sscanf(nums[1], "%d", &minor)
		}
		if len(nums) > 2 {
			fmt.Sscanf(nums[2], "%d", &patch)
		}
		if len(base) == 2 {
			pre = strings.Split(base[1], ".")
		}
		return
	}
	am, an, ap, apre := parse(a)
	bm, bn, bp, bpre := parse(b)
	for _, pair := range [][2]int{{am, bm}, {an, bn}, {ap, bp}} {
		if pair[0] != pair[1] {
			if pair[0] > pair[1] {
				return 1
			}
			return -1
		}
	}
	if len(apre) == 0 && len(bpre) != 0 {
		return 1
	}
	if len(apre) != 0 && len(bpre) == 0 {
		return -1
	}
	for i := 0; i < max(len(apre), len(bpre)); i++ {
		if i >= len(apre) {
			return -1
		}
		if i >= len(bpre) {
			return 1
		}
		aNum, aErr := parseInt(apre[i])
		bNum, bErr := parseInt(bpre[i])
		if aErr == nil && bErr == nil {
			if aNum != bNum {
				if aNum > bNum {
					return 1
				}
				return -1
			}
			continue
		}
		if aErr == nil && bErr != nil {
			return -1
		}
		if aErr != nil && bErr == nil {
			return 1
		}
		if apre[i] != bpre[i] {
			if apre[i] > bpre[i] {
				return 1
			}
			return -1
		}
	}
	return 0
}

func parseInt(value string) (int, error) {
	var result int
	_, err := fmt.Sscanf(value, "%d", &result)
	if err != nil || fmt.Sprintf("%d", result) != value {
		return 0, errors.New("not numeric")
	}
	return result, nil
}
