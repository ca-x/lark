package plugin

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"lark/backend/internal/jsruntime"
	"lark/backend/internal/plugin/host"

	"golang.org/x/net/http/httpguts"
)

const (
	maxPluginHTTPResponseBodyBytes   = 10 << 20
	maxPluginHTTPResponseHeaders     = 64
	maxPluginHTTPResponseHeaderBytes = 64 << 10
)

var forbiddenPluginHTTPResponseHeaders = map[string]struct{}{
	"Connection": {}, "Keep-Alive": {}, "Proxy-Authenticate": {},
	"Proxy-Authorization": {}, "Proxy-Connection": {}, "TE": {},
	"Trailer": {}, "Transfer-Encoding": {}, "Upgrade": {},
}

type HTTPRequest struct {
	Method     string            `json:"method"`
	Path       string            `json:"path"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	Query      string            `json:"query"`
	RemoteAddr string            `json:"remoteAddr,omitempty"`
}

type HTTPResponse struct {
	StatusCode int               `json:"statusCode"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
}

func validatePluginHTTPResponse(response HTTPResponse) error {
	if response.StatusCode < 100 || response.StatusCode > 599 {
		return fmt.Errorf("invalid status code %d", response.StatusCode)
	}
	if len(response.Body) > maxPluginHTTPResponseBodyBytes {
		return fmt.Errorf("body exceeds %d MiB", maxPluginHTTPResponseBodyBytes>>20)
	}
	if len(response.Headers) > maxPluginHTTPResponseHeaders {
		return fmt.Errorf("too many headers")
	}
	totalBytes := 0
	for name, value := range response.Headers {
		canonical := http.CanonicalHeaderKey(strings.TrimSpace(name))
		if canonical == "" || !httpguts.ValidHeaderFieldName(canonical) || !httpguts.ValidHeaderFieldValue(value) {
			return fmt.Errorf("invalid header %q", name)
		}
		if _, forbidden := forbiddenPluginHTTPResponseHeaders[canonical]; forbidden {
			return fmt.Errorf("forbidden header %q", canonical)
		}
		totalBytes += len(canonical) + len(value)
		if totalBytes > maxPluginHTTPResponseHeaderBytes {
			return fmt.Errorf("headers exceed %d KiB", maxPluginHTTPResponseHeaderBytes>>10)
		}
	}
	return nil
}

// ResolvedSongURL is the result of the SongLoft source-plugin
// POST /api/music/url contract. Headers must be sent when fetching URL.
type ResolvedSongURL struct {
	URL          string
	Headers      map[string]string
	SourceData   json.RawMessage
	UsedFallback bool
}

type songURLRequest struct {
	SourceData json.RawMessage  `json:"source_data"`
	Fallback   *songURLFallback `json:"fallback,omitempty"`
}

type songURLFallback struct {
	Enabled  bool    `json:"enabled"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Duration float64 `json:"duration,omitempty"`
}

type songURLResponse struct {
	URL          string            `json:"url"`
	Headers      map[string]string `json:"headers,omitempty"`
	SourceData   json.RawMessage   `json:"source_data,omitempty"`
	UsedFallback bool              `json:"used_fallback,omitempty"`
}

type LyricPayload struct {
	Lyric   string `json:"lyric"`
	Tlyric  string `json:"tlyric,omitempty"`
	Rlyric  string `json:"rlyric,omitempty"`
	Lxlyric string `json:"lxlyric,omitempty"`
}

type PlayEvent struct {
	Type      string        `json:"type"`
	Song      PlayEventSong `json:"song"`
	Source    string        `json:"source"`
	Timestamp int64         `json:"timestamp"`
}

type PlayEventSong struct {
	ID     int    `json:"id"`
	Title  string `json:"title"`
	Artist string `json:"artist"`
}

func (p LyricPayload) IsEmpty() bool {
	return p.Lyric == "" && p.Tlyric == "" && p.Rlyric == "" && p.Lxlyric == ""
}

type Manager struct {
	repo       Repository
	packageDir string
	dataDir    string
	runtime    *jsruntime.JSEnvManager
	host       host.Host
	packageMu  sync.Mutex
	loadMu     sync.Mutex

	mu         sync.RWMutex
	services   map[string]*Service
	lyrics     map[string]bool
	covers     map[string]bool
	playEvents map[string]bool
	closed     bool
}

type Service struct {
	plugin        Plugin
	envID         string
	dir           string
	network       *networkState
	lifecycleCtx  context.Context
	cancelContext context.CancelFunc
	websocketMu   sync.Mutex
	websockets    map[string]*managedInboundWebSocket
	websocketSeq  uint64
}

// NewManager accepts optional *jsruntime.JSEnvManager and host.Host arguments.
// Keeping them variadic lets embedders inject fakes without coupling the
// package to a specific application wiring order.
func NewManager(repo Repository, packageDir, dataDir string, args ...any) *Manager {
	m := &Manager{
		repo: repo, packageDir: packageDir, dataDir: dataDir,
		runtime: jsruntime.NewJSEnvManager(), services: make(map[string]*Service),
		lyrics: make(map[string]bool), covers: make(map[string]bool),
		playEvents: make(map[string]bool),
	}
	for _, arg := range args {
		switch value := arg.(type) {
		case *jsruntime.JSEnvManager:
			m.runtime = value
		case host.Host:
			m.host = value
		}
	}
	return m
}

func (m *Manager) SetHost(value host.Host) { m.mu.Lock(); m.host = value; m.mu.Unlock() }

func (m *Manager) List(ctx context.Context) ([]Plugin, error) {
	items, err := m.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].HasFrontend = m.hasFrontend(items[i].EntryPath)
	}
	return items, nil
}

func (m *Manager) Capabilities() []Capability { return CompatibilityMatrix() }

func (m *Manager) StaticFilePath(entryPath, relative string) (string, error) {
	relative = filepath.Clean("/" + relative)
	if relative == "/" || strings.Contains(relative, "..") {
		return "", fmt.Errorf("invalid plugin static path")
	}
	root := filepath.Join(m.dataDir, entryPath, "static")
	target := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(relative, "/")))
	cleanRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	cleanTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		return "", err
	}
	if cleanTarget != cleanRoot && !strings.HasPrefix(cleanTarget, cleanRoot+string(os.PathSeparator)) {
		return "", fmt.Errorf("static path escapes plugin directory")
	}
	return cleanTarget, nil
}

func (m *Manager) FilePath(ctx context.Context, entryPath, name string) (string, error) {
	item, err := m.repo.GetByEntryPath(ctx, entryPath)
	if err != nil {
		return "", err
	}
	permission, err := filePermission(name, item.ExternalPaths)
	if err != nil {
		return "", err
	}
	if !CheckPermission(item.Permissions, permission) {
		return "", &host.Error{Code: host.CodePermissionDenied, Message: fmt.Sprintf("file access requires %s", permission)}
	}
	m.mu.RLock()
	var files host.FileHost
	var auth host.AuthHost
	if m.host != nil {
		files = m.host.Files()
		auth = m.host.Auth()
	}
	m.mu.RUnlock()
	if files == nil || auth == nil {
		return "", host.CapabilityUnavailable("filesystem")
	}
	info, err := auth.PluginInfo(ctx, entryPath)
	if err != nil {
		return "", err
	}
	info.External = append([]string(nil), item.ExternalPaths...)
	return files.Resolve(ctx, info, name)
}

func (m *Manager) Install(ctx context.Context, zipData []byte) (Plugin, error) {
	return m.installPackage(ctx, zipData, nil)
}

func (m *Manager) installPackage(ctx context.Context, zipData []byte, expected *RegistryEntry) (Plugin, error) {
	m.packageMu.Lock()
	defer m.packageMu.Unlock()

	installed, err := NewPackageInstaller(m.dataDir).InstallPackage(ctx, zipData)
	if err != nil {
		return Plugin{}, err
	}
	manifest := installed.Manifest
	if expected != nil {
		if err := validateRegistryPackage(*expected, manifest); err != nil {
			_ = os.RemoveAll(installed.Dir)
			return Plugin{}, err
		}
	}
	archivePath := m.archivePath(Plugin{EntryPath: manifest.EntryPath})
	if err := writeFileAtomic(archivePath, zipData, 0o644); err != nil {
		_ = os.RemoveAll(installed.Dir)
		return Plugin{}, fmt.Errorf("store plugin archive: %w", err)
	}
	item, err := m.repo.Create(ctx, Plugin{
		Name: manifest.Name, Version: manifest.Version, Description: manifest.Description,
		Author: manifest.Author, Homepage: manifest.Homepage, License: manifest.License,
		EntryPath: manifest.EntryPath, Main: manifest.Main, MinHostVersion: manifest.MinHostVersion,
		Permissions: manifest.Permissions, PublicPaths: manifest.PublicPaths,
		ExternalPaths: manifest.ExternalPaths, Icon: manifest.Icon, UpdateURL: manifest.UpdateURL,
		DownloadURL: manifest.DownloadURL, RenderEngine: manifest.RenderEngine,
		Status: StatusInactive, ZipHash: manifest.ZipHash, EntryHash: manifest.EntryHash,
		FilePath: manifest.EntryPath + ".jsplugin.zip",
	})
	if err != nil {
		_ = os.RemoveAll(installed.Dir)
		_ = os.Remove(archivePath)
		return Plugin{}, err
	}
	return item, nil
}

func (m *Manager) Delete(ctx context.Context, id int) error {
	m.packageMu.Lock()
	defer m.packageMu.Unlock()

	item, err := m.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	m.mu.Lock()
	service := m.services[item.EntryPath]
	delete(m.services, item.EntryPath)
	delete(m.lyrics, item.EntryPath)
	delete(m.covers, item.EntryPath)
	delete(m.playEvents, item.EntryPath)
	m.mu.Unlock()
	if service != nil {
		_ = m.stopService(ctx, service)
	}
	if err := m.repo.Delete(ctx, id); err != nil {
		return err
	}
	return errors.Join(
		os.RemoveAll(filepath.Join(m.dataDir, item.EntryPath)),
		removeFileIfExists(m.archivePath(item)),
	)
}

func (m *Manager) Start(ctx context.Context) error {
	plugins, err := m.repo.List(ctx)
	if err != nil {
		return err
	}
	for _, item := range plugins {
		if item.Status != StatusActive {
			continue
		}
		if err := m.load(ctx, item); err != nil {
			_ = m.repo.SetStatus(ctx, item.ID, StatusError)
		}
	}
	return nil
}

func (m *Manager) Close() error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return nil
	}
	m.closed = true
	services := make([]*Service, 0, len(m.services))
	for _, service := range m.services {
		services = append(services, service)
	}
	m.services = make(map[string]*Service)
	m.mu.Unlock()
	for _, service := range services {
		_ = m.stopService(context.Background(), service)
	}
	if m.runtime != nil {
		m.runtime.SignalShutdown()
		return m.runtime.Close()
	}
	return nil
}

func (m *Manager) Enable(ctx context.Context, id int) error {
	item, err := m.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if err := m.repo.SetStatus(ctx, id, StatusActive); err != nil {
		return err
	}
	if err := m.load(ctx, item); err != nil {
		_ = m.repo.SetStatus(ctx, id, StatusError)
		return err
	}
	return nil
}

func (m *Manager) Disable(ctx context.Context, id int) error {
	item, err := m.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	m.mu.Lock()
	service := m.services[item.EntryPath]
	delete(m.services, item.EntryPath)
	delete(m.lyrics, item.EntryPath)
	delete(m.covers, item.EntryPath)
	delete(m.playEvents, item.EntryPath)
	m.mu.Unlock()
	var stopErr error
	if service != nil {
		stopErr = m.stopService(ctx, service)
	}
	statusErr := m.repo.SetStatus(ctx, id, StatusInactive)
	return errors.Join(stopErr, statusErr)
}

func (m *Manager) Reload(ctx context.Context, entryPath string) error {
	return m.reload(ctx, entryPath)
}

func (m *Manager) reload(ctx context.Context, entryPath string) error {
	item, err := m.repo.GetByEntryPath(ctx, entryPath)
	if err != nil {
		return err
	}
	m.mu.Lock()
	old := m.services[entryPath]
	delete(m.services, entryPath)
	delete(m.lyrics, entryPath)
	delete(m.covers, entryPath)
	delete(m.playEvents, entryPath)
	m.mu.Unlock()
	if old != nil {
		_ = m.stopService(ctx, old)
	}
	if item.Status != StatusActive {
		return nil
	}
	return m.load(ctx, item)
}

func (m *Manager) EnsureLoaded(ctx context.Context, entryPath string) error {
	m.mu.RLock()
	_, loaded := m.services[entryPath]
	m.mu.RUnlock()
	if loaded {
		return nil
	}
	item, err := m.repo.GetByEntryPath(ctx, entryPath)
	if err != nil {
		return err
	}
	if item.Status != StatusActive {
		return fmt.Errorf("plugin %q is not active", entryPath)
	}
	return m.load(ctx, item)
}

func (m *Manager) load(ctx context.Context, item Plugin) error {
	m.loadMu.Lock()
	defer m.loadMu.Unlock()

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return errors.New("plugin manager is closed")
	}
	if _, exists := m.services[item.EntryPath]; exists {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	dir := filepath.Join(m.dataDir, item.EntryPath)
	mainPath := filepath.Join(dir, filepath.FromSlash(item.Main))
	mainCode, err := os.ReadFile(mainPath)
	if err != nil {
		// Permit databases created by the pre-archive migration build, which
		// extracted packages directly under packageDir.
		legacyMainPath := filepath.Join(m.packageDir, item.EntryPath, filepath.FromSlash(item.Main))
		mainCode, err = os.ReadFile(legacyMainPath)
		if err == nil {
			dir = filepath.Join(m.packageDir, item.EntryPath)
		} else {
			mainCode, err = readMainFromZip(m.archivePath(item), item.Main)
		}
		if err != nil {
			return fmt.Errorf("read plugin %s entry: %w", item.EntryPath, err)
		}
	}
	envID := "plugin:" + item.EntryPath
	var createErr error
	if strings.HasSuffix(strings.ToLower(item.Main), ".jsc") {
		createErr = m.runtime.CreateEnvWithBytecode(envID, pluginBootstrapJS, mainCode, int64(item.ID))
	} else {
		createErr = m.runtime.CreateEnv(envID, pluginBootstrapJS+"\n"+string(mainCode), int64(item.ID))
	}
	if createErr != nil {
		return createErr
	}
	lifecycleCtx, cancelContext := context.WithCancel(context.Background())
	service := &Service{
		plugin: item, envID: envID, dir: dir, network: newNetworkState(),
		lifecycleCtx: lifecycleCtx, cancelContext: cancelContext,
		websockets: make(map[string]*managedInboundWebSocket),
	}
	if err := m.runtime.SetBridgeCallback(envID, func(action, data string) (string, error) {
		return m.handleBridge(service.lifecycleCtx, service, action, data)
	}); err != nil {
		service.cancelContext()
		_ = m.runtime.DestroyEnv(envID)
		return err
	}
	if _, err := m.runtime.ExecuteJS(ctx, envID, "onInit()", 10_000); err != nil {
		service.cancelContext()
		service.closeNetwork()
		_ = m.runtime.DestroyEnv(envID)
		m.mu.Lock()
		delete(m.lyrics, item.EntryPath)
		delete(m.covers, item.EntryPath)
		delete(m.playEvents, item.EntryPath)
		m.mu.Unlock()
		return fmt.Errorf("plugin %s onInit: %w", item.EntryPath, err)
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		service.cancelContext()
		_ = m.runtime.DestroyEnv(envID)
		return errors.New("plugin manager is closed")
	}
	m.services[item.EntryPath] = service
	m.mu.Unlock()
	return nil
}

func (m *Manager) archivePath(item Plugin) string {
	return filepath.Join(m.packageDir, item.EntryPath+".jsplugin.zip")
}

func (m *Manager) hasFrontend(entryPath string) bool {
	for _, root := range []string{m.dataDir, m.packageDir} {
		info, err := os.Stat(filepath.Join(root, entryPath, "static", "index.html"))
		if err == nil && info.Mode().IsRegular() {
			return true
		}
	}
	return false
}

func writeFileAtomic(destination string, data []byte, mode os.FileMode) (err error) {
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(destination), ".archive-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		if err != nil {
			_ = os.Remove(tmpName)
		}
	}()
	if err = tmp.Chmod(mode); err != nil {
		return err
	}
	if _, err = tmp.Write(data); err != nil {
		return err
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, destination)
}

func removeFileIfExists(path string) error {
	err := os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (m *Manager) stopService(ctx context.Context, service *Service) error {
	if service == nil {
		return nil
	}
	_, deinitErr := m.runtime.ExecuteJS(ctx, service.envID, "onDeinit()", 5_000)
	service.cancelContext()
	service.closeNetwork()
	service.closeWebSockets()

	var commandCleanupErr error
	m.mu.RLock()
	pluginHost := m.host
	m.mu.RUnlock()
	if pluginHost != nil && pluginHost.Commands() != nil && pluginHost.Auth() != nil {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		info, err := pluginHost.Auth().PluginInfo(cleanupCtx, service.plugin.EntryPath)
		if err == nil {
			commandCleanupErr = pluginHost.Commands().Cleanup(cleanupCtx, info)
		} else {
			commandCleanupErr = err
		}
		cancel()
	}
	return errors.Join(deinitErr, commandCleanupErr, m.runtime.DestroyEnv(service.envID))
}

func (m *Manager) InvokeHTTP(ctx context.Context, entryPath string, request HTTPRequest) (HTTPResponse, error) {
	if err := m.EnsureLoaded(ctx, entryPath); err != nil {
		return HTTPResponse{}, err
	}
	m.mu.RLock()
	service := m.services[entryPath]
	m.mu.RUnlock()
	if service == nil {
		return HTTPResponse{}, fmt.Errorf("plugin %q is not loaded", entryPath)
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return HTTPResponse{}, err
	}
	result, err := m.runtime.ExecuteJSCall(ctx, service.envID, "__dispatchHTTP", 30_000, string(payload))
	if err != nil {
		return HTTPResponse{}, err
	}
	var response HTTPResponse
	if err := json.Unmarshal([]byte(result.Result), &response); err != nil {
		return HTTPResponse{}, fmt.Errorf("plugin %s returned invalid HTTP response: %w", entryPath, err)
	}
	if response.StatusCode == 0 {
		response.StatusCode = 200
	}
	if response.Headers == nil {
		response.Headers = map[string]string{}
	}
	if err := validatePluginHTTPResponse(response); err != nil {
		return HTTPResponse{}, fmt.Errorf("plugin %s returned invalid HTTP response: %w", entryPath, err)
	}
	return response, nil
}

// ResolveSongURL asks a SongLoft source plugin for a fresh playable URL. The
// sourceData value is opaque to Lark but must remain valid JSON because the
// SongLoft request contract embeds it as source_data rather than as a string.
func (m *Manager) ResolveSongURL(
	ctx context.Context,
	entryPath, sourceData, title, artist string,
	duration float64,
) (ResolvedSongURL, error) {
	entryPath = strings.TrimSpace(entryPath)
	if entryPath == "" {
		return ResolvedSongURL{}, fmt.Errorf("plugin entry path is required")
	}
	rawSourceData := json.RawMessage(strings.TrimSpace(sourceData))
	if len(rawSourceData) == 0 || !json.Valid(rawSourceData) {
		return ResolvedSongURL{}, fmt.Errorf("plugin source_data must be valid JSON")
	}
	request := songURLRequest{
		SourceData: rawSourceData,
		Fallback: &songURLFallback{
			Enabled: true, Title: title, Artist: artist, Duration: duration,
		},
	}
	body, err := json.Marshal(request)
	if err != nil {
		return ResolvedSongURL{}, fmt.Errorf("encode plugin music URL request: %w", err)
	}
	response, err := m.InvokeHTTP(ctx, entryPath, HTTPRequest{
		Method: http.MethodPost,
		Path:   "/api/music/url",
		Headers: map[string]string{
			"Content-Type": "application/json",
		},
		Body: string(body),
	})
	if err != nil {
		return ResolvedSongURL{}, fmt.Errorf("invoke plugin %q music URL: %w", entryPath, err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		reason := strings.TrimSpace(response.Body)
		if len(reason) > 512 {
			reason = reason[:512]
		}
		return ResolvedSongURL{}, fmt.Errorf("plugin %q music URL returned %d: %s", entryPath, response.StatusCode, reason)
	}
	if len(response.Body) == 0 || len(response.Body) > 1<<20 {
		return ResolvedSongURL{}, fmt.Errorf("plugin %q music URL returned an invalid response size", entryPath)
	}
	var payload songURLResponse
	if err := json.Unmarshal([]byte(response.Body), &payload); err != nil {
		return ResolvedSongURL{}, fmt.Errorf("decode plugin %q music URL response: %w", entryPath, err)
	}
	payload.URL = strings.TrimSpace(payload.URL)
	if payload.URL == "" {
		return ResolvedSongURL{}, fmt.Errorf("plugin %q music URL returned an empty URL", entryPath)
	}
	return ResolvedSongURL{
		URL: payload.URL, Headers: payload.Headers, SourceData: payload.SourceData,
		UsedFallback: payload.UsedFallback,
	}, nil
}

func (m *Manager) RegisterLyricProvider(entryPath string) {
	m.mu.Lock()
	m.lyrics[entryPath] = true
	m.mu.Unlock()
}
func (m *Manager) UnregisterLyricProvider(entryPath string) {
	m.mu.Lock()
	delete(m.lyrics, entryPath)
	m.mu.Unlock()
}
func (m *Manager) RegisterCoverProvider(entryPath string) {
	m.mu.Lock()
	m.covers[entryPath] = true
	m.mu.Unlock()
}
func (m *Manager) UnregisterCoverProvider(entryPath string) {
	m.mu.Lock()
	delete(m.covers, entryPath)
	m.mu.Unlock()
}

func (m *Manager) HasLyricProvider() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.lyrics) > 0
}
func (m *Manager) HasCoverProvider() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.covers) > 0
}

func (m *Manager) RegisterPlayEvent(entryPath string) {
	m.mu.Lock()
	m.playEvents[entryPath] = true
	m.mu.Unlock()
}

func (m *Manager) UnregisterPlayEvent(entryPath string) {
	m.mu.Lock()
	delete(m.playEvents, entryPath)
	m.mu.Unlock()
}

func (m *Manager) HasPlayEventSubscriber() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.playEvents) > 0
}

func (m *Manager) BroadcastPlayEvent(event PlayEvent) error {
	if event.Type != "play" && event.Type != "finish" && event.Type != "skip" {
		return fmt.Errorf("invalid play event type %q", event.Type)
	}
	if event.Song.ID <= 0 {
		return fmt.Errorf("play event song id is required")
	}
	if event.Timestamp == 0 {
		event.Timestamp = time.Now().UnixMilli()
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	m.mu.RLock()
	targets := make([]*Service, 0, len(m.playEvents))
	for entryPath := range m.playEvents {
		if service := m.services[entryPath]; service != nil {
			targets = append(targets, service)
		}
	}
	m.mu.RUnlock()
	var dispatchErrors []error
	for _, service := range targets {
		if err := m.runtime.PostHostEvent(service.envID, "play_event", "", string(payload)); err != nil {
			dispatchErrors = append(dispatchErrors, fmt.Errorf("dispatch play event to %s: %w", service.plugin.EntryPath, err))
		}
	}
	return errors.Join(dispatchErrors...)
}

func (m *Manager) SearchLyrics(ctx context.Context, title, artist, album string, duration float64, fingerprint, isrc string) (*LyricPayload, error) {
	payload, _, err := m.searchLyrics(ctx, title, artist, album, duration, fingerprint, isrc)
	return payload, err
}

// SearchLyricsText adapts SongLoft's structured lyric-provider response to
// Lark's current primary-LRC contract. The provider identity is preserved so
// cached lyrics can be distinguished from Lark's built-in online sources.
func (m *Manager) SearchLyricsText(ctx context.Context, title, artist, album string, duration float64) (string, string, error) {
	payload, provider, err := m.searchLyrics(ctx, title, artist, album, duration, "", "")
	if err != nil || payload == nil {
		return "", "", err
	}
	for _, value := range []string{payload.Lyric, payload.Lxlyric, payload.Tlyric, payload.Rlyric} {
		if value = strings.TrimSpace(value); value != "" {
			return value, "plugin:" + provider, nil
		}
	}
	return "", "", nil
}

func (m *Manager) searchLyrics(ctx context.Context, title, artist, album string, duration float64, fingerprint, isrc string) (*LyricPayload, string, error) {
	m.mu.RLock()
	providers := make([]string, 0, len(m.lyrics))
	for entryPath := range m.lyrics {
		providers = append(providers, entryPath)
	}
	m.mu.RUnlock()
	slices.Sort(providers)
	for _, entryPath := range providers {
		query := urlValues(map[string]string{"title": title, "artist": artist, "album": album, "duration": fmt.Sprintf("%g", duration), "fingerprint": fingerprint, "isrc": isrc})
		response, err := m.InvokeHTTP(ctx, entryPath, HTTPRequest{Method: "GET", Path: "/lyric-search", Query: query, Headers: map[string]string{}})
		if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 || response.Body == "" {
			continue
		}
		var payload LyricPayload
		if json.Unmarshal([]byte(response.Body), &payload) == nil && !payload.IsEmpty() {
			return &payload, entryPath, nil
		}
	}
	return nil, "", nil
}

func readMainFromZip(zipPath, main string) ([]byte, error) {
	data, err := os.ReadFile(zipPath)
	if err != nil {
		return nil, err
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	for _, file := range reader.File {
		if file.Name != main || file.FileInfo().IsDir() {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return nil, err
		}
		out, err := io.ReadAll(rc)
		_ = rc.Close()
		return out, err
	}
	return nil, fmt.Errorf("entry %q not found", main)
}

func urlValues(values map[string]string) string {
	var parts []string
	for key, value := range values {
		if value == "" {
			continue
		}
		parts = append(parts, queryEscape(key)+"="+queryEscape(value))
	}
	return stringsJoin(parts, "&")
}

func queryEscape(value string) string {
	const hex = "0123456789ABCDEF"
	var b bytes.Buffer
	for i := 0; i < len(value); i++ {
		c := value[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' {
			b.WriteByte(c)
		} else if c == ' ' {
			b.WriteString("%20")
		} else {
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		}
	}
	return b.String()
}

func stringsJoin(values []string, separator string) string {
	if len(values) == 0 {
		return ""
	}
	result := values[0]
	for _, value := range values[1:] {
		result += separator + value
	}
	return result
}
