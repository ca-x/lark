package mygo

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"lark/backend/internal/pluginapp"
	"lark/backend/internal/pluginruntime"
)

type Installed struct {
	Manifest Manifest `json:"manifest"`
	Digest   string   `json:"digest"`
	Origin   string   `json:"origin"`
	Identity string   `json:"identity"`
	Enabled  bool     `json:"enabled"`
	Exports  []string `json:"exports"`
}

type scope struct {
	user   int
	plugin string
}
type preview struct {
	pkg     Package
	archive []byte
	origin  string
	expires time.Time
}
type media struct {
	owner   scope
	digest  string
	url     string
	kind    string
	expires time.Time
	headers map[string]string
	artwork bool
}

type Service struct {
	mu            sync.Mutex
	store         pluginapp.Store
	dir           string
	installed     []Installed
	sessions      map[scope]*Session
	previews      map[string]preview
	media         map[string]media
	enabled       bool
	closed        bool
	clientFactory func() *http.Client
	artworkKey    []byte
}

type Option func(*Service)

func WithHTTPClientFactory(factory func() *http.Client) Option {
	return func(service *Service) { service.clientFactory = factory }
}

func New(ctx context.Context, store pluginapp.Store, dir string, options ...Option) (*Service, error) {
	service := &Service{store: store, dir: dir, sessions: map[scope]*Session{}, previews: map[string]preview{}, media: map[string]media{}, installed: []Installed{}}
	service.clientFactory = pluginruntime.NewHTTPClient
	for _, option := range options {
		option(service)
	}
	key, err := store.Get(ctx, "mygo-artwork-key-v1")
	if err != nil {
		return nil, err
	}
	if len(key) == 0 {
		key = []byte(rand.Text())
		if err := store.Put(ctx, "mygo-artwork-key-v1", key); err != nil {
			return nil, err
		}
	}
	service.artworkKey = key
	contents, err := store.Get(ctx, "mygo-installed-v1")
	if err != nil {
		return nil, err
	}
	if len(contents) > 0 {
		if err := json.Unmarshal(contents, &service.installed); err != nil {
			return nil, err
		}
	}
	for index, item := range service.installed {
		if !validID.MatchString(item.Manifest.ID) || len(item.Digest) != 64 {
			return nil, errors.New("invalid stored mygo package")
		}
		if _, err := hex.DecodeString(item.Digest); err != nil {
			return nil, err
		}
		service.installed[index].Identity = originIdentity(item.Origin, item.Digest)
	}
	return service, nil
}

func (s *Service) Resume(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("mygo service closed")
	}
	s.enabled = true
	return nil
}
func (s *Service) Suspend(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.enabled = false
	for key, session := range s.sessions {
		session.Close()
		delete(s.sessions, key)
	}
	clear(s.media)
	return nil
}
func (s *Service) Close(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	s.enabled = false
	for key, session := range s.sessions {
		session.Close()
		delete(s.sessions, key)
	}
	clear(s.media)
	return nil
}
func (s *Service) List() []Installed {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Clone(s.installed)
}

func (s *Service) itemLocked(id string) (Installed, error) {
	for _, item := range s.installed {
		if item.Manifest.ID == id {
			return item, nil
		}
	}
	return Installed{}, errors.New("mygo plugin not found")
}

func (s *Service) packageLocked(item Installed) (Package, error) {
	contents, err := os.ReadFile(filepath.Join(s.dir, item.Digest+".zip"))
	if err != nil {
		return Package{}, err
	}
	digest := sha256.Sum256(contents)
	if hex.EncodeToString(digest[:]) != item.Digest {
		return Package{}, errors.New("installed package digest mismatch")
	}
	return ReadPackage(contents)
}

func (s *Service) sessionLocked(ctx context.Context, user int, id string) (*Session, error) {
	if !s.enabled || s.closed {
		return nil, ErrDisabled
	}
	if user <= 0 {
		return nil, errors.New("authenticated user is required")
	}
	item, err := s.itemLocked(id)
	if err != nil {
		return nil, err
	}
	if !item.Enabled {
		return nil, ErrDisabled
	}
	key := scope{user, id}
	for key, session := range s.sessions {
		if session.closed.Load() || (session.mediaUsers.Load() == 0 && len(session.calls) == 0 && time.Since(time.Unix(0, session.lastUsed.Load())) > 15*time.Minute) {
			session.Close()
			delete(s.sessions, key)
		}
	}
	if session := s.sessions[key]; session != nil && !session.closed.Load() {
		return session, nil
	}
	if len(s.sessions) >= 64 {
		return nil, errors.New("mygo runtime limit reached; disable unused sources")
	}
	pkg, err := s.packageLocked(item)
	if err != nil {
		return nil, err
	}
	session, err := newSession(ctx, pkg, s.store, userKey(user, item), s.clientFactory())
	if err != nil {
		return nil, err
	}
	s.sessions[key] = session
	return session, nil
}

func originIdentity(origin, digest string) string {
	identity := "zip:" + digest
	if parsed, err := url.Parse(origin); err == nil && parsed.Scheme == "https" && strings.EqualFold(parsed.Host, "github.com") {
		repository, _, _ := strings.Cut(strings.Trim(parsed.Path, "/"), "@")
		if repositoryName.MatchString(repository) {
			identity = "github:" + strings.ToLower(repository)
		}
	}
	hash := sha256.Sum256([]byte(identity))
	return hex.EncodeToString(hash[:])
}

func userKey(user int, item Installed) string {
	return fmt.Sprintf("mygo-user-v2:%d:%s:%s", user, item.Manifest.ID, item.Identity)
}

func allowedMethod(method string) bool {
	switch method {
	case "account", "signIn", "signOut", "home", "browse", "search", "suggest", "playlists", "playlist", "album", "artist", "liked", "recent", "isLiked", "like", "likeEpisode", "createPlaylist", "renamePlaylist", "deletePlaylist", "addToPlaylist", "removeFromPlaylist", "movePlaylistTrack", "savePlaylist", "savedAlbums", "saveAlbum", "followArtist", "shows", "show", "subscribeShow", "stations", "stationNext", "lyrics", "comments", "likeComment", "postComment", "played", "stream":
		return true
	default:
		return false
	}
}

func (s *Service) Call(ctx context.Context, user int, id, method string, params []byte) ([]byte, error) {
	return s.CallFrom(ctx, user, id, "", method, params)
}

func (s *Service) CallFrom(ctx context.Context, user int, id, identity, method string, params []byte) ([]byte, error) {
	if !allowedMethod(method) {
		return nil, ErrUnsupported
	}
	if len(params) > maxSource {
		return nil, errors.New("request exceeds limit")
	}
	s.mu.Lock()
	if err := s.checkIdentityLocked(id, identity); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	session, err := s.sessionLocked(ctx, user, id)
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	result, err := session.Call(ctx, method, params)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	if session.closed.Load() || s.sessions[scope{user, id}] != session {
		s.mu.Unlock()
		return nil, ErrDisabled
	}
	item, err := s.itemLocked(id)
	s.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return s.artworkReferences(user, item, result)
}

func (s *Service) checkIdentityLocked(id, identity string) error {
	item, err := s.itemLocked(id)
	if err != nil {
		return err
	}
	if identity != "" && item.Identity != identity {
		return errors.New("source identity changed; reload source")
	}
	return nil
}

func (s *Service) saveInstalled(ctx context.Context, next []Installed) error {
	contents, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err = s.store.Put(ctx, "mygo-installed-v1", contents); err != nil {
		return err
	}
	s.installed = next
	return nil
}

func (s *Service) SetEnabled(ctx context.Context, id string, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := slices.Clone(s.installed)
	found := false
	for index := range next {
		if next[index].Manifest.ID == id {
			next[index].Enabled = enabled
			found = true
		}
	}
	if !found {
		return errors.New("mygo plugin not found")
	}
	if err := s.saveInstalled(ctx, next); err != nil {
		return err
	}
	s.dropLocked(id, 0)
	return nil
}

func (s *Service) dropLocked(id string, user int) {
	for key, session := range s.sessions {
		if key.plugin == id && (user == 0 || key.user == user) {
			session.Close()
			delete(s.sessions, key)
		}
	}
	for token, value := range s.media {
		if value.owner.plugin == id && (user == 0 || value.owner.user == user) {
			delete(s.media, token)
		}
	}
}

func (s *Service) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.itemLocked(id); err != nil {
		return err
	}
	next := slices.DeleteFunc(slices.Clone(s.installed), func(item Installed) bool { return item.Manifest.ID == id })
	if err := s.saveInstalled(ctx, next); err != nil {
		return err
	}
	s.dropLocked(id, 0)
	return nil
}

func (s *Service) Settings(ctx context.Context, user int, id string) (map[string]string, error) {
	return s.SettingsFrom(ctx, user, id, "")
}

func (s *Service) SettingsFrom(ctx context.Context, user int, id, identity string) (map[string]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.checkIdentityLocked(id, identity); err != nil {
		return nil, err
	}
	if user <= 0 {
		return nil, errors.New("authenticated user required")
	}
	item, err := s.itemLocked(id)
	if err != nil {
		return nil, err
	}
	contents, err := s.store.Get(ctx, userKey(user, item))
	if err != nil {
		return nil, err
	}
	data := userData{Settings: map[string]string{}}
	if len(contents) > 0 {
		if err := json.Unmarshal(contents, &data); err != nil {
			return nil, err
		}
	}
	if data.Settings == nil {
		data.Settings = map[string]string{}
	}
	return data.Settings, nil
}

func (s *Service) SaveSettings(ctx context.Context, user int, id string, settings map[string]string) error {
	return s.SaveSettingsFrom(ctx, user, id, "", settings)
}

func (s *Service) SaveSettingsFrom(ctx context.Context, user int, id, identity string, settings map[string]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.checkIdentityLocked(id, identity); err != nil {
		return err
	}
	if user <= 0 {
		return errors.New("authenticated user required")
	}
	item, err := s.itemLocked(id)
	if err != nil {
		return err
	}
	for key, value := range settings {
		if len(value) > 16<<10 || !slices.ContainsFunc(item.Manifest.Settings, func(setting Setting) bool { return setting.Key == key }) {
			return errors.New("unknown or oversized setting")
		}
	}
	s.dropLocked(id, user)
	contents, err := s.store.Get(ctx, userKey(user, item))
	if err != nil {
		return err
	}
	data := userData{Storage: map[string]jsontext.Value{}}
	if len(contents) > 0 {
		if err := json.Unmarshal(contents, &data); err != nil {
			return err
		}
	}
	data.Settings = maps.Clone(settings)
	contents, err = json.Marshal(data)
	if err != nil {
		return err
	}
	return s.store.Put(ctx, userKey(user, item), contents)
}

func randomToken() string { return rand.Text() }

type Preview struct {
	Token    string   `json:"token"`
	Manifest Manifest `json:"manifest"`
	Digest   string   `json:"digest"`
	Origin   string   `json:"origin"`
	Exports  []string `json:"exports"`
}

func (s *Service) Preview(ctx context.Context, archive []byte, origin string) (Preview, error) {
	pkg, err := ReadPackage(archive)
	if err != nil {
		return Preview{}, err
	}
	module, err := compileModule(ctx, pkg.Manifest.Main, pkg.Files[pkg.Manifest.Main])
	if err != nil {
		return Preview{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for token, value := range s.previews {
		if now.After(value.expires) {
			delete(s.previews, token)
		}
	}
	if len(s.previews) >= 4 {
		return Preview{}, errors.New("too many pending previews; wait 5 minutes")
	}
	token := randomToken()
	s.previews[token] = preview{pkg: pkg, archive: archive, origin: origin, expires: now.Add(5 * time.Minute)}
	return Preview{Token: token, Manifest: pkg.Manifest, Digest: pkg.Digest, Origin: origin, Exports: module.Exports()}, nil
}

func (s *Service) Install(ctx context.Context, token string) (Installed, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, exists := s.previews[token]
	if !exists || time.Now().After(value.expires) {
		return Installed{}, errors.New("preview expired; preview again")
	}
	if _, err := s.itemLocked(value.pkg.Manifest.ID); err == nil {
		return Installed{}, errors.New("plugin id already installed; remove it explicitly before replacing")
	}
	if len(s.installed) >= 100 {
		return Installed{}, errors.New("too many installed sources")
	}
	if err := os.MkdirAll(s.dir, 0700); err != nil {
		return Installed{}, err
	}
	file, err := os.CreateTemp(s.dir, ".package-*")
	if err != nil {
		return Installed{}, err
	}
	name := file.Name()
	defer os.Remove(name)
	_, writeErr := file.Write(value.archive)
	syncErr := file.Sync()
	closeErr := file.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		return Installed{}, err
	}
	if err := os.Rename(name, filepath.Join(s.dir, value.pkg.Digest+".zip")); err != nil {
		return Installed{}, err
	}
	module, err := compileModule(ctx, value.pkg.Manifest.Main, value.pkg.Files[value.pkg.Manifest.Main])
	if err != nil {
		return Installed{}, err
	}
	item := Installed{Manifest: value.pkg.Manifest, Digest: value.pkg.Digest, Origin: value.origin, Identity: originIdentity(value.origin, value.pkg.Digest), Exports: module.Exports()}
	if err := s.saveInstalled(ctx, append(slices.Clone(s.installed), item)); err != nil {
		return Installed{}, err
	}
	delete(s.previews, token)
	return item, nil
}

func (s *Service) Queue(ctx context.Context, user int) ([]byte, error) {
	if user <= 0 {
		return nil, errors.New("authenticated user required")
	}
	contents, err := s.store.Get(ctx, fmt.Sprintf("mygo-queue-v1:%d", user))
	if len(contents) == 0 {
		contents = []byte("null")
	}
	return contents, err
}

func (s *Service) SaveQueue(ctx context.Context, user int, contents []byte) error {
	if user <= 0 || len(contents) > 1<<20 || !jsontext.Value(contents).IsValid() {
		return errors.New("invalid mygo queue")
	}
	return s.store.Put(ctx, fmt.Sprintf("mygo-queue-v1:%d", user), contents)
}

func (s *Service) Prompt(ctx context.Context, user int, id string) (jsontext.Value, error) {
	return s.PromptFrom(ctx, user, id, "")
}

func (s *Service) PromptFrom(ctx context.Context, user int, id, identity string) (jsontext.Value, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.checkIdentityLocked(id, identity); err != nil {
		return nil, err
	}
	session, err := s.sessionLocked(ctx, user, id)
	if err != nil {
		return nil, err
	}
	session.dataMu.Lock()
	defer session.dataMu.Unlock()
	return slices.Clone(session.prompt), nil
}

func (s *Service) NewMedia(ctx context.Context, user int, id, address, kind string) (string, error) {
	return s.NewMediaFrom(ctx, user, id, "", address, kind)
}

func (s *Service) NewMediaFrom(ctx context.Context, user int, id, identity, address, kind string) (string, error) {
	return s.newMedia(ctx, user, id, identity, address, kind, nil, "")
}

func (s *Service) newMedia(ctx context.Context, user int, id, identity, address, kind string, headers map[string]string, proof string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.checkIdentityLocked(id, identity); err != nil {
		return "", err
	}
	session, err := s.sessionLocked(ctx, user, id)
	if err != nil {
		return "", err
	}
	item, _ := s.itemLocked(id)
	artwork := kind == "image" && proof != "" && s.validArtworkProof(user, item, address, proof)
	if proof != "" && !artwork {
		return "", errors.New("invalid artwork reference")
	}
	parsed, err := url.Parse(address)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "file" {
		if parsed.Host != "" || !strings.HasPrefix(parsed.Path, "/package/") || !safeName(strings.TrimPrefix(parsed.Path, "/package/")) {
			return "", errors.New("file URL is outside package")
		}
	} else if _, err := session.mediaHeaders(parsed, kind, artwork); err != nil {
		return "", err
	}
	for token, value := range s.media {
		if time.Now().After(value.expires) {
			delete(s.media, token)
		}
	}
	if len(s.media) >= 2000 {
		return "", errors.New("too many media handles")
	}
	token := randomToken()
	s.media[token] = media{owner: scope{user, id}, digest: item.Digest, url: address, kind: kind, headers: maps.Clone(headers), artwork: artwork, expires: time.Now().Add(30 * time.Minute)}
	return token, nil
}

type Media struct {
	URL        string
	Headers    http.Header
	Data       []byte
	Name       string
	Context    context.Context
	HeadersFor func(*url.URL) (http.Header, error)
	Release    func()
}

func (s *Service) Media(ctx context.Context, user int, token string) (Media, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, exists := s.media[token]
	if !exists || value.owner.user != user || time.Now().After(value.expires) {
		return Media{}, errors.New("media handle unavailable")
	}
	session, err := s.sessionLocked(ctx, user, value.owner.plugin)
	if err != nil {
		return Media{}, err
	}
	item, _ := s.itemLocked(value.owner.plugin)
	if item.Digest != value.digest {
		return Media{}, errors.New("stale media handle")
	}
	parsed, err := url.Parse(value.url)
	if err != nil {
		return Media{}, err
	}
	if parsed.Scheme == "file" {
		pkg, err := s.packageLocked(item)
		if err != nil {
			return Media{}, err
		}
		name := strings.TrimPrefix(parsed.Path, "/package/")
		contents, exists := pkg.Files[name]
		if !exists {
			return Media{}, errors.New("package media not found")
		}
		return Media{Data: contents, Name: name, Context: session.ctx, Release: session.leaseMedia()}, nil
	}
	headers, err := session.mediaHeaders(parsed, value.kind, value.artwork)
	if err != nil {
		return Media{}, err
	}
	for name, text := range value.headers {
		headers.Set(name, text)
	}
	return Media{URL: value.url, Headers: headers, Context: session.ctx, Release: session.leaseMedia(), HeadersFor: func(target *url.URL) (http.Header, error) {
		if session.closed.Load() {
			return nil, ErrDisabled
		}
		if parsed.Scheme == "https" && target.Scheme != "https" {
			return nil, errors.New("HTTPS downgrade is unavailable")
		}
		fresh, err := session.mediaHeaders(target, value.kind, value.artwork)
		if err != nil {
			return nil, err
		}
		if !pluginruntime.SameOrigin(target, parsed) {
			return make(http.Header), nil
		}
		for name, text := range value.headers {
			fresh.Set(name, text)
		}
		return fresh, nil
	}}, nil
}

func (s *Service) ForgetMedia(token string) { s.mu.Lock(); delete(s.media, token); s.mu.Unlock() }

func (s *Service) Stream(ctx context.Context, user int, id, track, quality string) (Media, error) {
	return s.StreamFrom(ctx, user, id, "", track, quality)
}

func (s *Service) StreamFrom(ctx context.Context, user int, id, identity, track, quality string) (Media, error) {
	params, err := json.Marshal(map[string]string{"id": track, "quality": quality})
	if err != nil {
		return Media{}, err
	}
	contents, err := s.CallFrom(ctx, user, id, identity, "stream", params)
	if err != nil {
		return Media{}, err
	}
	var stream struct {
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
	}
	if err := json.Unmarshal(contents, &stream); err != nil {
		return Media{}, err
	}
	token, err := s.newMedia(ctx, user, id, identity, stream.URL, "audio", stream.Headers, "")
	if err != nil {
		return Media{}, err
	}
	defer func() { s.mu.Lock(); delete(s.media, token); s.mu.Unlock() }()
	return s.Media(ctx, user, token)
}
