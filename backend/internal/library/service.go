package library

import (
	"bytes"
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/fsnotify/fsnotify"
	"golang.org/x/sync/singleflight"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/appsetting"
	"lark/backend/ent/artist"
	"lark/backend/ent/librarydirectory"
	"lark/backend/ent/playhistory"
	"lark/backend/ent/playlist"
	"lark/backend/ent/predicate"
	"lark/backend/ent/song"
	"lark/backend/ent/user"
	"lark/backend/ent/useralbumfavorite"
	"lark/backend/ent/userartistfavorite"
	"lark/backend/ent/usersongfavorite"
	"lark/backend/internal/kv"
	"lark/backend/internal/models"
	"lark/backend/internal/netease"
	"lark/backend/internal/online"
	"lark/backend/internal/qqmusic"
)

var supportedAudioExts = map[string]bool{
	".mp3": true, ".flac": true, ".wav": true, ".aiff": true, ".aif": true,
	".m4a": true, ".aac": true, ".ogg": true, ".oga": true, ".opus": true,
	".dsf": true, ".dff": true, ".dst": true, ".ape": true, ".alac": true,
	".wma": true,
}

var supportedExts = func() map[string]bool {
	out := make(map[string]bool, len(supportedAudioExts)+1)
	for ext, ok := range supportedAudioExts {
		out[ext] = ok
	}
	out[".cue"] = true
	return out
}()

var embeddedLyricsExts = map[string]bool{
	".mp3": true, ".flac": true, ".m4a": true, ".aac": true, ".alac": true,
}

var coverHTTPClient = &http.Client{Timeout: 6 * time.Second}

type Service struct {
	client     *ent.Client
	db         *sql.DB
	dbDialect  string
	dataDir    string
	libraryDir string
	ffprobe    string
	ffmpeg     string
	netease    *netease.Client
	qqmusic    *qqmusic.Client
	online     []online.Provider
	cache      kv.Store
	cacheTTL   time.Duration
	scanRunMu  sync.Mutex
	scanMu     sync.RWMutex
	scanCancel context.CancelFunc
	scanStatus models.ScanStatus
	watchMu    sync.Mutex
	watchers   map[string]*libraryWatcher
	// loadSF dedupes concurrent identical browse loads (ArtistSongs/AlbumSongs/...)
	// so a burst of requests for the same collection collapses to a single DB load.
	loadSF singleflight.Group
	// yearRefreshSF dedupes background album-year online lookups (see online.go).
	yearRefreshSF singleflight.Group
	// userVersionMu serializes bumpUserCacheVersion read-modify-write so concurrent
	// favorite/playlist toggles don't lose a version bump.
	userVersionMu sync.Mutex

	// countCache holds materialized GROUP BY aggregates that change only on scan/import.
	// Each entry is guarded by a mutex + timestamp so callers can read the cached map
	// without touching the database.  The TTL defaults to 5 minutes, which is more than
	// enough for browse/page loads between library scans.
	countCacheMu         sync.RWMutex
	albumSongCountsAll   cachedCounts // full album→song_count map
	artistSongCountsAll  cachedCounts // full artist→song_count map
	artistAlbumCountsAll cachedCounts // full artist→album_count map
	countCacheTTL        time.Duration
}

// cachedCounts stores a materialized count map with its fetch timestamp.
type cachedCounts struct {
	counts  map[int]int
	fetched time.Time
}

// get returns the cached counts if fresh, or nil if stale/empty.
func (c cachedCounts) get(ttl time.Duration) map[int]int {
	if c.counts == nil || time.Since(c.fetched) > ttl {
		return nil
	}
	return c.counts
}

// countsFromFullMap extracts a subset for the given IDs from a full map.
// Returns a new map even if empty.
func countsFromFullMap(full map[int]int, ids []int) map[int]int {
	out := make(map[int]int, len(ids))
	for _, id := range ids {
		if v, ok := full[id]; ok {
			out[id] = v
		}
	}
	return out
}

type playbackDeviceContextKey struct{}

func WithPlaybackDeviceType(ctx context.Context, deviceType string) context.Context {
	return context.WithValue(ctx, playbackDeviceContextKey{}, normalizePlaybackDeviceType(deviceType))
}

func playbackDeviceTypeFromContext(ctx context.Context) string {
	if value, ok := ctx.Value(playbackDeviceContextKey{}).(string); ok {
		return normalizePlaybackDeviceType(value)
	}
	return "pc"
}

type libraryWatcher struct {
	root   libraryRoot
	stop   context.CancelFunc
	done   chan struct{}
	active bool
}

type ffprobeOutput struct {
	Format struct {
		Duration string       `json:"duration"`
		BitRate  string       `json:"bit_rate"`
		Tags     metadataTags `json:"tags"`
	} `json:"format"`
	Streams []struct {
		CodecType  string       `json:"codec_type"`
		SampleRate string       `json:"sample_rate"`
		Bits       int          `json:"bits_per_sample"`
		Tags       metadataTags `json:"tags"`
	} `json:"streams"`
}

type fileMetadata struct {
	Title       string
	Artist      string
	Album       string
	AlbumArtist string
	HasLyrics   bool
	Duration    float64
	SampleRate  int
	BitRate     int
	BitDepth    int
	Year        int
	Lyrics      string
}

type Option func(*Service)

func WithCache(store kv.Store, ttl time.Duration) Option {
	return func(s *Service) {
		s.cache = store
		if ttl > 0 {
			s.cacheTTL = ttl
		}
	}
}

func WithSQLDB(db *sql.DB, dialect string) Option {
	return func(s *Service) {
		s.db = db
		s.dbDialect = strings.ToLower(strings.TrimSpace(dialect))
	}
}

func New(client *ent.Client, dataDir, libraryDir, ffprobe, ffmpeg string, neteaseClient *netease.Client, qqClient *qqmusic.Client, opts ...Option) *Service {
	svc := &Service{client: client, dataDir: dataDir, libraryDir: libraryDir, ffprobe: ffprobe, ffmpeg: ffmpeg, netease: neteaseClient, qqmusic: qqClient, online: online.Providers(), cache: kv.NoopStore{}, cacheTTL: 2 * time.Minute, countCacheTTL: 5 * time.Minute}
	for _, opt := range opts {
		if opt != nil {
			opt(svc)
		}
	}
	if svc.cache == nil {
		svc.cache = kv.NoopStore{}
	}
	return svc
}

func (s *Service) FFmpegBin() string { return s.ffmpeg }

func (s *Service) LibraryDir() string { return s.libraryDir }

func (s *Service) DataDir() string { return s.dataDir }

func (s *Service) fontDir() string { return filepath.Join(s.dataDir, "fonts") }

type libraryRoot struct {
	ID           string
	Path         string
	Note         string
	Builtin      bool
	WatchEnabled bool
}

func (s *Service) builtinLibraryRoot() (libraryRoot, error) {
	path, err := filepath.Abs(s.libraryDir)
	if err != nil {
		return libraryRoot{}, err
	}
	return libraryRoot{ID: "env", Path: path, Note: "", Builtin: true}, nil
}

func (s *Service) builtinLibraryWatchEnabled(ctx context.Context) bool {
	if s.client == nil {
		return false
	}
	item, err := s.client.AppSetting.Query().Where(appsetting.Key("library_directory_watch_env")).Only(ctx)
	return err == nil && item.Value == "true"
}

func (s *Service) effectiveLibraryRoots(ctx context.Context, userID int) ([]libraryRoot, error) {
	root, err := s.builtinLibraryRoot()
	if err != nil {
		return nil, err
	}
	root.WatchEnabled = s.builtinLibraryWatchEnabled(ctx)
	roots := []libraryRoot{root}
	if userID == 0 || s.client == nil {
		return roots, nil
	}
	items, err := s.client.LibraryDirectory.Query().
		Where(librarydirectory.HasUserWith(user.ID(userID))).
		Order(ent.Asc(librarydirectory.FieldPath)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{root.Path: true}
	for _, item := range items {
		abs, err := filepath.Abs(item.Path)
		if err != nil || seen[abs] {
			continue
		}
		seen[abs] = true
		roots = append(roots, libraryRoot{ID: strconv.Itoa(item.ID), Path: abs, Note: item.Note, WatchEnabled: item.WatchEnabled})
	}
	return roots, nil
}

func (s *Service) LibraryDirectories(ctx context.Context, userID int) ([]models.LibraryDirectory, error) {
	root, err := s.builtinLibraryRoot()
	if err != nil {
		return nil, err
	}
	root.WatchEnabled = s.builtinLibraryWatchEnabled(ctx)
	out := []models.LibraryDirectory{s.withDirectoryHealth(models.LibraryDirectory{ID: root.ID, Path: root.Path, Builtin: true, WatchEnabled: root.WatchEnabled})}
	if userID == 0 || s.client == nil {
		s.syncLibraryWatchers(out)
		s.applyWatcherState(out)
		return out, nil
	}
	items, err := s.client.LibraryDirectory.Query().
		Where(librarydirectory.HasUserWith(user.ID(userID))).
		Order(ent.Asc(librarydirectory.FieldPath)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		out = append(out, s.withDirectoryHealth(mapLibraryDirectory(item)))
	}
	s.syncLibraryWatchers(out)
	s.applyWatcherState(out)
	return out, nil
}

func (s *Service) CheckLibraryDirectories(ctx context.Context, userID int) ([]models.LibraryDirectory, error) {
	return s.LibraryDirectories(ctx, userID)
}

func (s *Service) withDirectoryHealth(item models.LibraryDirectory) models.LibraryDirectory {
	checkedAt := time.Now()
	item.LastCheckedAt = &checkedAt
	item.Status = "online"
	info, err := os.Stat(item.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			item.Status = "missing"
		} else if errors.Is(err, os.ErrPermission) {
			item.Status = "unreadable"
		} else {
			item.Status = "error"
		}
		item.LastError = err.Error()
		return item
	}
	if !info.IsDir() {
		item.Status = "not_directory"
		item.LastError = "path is not a directory"
		return item
	}
	if entries, err := os.ReadDir(item.Path); err != nil {
		item.Status = "unreadable"
		item.LastError = err.Error()
	} else if entries == nil {
		item.Status = "online"
	}
	return item
}

func (s *Service) applyWatcherState(items []models.LibraryDirectory) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	for i := range items {
		if watcher, ok := s.watchers[items[i].ID]; ok && watcher.active {
			items[i].WatchActive = true
		}
	}
}

func (s *Service) syncLibraryWatchers(items []models.LibraryDirectory) {
	for _, item := range items {
		if item.WatchEnabled && item.Status == "online" {
			s.ensureLibraryWatcher(item)
		} else {
			s.stopLibraryWatcher(item.ID)
		}
	}
}

func (s *Service) updateLibraryWatcherForDirectory(item models.LibraryDirectory) {
	if item.WatchEnabled && item.Status == "online" {
		s.ensureLibraryWatcher(item)
		return
	}
	s.stopLibraryWatcher(item.ID)
}

func (s *Service) StartLibraryWatchers(ctx context.Context) error {
	if s.client == nil {
		return nil
	}
	root, err := s.builtinLibraryRoot()
	if err != nil {
		return err
	}
	items := []models.LibraryDirectory{}
	if s.builtinLibraryWatchEnabled(ctx) {
		items = append(items, s.withDirectoryHealth(models.LibraryDirectory{
			ID:           root.ID,
			Path:         root.Path,
			Builtin:      true,
			WatchEnabled: true,
		}))
	}
	dirs, err := s.client.LibraryDirectory.Query().
		Where(librarydirectory.WatchEnabled(true)).
		All(ctx)
	if err != nil {
		return err
	}
	for _, dir := range dirs {
		items = append(items, s.withDirectoryHealth(mapLibraryDirectory(dir)))
	}
	s.syncLibraryWatchers(items)
	return nil
}

func (s *Service) ensureLibraryWatcher(item models.LibraryDirectory) {
	s.watchMu.Lock()
	if s.watchers == nil {
		s.watchers = map[string]*libraryWatcher{}
	}
	if existing, ok := s.watchers[item.ID]; ok && existing.active && samePath(existing.root.Path, item.Path) {
		s.watchMu.Unlock()
		return
	}
	if existing, ok := s.watchers[item.ID]; ok {
		existing.stop()
	}
	ctx, cancel := context.WithCancel(context.Background())
	watcher := &libraryWatcher{
		root: libraryRoot{ID: item.ID, Path: item.Path, Note: item.Note, Builtin: item.Builtin, WatchEnabled: item.WatchEnabled},
		stop: cancel,
		done: make(chan struct{}),
	}
	s.watchers[item.ID] = watcher
	s.watchMu.Unlock()
	go s.runLibraryWatcher(ctx, watcher)
}

func (s *Service) stopLibraryWatcher(id string) {
	s.watchMu.Lock()
	watcher := s.watchers[id]
	if watcher != nil {
		delete(s.watchers, id)
	}
	s.watchMu.Unlock()
	if watcher != nil && watcher.stop != nil {
		watcher.stop()
	}
}

func (s *Service) StopLibraryWatchers(ctx context.Context) {
	s.watchMu.Lock()
	watchers := make([]*libraryWatcher, 0, len(s.watchers))
	for id, watcher := range s.watchers {
		if watcher != nil {
			watchers = append(watchers, watcher)
		}
		delete(s.watchers, id)
	}
	s.watchMu.Unlock()
	for _, watcher := range watchers {
		if watcher.stop != nil {
			watcher.stop()
		}
	}
	for _, watcher := range watchers {
		select {
		case <-watcher.done:
		case <-ctx.Done():
			return
		}
	}
}

func (s *Service) runLibraryWatcher(ctx context.Context, state *libraryWatcher) {
	defer close(state.done)
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return
	}
	defer watcher.Close()
	if err := addWatchTree(watcher, state.root.Path); err != nil {
		return
	}
	s.watchMu.Lock()
	if current := s.watchers[state.root.ID]; current == state {
		state.active = true
	}
	s.watchMu.Unlock()
	defer func() {
		s.watchMu.Lock()
		if current := s.watchers[state.root.ID]; current == state {
			state.active = false
		}
		s.watchMu.Unlock()
	}()
	importJobs := make(chan string, libraryWatcherImportQueueSize)
	var importWG sync.WaitGroup
	for range libraryWatcherImportConcurrency {
		importWG.Add(1)
		go func() {
			defer importWG.Done()
			for path := range importJobs {
				s.importLibraryWatcherFile(ctx, path)
			}
		}()
	}
	defer func() {
		close(importJobs)
		importWG.Wait()
	}()
	enqueueChangedFile := func(path string) {
		if !IsSupported(path) {
			return
		}
		select {
		case importJobs <- path:
		case <-ctx.Done():
		}
	}
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if event.Op&(fsnotify.Create|fsnotify.Write) != 0 {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					_ = addWatchTree(watcher, event.Name)
					continue
				}
				enqueueChangedFile(event.Name)
			}
			if event.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
				cleanupCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
				_ = s.cleanupMissingLibraryEntries(cleanupCtx, []string{state.root.Path})
				cancel()
				s.invalidateLibraryCache(context.Background())
				s.invalidateSearchCatalogs(context.Background())
			}
		case <-watcher.Errors:
		}
	}
}

func (s *Service) importLibraryWatcherFile(ctx context.Context, path string) {
	importCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	if isCUEFile(path) {
		_, _ = s.importCUEFile(importCtx, path, true)
		return
	}
	if cuePath, ok := s.firstCueReferencingAudio(importCtx, path); ok {
		_, _ = s.importCUEFile(importCtx, cuePath, true)
		return
	}
	_, _ = s.ImportFile(importCtx, path)
}

func addWatchTree(watcher *fsnotify.Watcher, root string) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		if shouldSkipScanDir(root, path, d.Name()) {
			return filepath.SkipDir
		}
		_ = watcher.Add(path)
		return nil
	})
}

func (s *Service) AddLibraryDirectory(ctx context.Context, userID int, path, note string) (models.LibraryDirectory, error) {
	if userID == 0 {
		return models.LibraryDirectory{}, ErrUnauthenticated
	}
	abs, err := filepath.Abs(strings.TrimSpace(path))
	if err != nil {
		return models.LibraryDirectory{}, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return models.LibraryDirectory{}, err
	}
	if !info.IsDir() {
		return models.LibraryDirectory{}, fmt.Errorf("library directory must be a directory")
	}
	builtin, err := s.builtinLibraryRoot()
	if err != nil {
		return models.LibraryDirectory{}, err
	}
	if samePath(abs, builtin.Path) {
		return models.LibraryDirectory{}, fmt.Errorf("directory already exists")
	}
	note = strings.TrimSpace(note)
	item, err := s.client.LibraryDirectory.Create().SetUserID(userID).SetPath(abs).SetNote(note).Save(ctx)
	if err != nil {
		return models.LibraryDirectory{}, err
	}
	return mapLibraryDirectory(item), nil
}

func (s *Service) UpdateLibraryDirectory(ctx context.Context, userID int, id string, watchEnabled bool) (models.LibraryDirectory, error) {
	if userID == 0 {
		return models.LibraryDirectory{}, ErrUnauthenticated
	}
	if id == "env" {
		if err := s.setSetting(ctx, "library_directory_watch_env", strconv.FormatBool(watchEnabled)); err != nil {
			return models.LibraryDirectory{}, err
		}
		root, err := s.builtinLibraryRoot()
		if err != nil {
			return models.LibraryDirectory{}, err
		}
		item := s.withDirectoryHealth(models.LibraryDirectory{ID: root.ID, Path: root.Path, Builtin: true, WatchEnabled: watchEnabled})
		s.updateLibraryWatcherForDirectory(item)
		s.applyWatcherState([]models.LibraryDirectory{item})
		return item, nil
	}
	dirID, err := strconv.Atoi(id)
	if err != nil {
		return models.LibraryDirectory{}, err
	}
	item, err := s.client.LibraryDirectory.UpdateOneID(dirID).
		Where(librarydirectory.HasUserWith(user.ID(userID))).
		SetWatchEnabled(watchEnabled).
		Save(ctx)
	if err != nil {
		return models.LibraryDirectory{}, err
	}
	out := s.withDirectoryHealth(mapLibraryDirectory(item))
	s.updateLibraryWatcherForDirectory(out)
	s.applyWatcherState([]models.LibraryDirectory{out})
	return out, nil
}

func (s *Service) DeleteLibraryDirectory(ctx context.Context, userID int, id int) error {
	if userID == 0 {
		return ErrUnauthenticated
	}
	deleted, err := s.client.LibraryDirectory.Delete().
		Where(librarydirectory.ID(id), librarydirectory.HasUserWith(user.ID(userID))).
		Exec(ctx)
	if err != nil {
		return err
	}
	if deleted == 0 {
		return fmt.Errorf("library directory not found")
	}
	s.stopLibraryWatcher(strconv.Itoa(id))
	return nil
}

type resolvedFolderRoot struct {
	Root libraryRoot
	Rel  string
	Path string
}

func (s *Service) rootDisplayName(root libraryRoot) string {
	if strings.TrimSpace(root.Note) != "" {
		return root.Note
	}
	return filepath.Base(root.Path)
}

func IsSupported(path string) bool { return supportedExts[strings.ToLower(filepath.Ext(path))] }

func IsAudioSupported(path string) bool {
	return supportedAudioExts[strings.ToLower(filepath.Ext(path))]
}

func (s *Service) cleanupMissingLibraryEntries(ctx context.Context, roots []string) error {
	if s.client == nil {
		return nil
	}
	predicates := []predicate.Song{}
	for _, rootPath := range roots {
		libraryRoot, err := filepath.Abs(rootPath)
		if err != nil {
			return err
		}
		predicates = append(predicates, song.Or(song.Path(libraryRoot), song.PathHasPrefix(libraryRoot+string(os.PathSeparator))))
	}
	if len(predicates) == 0 {
		return nil
	}
	const batchSize = 500
	lastID := 0
	for {
		batchPredicates := append([]predicate.Song{}, predicates...)
		if lastID > 0 {
			batchPredicates = append(batchPredicates, song.IDGT(lastID))
		}
		batch, err := s.client.Song.Query().
			Select(song.FieldID, song.FieldPath).
			Where(batchPredicates...).
			Order(ent.Asc(song.FieldID)).
			Limit(batchSize).
			All(ctx)
		if err != nil {
			return err
		}
		if len(batch) == 0 {
			break
		}
		lastID = batch[len(batch)-1].ID
		missingIDs := make([]int, 0, minInt(batchSize, len(batch)))
		for _, item := range batch {
			if songPathMissing(item.Path) {
				missingIDs = append(missingIDs, item.ID)
			}
		}
		if len(missingIDs) > 0 {
			if err := s.deleteSongIDs(ctx, missingIDs); err != nil {
				return err
			}
		}
	}
	for {
		emptyAlbums, err := s.client.Album.Query().
			Select(album.FieldID).
			Where(album.Not(album.HasSongs())).
			Limit(batchSize).
			All(ctx)
		if err != nil {
			return err
		}
		if len(emptyAlbums) == 0 {
			break
		}
		ids := make([]int, 0, len(emptyAlbums))
		for _, item := range emptyAlbums {
			if item != nil {
				ids = append(ids, item.ID)
			}
		}
		if len(ids) == 0 {
			break
		}
		if _, err := s.client.UserAlbumFavorite.Delete().
			Where(useralbumfavorite.HasAlbumWith(album.IDIn(ids...))).
			Exec(ctx); err != nil {
			return err
		}
		if _, err := s.client.Album.Delete().Where(album.IDIn(ids...)).Exec(ctx); err != nil {
			return err
		}
	}

	for {
		emptyArtists, err := s.client.Artist.Query().
			Select(artist.FieldID).
			Where(artist.Not(artist.HasSongs()), artist.Not(artist.HasAlbums())).
			Limit(batchSize).
			All(ctx)
		if err != nil {
			return err
		}
		if len(emptyArtists) == 0 {
			break
		}
		ids := make([]int, 0, len(emptyArtists))
		for _, item := range emptyArtists {
			if item != nil {
				ids = append(ids, item.ID)
			}
		}
		if len(ids) == 0 {
			break
		}
		if _, err := s.client.UserArtistFavorite.Delete().
			Where(userartistfavorite.HasArtistWith(artist.IDIn(ids...))).
			Exec(ctx); err != nil {
			return err
		}
		if _, err := s.client.Artist.Delete().Where(artist.IDIn(ids...)).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) updateScanProgress(currentPath, currentDir string, result *models.ScanResult) {
	s.setScanStatus(func(status *models.ScanStatus) {
		status.CurrentPath = currentPath
		status.CurrentDir = currentDir
		status.Scanned = result.Scanned
		status.Added = result.Added
		status.Updated = result.Updated
		status.Skipped = result.Skipped
		status.Canceled = result.Canceled
		status.Errors = append(status.Errors[:0], recentScanErrors(result.Errors)...)
	})
}

func (s *Service) setScanStatus(update func(*models.ScanStatus)) {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	update(&s.scanStatus)
}

func (s *Service) Songs(ctx context.Context, userID int, q string, favorites bool, limit int) ([]models.Song, error) {
	page, err := s.SongsPage(ctx, userID, q, favorites, limit, 0)
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}

func (s *Service) SongsPage(ctx context.Context, userID int, q string, favorites bool, limit, offset int) (models.SongPage, error) {
	term := strings.TrimSpace(q)
	limit, offset = normalizePage(limit, offset)
	deviceScope, err := s.playbackHistoryDeviceScope(ctx, userID)
	if err != nil {
		return models.SongPage{}, err
	}
	cacheable := limit <= 500
	key := ""
	if cacheable {
		key = cacheKey("songs-page", userID, s.userCacheVersion(ctx, userID), deviceScope, term, favorites, limit, offset)
		var cached models.SongPage
		if ok, err := s.cacheGetJSON(ctx, key, &cached); err != nil {
			return models.SongPage{}, err
		} else if ok {
			// Cache hit: re-apply fresh user state (play counts, last played, resume).
			cached.Items, err = s.applySongUserStateWithDevice(ctx, userID, cached.Items, deviceScope)
			if err != nil {
				return models.SongPage{}, err
			}
			return cached, nil
		}
	}
	// Singleflight for cacheable queries to collapse concurrent identical requests.
	if cacheable {
		v, err, _ := s.loadSF.Do(key, func() (any, error) {
			bgCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			var inner models.SongPage
			if ok, e := s.cacheGetJSON(bgCtx, key, &inner); e == nil && ok {
				inner.Items, e = s.applySongUserStateWithDevice(bgCtx, userID, inner.Items, deviceScope)
				if e != nil {
					return models.SongPage{}, e
				}
				return inner, nil
			}
			page, e := s.loadSongsPage(bgCtx, userID, term, favorites, deviceScope, limit, offset)
			if e != nil {
				return models.SongPage{}, e
			}
			// Cache a copy with volatile user state stripped; the caller gets
			// the original with fresh user state already applied by loadSongsPage.
			cached := page
			cached.Items = stripSongUserState(page.Items)
			_ = s.cacheSetJSON(bgCtx, key, cached)
			return page, nil
		})
		if err != nil {
			return models.SongPage{}, err
		}
		return v.(models.SongPage), nil
	}
	return s.loadSongsPage(ctx, userID, term, favorites, deviceScope, limit, offset)
}

// loadSongsPage executes the actual DB queries for SongsPage.
func (s *Service) loadSongsPage(ctx context.Context, userID int, term string, favorites bool, deviceScope string, limit, offset int) (models.SongPage, error) {
	predicates, err := s.songListPredicates(ctx, userID, term, favorites)
	if err != nil {
		return models.SongPage{}, err
	}
	totalQuery := s.client.Song.Query()
	if len(predicates) > 0 {
		totalQuery = totalQuery.Where(predicates...)
	}
	total, err := totalQuery.Count(ctx)
	if err != nil {
		return models.SongPage{}, err
	}
	query := s.client.Song.Query().Select(browseSongColumns...).WithArtist().WithAlbum().Order(ent.Desc(song.FieldCreatedAt), ent.Desc(song.FieldID))
	if len(predicates) > 0 {
		query = query.Where(predicates...)
	}
	query = query.Limit(limit)
	if offset > 0 {
		query = query.Offset(offset)
	}
	items, err := query.All(ctx)
	if err != nil {
		return models.SongPage{}, err
	}
	out, err := s.applySongUserStateWithDevice(ctx, userID, mapSongs(items), deviceScope)
	if err != nil {
		return models.SongPage{}, err
	}
	return models.SongPage{
		Items:  out,
		Total:  total,
		Limit:  limit,
		Offset: offset,
		Page:   offset/limit + 1,
	}, nil
}

func (s *Service) songListPredicates(ctx context.Context, userID int, term string, favorites bool) ([]predicate.Song, error) {
	predicates := []predicate.Song{}
	if term != "" {
		if ids, ok, err := s.songCatalogIDsForTerm(ctx, term); err != nil {
			return nil, err
		} else if ok {
			if len(ids) == 0 {
				predicates = append(predicates, song.ID(-1))
			} else {
				predicates = append(predicates, song.IDIn(ids...))
			}
			if favorites {
				predicates = append(predicates, song.HasUserFavoritesWith(usersongfavorite.HasUserWith(user.ID(userID))))
			}
			return predicates, nil
		}
		searchPredicates := []predicate.Song{
			song.TitleContainsFold(term),
			song.FileNameContainsFold(term),
			song.FormatContainsFold(term),
		}
		artistIDs, err := s.client.Artist.Query().Where(artist.NameContainsFold(term)).IDs(ctx)
		if err != nil {
			return nil, err
		}
		if len(artistIDs) > 0 {
			searchPredicates = append(searchPredicates, predicate.Song(entsql.FieldIn(song.ArtistColumn, artistIDs...)))
		}
		albumIDs, err := s.client.Album.Query().Where(album.Or(album.TitleContainsFold(term), album.AlbumArtistContainsFold(term))).IDs(ctx)
		if err != nil {
			return nil, err
		}
		if len(albumIDs) > 0 {
			searchPredicates = append(searchPredicates, predicate.Song(entsql.FieldIn(song.AlbumColumn, albumIDs...)))
		}
		predicates = append(predicates, song.Or(searchPredicates...))
	}
	if favorites {
		predicates = append(predicates, song.HasUserFavoritesWith(usersongfavorite.HasUserWith(user.ID(userID))))
	}
	return predicates, nil
}

func normalizePage(limit, offset int) (int, int) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func normalizeCollectionSongLimit(limit int) int {
	if limit <= 0 {
		return 0
	}
	if limit > 5000 {
		return 5000
	}
	return limit
}

func applySongQueryLimit(query *ent.SongQuery, limit int) *ent.SongQuery {
	if normalized := normalizeCollectionSongLimit(limit); normalized > 0 {
		query = query.Limit(normalized)
	}
	return query
}

func limitCollectionSongQuery(query *ent.SongQuery, limit int) {
	if normalized := normalizeCollectionSongLimit(limit); normalized > 0 {
		query.Limit(normalized)
	}
}

// browseSongColumns is every Song column EXCEPT the large lyrics_embedded TEXT blob.
// Browse/list queries that feed mapSongs only need has_lyrics (a bool) to indicate
// lyrics presence, so projecting these columns avoids reading and allocating the
// potentially multi-KB embedded-lyrics string per row on the hot path. Ent auto-adds
// the FK columns (artist_songs/album_songs) when WithArtist/WithAlbum are set, and
// always force-includes the ID, so they are intentionally omitted here.
// NOTE: do NOT use this projection on the lyrics endpoints — they need lyrics_embedded.
var browseSongColumns = []string{
	song.FieldID, song.FieldTitle, song.FieldPath, song.FieldFileName,
	song.FieldFormat, song.FieldMime, song.FieldSizeBytes, song.FieldModTimeUnixNano,
	song.FieldContentHash, song.FieldDurationSeconds, song.FieldSampleRate,
	song.FieldBitRate, song.FieldBitDepth, song.FieldYear, song.FieldNeteaseID,
	song.FieldFavorite, song.FieldPlayCount, song.FieldLastPlayedAt,
	song.FieldHasLyrics, song.FieldLyricsSource,
	song.FieldCreatedAt, song.FieldUpdatedAt,
}

func (s *Service) RecentAddedSongs(ctx context.Context, userID, limit int) ([]models.Song, error) {
	if limit <= 0 || limit > 50 {
		limit = 12
	}
	items, err := s.client.Song.Query().
		Select(browseSongColumns...).
		WithArtist().
		WithAlbum().
		Order(ent.Desc(song.FieldCreatedAt), ent.Desc(song.FieldID)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return nil, err
	}
	return s.applySongUserState(ctx, userID, mapSongs(items))
}

func (s *Service) RecentPlayedSongs(ctx context.Context, userID, limit int) ([]models.Song, error) {
	if limit <= 0 || limit > 50 {
		limit = 12
	}
	deviceScope, err := s.playbackHistoryDeviceScope(ctx, userID)
	if err != nil {
		return nil, err
	}
	histories, err := s.client.PlayHistory.Query().
		Where(playHistoryUserPredicates(userID, deviceScope)...).
		WithSong(func(q *ent.SongQuery) {
			q.Select(browseSongColumns...).WithArtist().WithAlbum()
		}).
		Order(ent.Desc(playhistory.FieldUpdatedAt), ent.Desc(playhistory.FieldPlayedAt)).
		Limit(limit * 4).
		All(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[int]bool{}
	items := make([]*ent.Song, 0, limit)
	for _, history := range histories {
		if history.Edges.Song == nil || seen[history.Edges.Song.ID] {
			continue
		}
		seen[history.Edges.Song.ID] = true
		items = append(items, history.Edges.Song)
		if len(items) >= limit {
			break
		}
	}
	return s.applySongUserStateWithDevice(ctx, userID, mapSongs(items), deviceScope)
}

func (s *Service) LibraryStats(ctx context.Context, userID int) (models.LibraryStats, error) {
	var stats models.LibraryStats
	var err error
	if stats.Songs, err = s.client.Song.Query().Count(ctx); err != nil {
		return models.LibraryStats{}, err
	}
	if stats.Albums, err = s.client.Album.Query().Count(ctx); err != nil {
		return models.LibraryStats{}, err
	}
	if stats.Artists, err = s.client.Artist.Query().Count(ctx); err != nil {
		return models.LibraryStats{}, err
	}
	if stats.Playlists, err = s.client.Playlist.Query().
		Where(playlist.HasOwnerWith(user.ID(userID))).
		Count(ctx); err != nil {
		return models.LibraryStats{}, err
	}
	return stats, nil
}

func (s *Service) Song(ctx context.Context, userID, id int) (models.Song, error) {
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().WithAlbum().Only(ctx)
	if err != nil {
		return models.Song{}, err
	}
	out, err := s.applySongUserState(ctx, userID, []models.Song{mapSong(item)})
	if err != nil {
		return models.Song{}, err
	}
	return out[0], nil
}

func (s *Service) SmartPlaylists(ctx context.Context) ([]models.SmartPlaylist, error) {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	enabled := settings.SmartPlaylistsEnabled
	return []models.SmartPlaylist{
		{ID: "daily-mix", Name: "Daily Mix", Description: "Personal daily shuffle from the local library.", Kind: "generated", Enabled: enabled},
		{ID: "recently-played", Name: "Recently played", Description: "Songs recently played by this user.", Kind: "history", Enabled: enabled},
		{ID: "recently-added", Name: "Recently added", Description: "Newest imported songs in the library.", Kind: "library", Enabled: enabled},
		{ID: "favorites", Name: "Favorites", Description: "Songs marked as favorites by this user.", Kind: "user", Enabled: enabled},
		{ID: "unplayed", Name: "Unplayed", Description: "Local songs this user has not played yet.", Kind: "history", Enabled: enabled},
		{ID: "hi-res", Name: "Hi-Res", Description: "Songs with 24-bit audio or sample rate of at least 96 kHz.", Kind: "metadata", Enabled: enabled},
		{ID: "needs-lyrics", Name: "Needs lyrics", Description: "Songs without embedded lyrics metadata.", Kind: "metadata", Enabled: enabled},
	}, nil
}

func normalizeSongContentHashPart(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

func (s *Service) reusableSongByContentHash(ctx context.Context, contentHash, newPath string) (*ent.Song, bool, error) {
	matches, err := s.client.Song.Query().
		Where(song.ContentHashEQ(contentHash), song.PathNEQ(newPath)).
		Order(ent.Asc(song.FieldID)).
		Limit(8).
		All(ctx)
	if err != nil {
		return nil, false, err
	}
	for _, match := range matches {
		if _, statErr := os.Stat(match.Path); statErr == nil {
			return nil, true, nil
		} else if errors.Is(statErr, os.ErrNotExist) {
			return match, false, nil
		}
	}
	return nil, false, nil
}

func dailySeed(day string, userID int) uint64 {
	seed := fmt.Sprintf("%s:%d", day, userID)
	var hash uint64 = 1469598103934665603
	for _, b := range []byte(seed) {
		hash ^= uint64(b)
		hash *= 1099511628211
	}
	return hash
}

func dailyScore(day string, userID int, item models.Song) uint64 {
	seed := fmt.Sprintf("%s:%d:%d:%d:%s", day, userID, item.ID, item.ArtistID, item.Title)
	var hash uint64 = 1469598103934665603
	for _, b := range []byte(seed) {
		hash ^= uint64(b)
		hash *= 1099511628211
	}
	if item.Favorite {
		hash += 1 << 62
	}
	if item.PlayCount > 0 {
		hash += uint64(minInt(item.PlayCount, 20)) << 56
	}
	if item.LastPlayedAt != nil && time.Since(*item.LastPlayedAt) < 24*time.Hour {
		hash >>= 1
	}
	return hash
}

func recentArtistInMix(items []models.Song, artistID, gap int) bool {
	if artistID == 0 {
		return false
	}
	start := len(items) - gap
	if start < 0 {
		start = 0
	}
	for _, item := range items[start:] {
		if item.ArtistID == artistID {
			return true
		}
	}
	return false
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

const transcodeWarmLeasePrefix = "runtime:v1:transcode-warm:"
const playbackSourcePrefix = "runtime:v1:playback-source:"
const playbackQueuePrefix = "runtime:v1:playback-queue:"
const libraryWatcherImportConcurrency = 4
const libraryWatcherImportQueueSize = 128
const remoteAlbumSearchConcurrency = 3
const maxPlaybackQueueSongs = 500
const maxPlaybackRadioStations = 100
const defaultPlaybackSourceTTLHours = 24
const defaultPlaybackHistoryRetentionDays = 0
const defaultUISoundVolume = 0.85
const collectionCoverHitTTL = 30 * 24 * time.Hour
const collectionCoverMissTTL = 6 * time.Hour

func (s *Service) TryAcquireTranscodeWarmLease(ctx context.Context, cachePath string, ttl time.Duration) (bool, error) {
	if s.cache == nil || ttl <= 0 {
		return true, nil
	}
	value := []byte(strconv.FormatInt(time.Now().Unix(), 10))
	return s.cache.SetNX(ctx, transcodeWarmLeaseKey(cachePath), value, ttl)
}

func transcodeWarmLeaseKey(cachePath string) string {
	sum := sha1.Sum([]byte(cachePath))
	return transcodeWarmLeasePrefix + hex.EncodeToString(sum[:])
}

func normalizeMonitorInterval(minutes int) int {
	if minutes <= 0 {
		return 15
	}
	if minutes < 5 {
		return 5
	}
	if minutes > 1440 {
		return 1440
	}
	return minutes
}

func normalizeScrobblingProvider(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "lastfm", "last.fm":
		return "lastfm"
	default:
		return "listenbrainz"
	}
}

func normalizeTranscodePolicy(policy string) string {
	switch strings.ToLower(strings.TrimSpace(policy)) {
	case "raw", "transcode":
		return strings.ToLower(strings.TrimSpace(policy))
	default:
		return "auto"
	}
}

func normalizeTranscodeQuality(kbps int) int {
	switch {
	case kbps <= 0:
		return 192
	case kbps < 64:
		return 64
	case kbps > 320:
		return 320
	default:
		return kbps
	}
}

func normalizeLyricsFontSize(px int) int {
	if px <= 0 {
		return 0
	}
	if px < 18 {
		return 18
	}
	if px > 72 {
		return 72
	}
	return px
}

func (s *Service) playbackHistoryDeviceScope(ctx context.Context, userID int) (string, error) {
	settings, err := s.GetPlaybackHistorySettings(ctx, userID)
	if err != nil {
		return "", err
	}
	if !settings.SeparateByDevice {
		return "", nil
	}
	return playbackDeviceTypeFromContext(ctx), nil
}

func (s *Service) scrobblingRecord(ctx context.Context, userID int, out *scrobblingSettingsRecord) (bool, error) {
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(scrobblingKey(userID))).Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	if err := json.Unmarshal([]byte(item.Value), out); err != nil {
		return false, nil
	}
	return true, nil
}

type scrobblingSettingsRecord struct {
	Enabled     bool   `json:"enabled"`
	Provider    string `json:"provider"`
	Token       string `json:"token"`
	SubmitNow   bool   `json:"submit_now"`
	MinSeconds  int    `json:"min_seconds"`
	PercentGate int    `json:"percent_gate"`
}

func defaultScrobblingSettings() models.ScrobblingSettings {
	return models.ScrobblingSettings{
		Provider:    "listenbrainz",
		SubmitNow:   true,
		MinSeconds:  30,
		PercentGate: 50,
	}
}

func scrobblingKey(userID int) string {
	return scrobblingPrefix + strconv.Itoa(userID)
}

func uiSoundSettingsKey(userID int) string {
	return uiSoundSettingsPrefix + strconv.Itoa(userID)
}

func defaultUISoundSettings() models.UISoundSettings {
	return models.UISoundSettings{Enabled: false, Volume: defaultUISoundVolume}
}

func normalizeUISoundVolume(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return defaultUISoundVolume
	}
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

func playbackHistorySettingsKey(userID int) string {
	return playbackHistorySettingsPrefix + strconv.Itoa(userID)
}

func userPreferencesKey(userID int) string {
	return userPreferencesPrefix + strconv.Itoa(userID)
}

func defaultUserPreferences() models.UserPreferences {
	return models.UserPreferences{
		HomePlayerStyle:         "vinyl",
		MobileHomePlayerStyle:   "neon-console",
		MineradioStageEnabled:   false,
		ArtistAlbumDisplayStyle: "classic",
		LyricsDisplayStyle:      "immersive",
		LyricsDragSeekEnabled:   true,
		TerminalShellTheme:      "operator",
	}
}

func normalizeUserPreferences(preferences models.UserPreferences) models.UserPreferences {
	return models.UserPreferences{
		HomePlayerStyle:         normalizeUserHomePlayerStyle(preferences.HomePlayerStyle),
		MobileHomePlayerStyle:   normalizeUserMobileHomePlayerStyle(preferences.MobileHomePlayerStyle),
		MineradioStageEnabled:   preferences.MineradioStageEnabled,
		ArtistAlbumDisplayStyle: normalizeArtistAlbumDisplayStyle(preferences.ArtistAlbumDisplayStyle),
		LyricsDisplayStyle:      normalizeLyricsDisplayStyle(preferences.LyricsDisplayStyle),
		LyricsDragSeekEnabled:   preferences.LyricsDragSeekEnabled,
		TerminalShellTheme:      normalizeTerminalShellTheme(preferences.TerminalShellTheme),
	}
}

func normalizeTerminalShellTheme(value string) string {
	switch strings.TrimSpace(value) {
	case "operator", "dusk", "phosphor", "ashgray", "embers":
		return strings.TrimSpace(value)
	default:
		return "operator"
	}
}

func normalizeLyricsDisplayStyle(value string) string {
	switch strings.TrimSpace(value) {
	case "classic", "folia-monet", "folia-fume", "folia-tilt", "folia-cadenza":
		return strings.TrimSpace(value)
	default:
		return "immersive"
	}
}

func normalizeUserHomePlayerStyle(value string) string {
	switch strings.TrimSpace(value) {
	case "vinyl", "cassette", "ipod", "audio-scope", "album-slide", "smartisan-turntable", "gramophone", "running-kitten", "mineradio-stage", "walkman":
		return strings.TrimSpace(value)
	default:
		return "vinyl"
	}
}

func normalizeUserMobileHomePlayerStyle(value string) string {
	switch strings.TrimSpace(value) {
	case "neon-console", "indiewave", "editorial-pulse", "soft-vinyl", "gramophone", "stage-glass", "blue-halo", "smartisan-classic":
		return strings.TrimSpace(value)
	default:
		return "neon-console"
	}
}

func normalizeArtistAlbumDisplayStyle(value string) string {
	if strings.TrimSpace(value) == "showcase" {
		return "showcase"
	}
	return "classic"
}

func normalizePlaybackDeviceType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "mobile":
		return "mobile"
	default:
		return "pc"
	}
}

func normalizeScrobblingMinSeconds(seconds int) int {
	if seconds <= 0 {
		return 30
	}
	if seconds < 10 {
		return 10
	}
	if seconds > 240 {
		return 240
	}
	return seconds
}

func normalizeScrobblingPercentGate(percent int) int {
	if percent <= 0 {
		return 50
	}
	if percent < 10 {
		return 10
	}
	if percent > 100 {
		return 100
	}
	return percent
}

func scrobblingTokenHint(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	if len(token) <= 8 {
		return "••••"
	}
	return token[:4] + "…" + token[len(token)-4:]
}

func (s *Service) Folders(ctx context.Context, userID, limit int) ([]models.Folder, error) {
	if limit < 0 {
		limit = 12
	}
	key := cacheKey("folders", userID, s.userCacheVersion(ctx, userID), limit)
	var cached []models.Folder
	if ok, err := s.cacheGetJSON(ctx, key, &cached); err != nil {
		return nil, err
	} else if ok {
		return cached, nil
	}
	roots, err := s.effectiveLibraryRoots(ctx, userID)
	if err != nil {
		return nil, err
	}
	grouped := map[string]*models.Folder{}
	order := []string{}
	if err := s.forEachSongSummary(ctx, nil, func(item *ent.Song) error {
		root, rel, ok := matchingLibraryRoot(roots, filepath.Dir(item.Path))
		if !ok {
			return nil
		}
		key := rootedFolderPath(root.ID, rel)
		folder := grouped[key]
		if folder == nil {
			name := filepath.Base(rel)
			if rel == "." || rel == "" {
				name = s.rootDisplayName(root)
			}
			folder = &models.Folder{Path: key, Name: name, CoverSongID: item.ID}
			grouped[key] = folder
			order = append(order, key)
		}
		folder.SongCount++
		folder.DurationSeconds += item.DurationSeconds
		return nil
	}); err != nil {
		return nil, err
	}
	capacity := len(order)
	if limit > 0 {
		capacity = minInt(limit, len(order))
	}
	out := make([]models.Folder, 0, capacity)
	for _, rel := range order {
		if limit > 0 && len(out) >= limit {
			break
		}
		out = append(out, *grouped[rel])
	}
	_ = s.cacheSetJSON(ctx, key, out)
	return out, nil
}

func (s *Service) folderSummarySongs(ctx context.Context, root string) ([]*ent.Song, error) {
	prefix := root
	if !strings.HasSuffix(prefix, string(os.PathSeparator)) {
		prefix += string(os.PathSeparator)
	}
	return s.client.Song.Query().
		Select(song.FieldID, song.FieldPath, song.FieldDurationSeconds).
		Where(song.Or(song.PathHasPrefix(prefix), song.Path(root))).
		Order(ent.Asc(song.FieldPath)).
		All(ctx)
}

func (s *Service) forEachSongSummary(ctx context.Context, predicates []predicate.Song, fn func(*ent.Song) error) error {
	const batchSize = 500
	lastID := 0
	for {
		currentPredicates := append([]predicate.Song{}, predicates...)
		if lastID > 0 {
			currentPredicates = append(currentPredicates, song.IDGT(lastID))
		}
		query := s.client.Song.Query().
			Select(song.FieldID, song.FieldPath, song.FieldDurationSeconds).
			Order(ent.Asc(song.FieldID)).
			Limit(batchSize)
		if len(currentPredicates) > 0 {
			query = query.Where(currentPredicates...)
		}
		items, err := query.All(ctx)
		if err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		lastID = items[len(items)-1].ID
		for _, item := range items {
			if err := fn(item); err != nil {
				return err
			}
		}
		if len(items) < batchSize {
			return nil
		}
	}
}

func (s *Service) songsByID(ctx context.Context, ids []int) ([]*ent.Song, error) {
	if len(ids) == 0 {
		return []*ent.Song{}, nil
	}
	return s.client.Song.Query().
		Where(song.IDIn(ids...)).
		Select(browseSongColumns...).
		WithArtist().
		WithAlbum().
		Order(ent.Asc(song.FieldPath)).
		All(ctx)
}

func normalizeFolderRel(rel string) string {
	clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(rel)))
	if clean == "" || clean == "." || clean == "/" {
		return ""
	}
	return strings.Trim(clean, "/")
}

func displayFolderRel(rel string) string {
	if rel == "" {
		return "."
	}
	return rel
}

func (s *Service) RawSong(ctx context.Context, id int) (*ent.Song, error) {
	return s.client.Song.Get(ctx, id)
}

func (s *Service) collectionCoverCacheDir(kind string) string {
	return filepath.Join(s.dataDir, "covers", kind)
}

func recordRemoteCoverFailure(path string) {
	_ = os.WriteFile(path, []byte(time.Now().Format(time.RFC3339)), 0o644)
}

func (s *Service) firstEmbeddedCover(items []*ent.Song) ([]byte, string, error) {
	for _, item := range items {
		data, mimeType, err := s.cachedEmbeddedCover(item)
		if err != nil {
			continue
		}
		if len(data) > 0 {
			return data, mimeType, nil
		}
	}
	return nil, "", nil
}

func (s *Service) cachedEmbeddedCover(item *ent.Song) ([]byte, string, error) {
	if item == nil || strings.TrimSpace(item.Path) == "" {
		return nil, "", nil
	}
	audioPath := ActualAudioPath(item.Path)
	abs, err := filepath.Abs(audioPath)
	if err != nil {
		return nil, "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, "", err
	}
	seed := fmt.Sprintf("%s:%d:%d", abs, info.Size(), info.ModTime().UnixNano())
	sum := sha1.Sum([]byte(seed))
	base := hex.EncodeToString(sum[:])
	cacheDir := filepath.Join(s.dataDir, "covers", "songs")
	for _, ext := range []string{".jpg", ".png", ".webp", ".bin"} {
		path := filepath.Join(cacheDir, base+ext)
		data, err := os.ReadFile(path)
		if err == nil && len(data) > 0 {
			return data, coverMimeByExt(ext), nil
		}
	}
	data, mimeType, err := coverFromFile(abs)
	if err != nil || len(data) == 0 {
		return data, mimeType, err
	}
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return nil, "", err
	}
	ext := coverExtByMime(mimeType)
	_ = os.WriteFile(filepath.Join(cacheDir, base+ext), data, 0o644)
	return data, mimeType, nil
}

func (s *Service) preferredLocalLyrics(ctx context.Context, item *ent.Song, includeSidecar bool) (string, string) {
	if item == nil {
		return "", ""
	}
	if includeSidecar {
		if lyric := readSidecarLyrics(ActualAudioPath(item.Path)); lyric != "" {
			return lyric, "file"
		}
	}
	if item != nil && item.LyricsSource == "embedded" && strings.TrimSpace(item.LyricsEmbedded) != "" {
		return strings.TrimSpace(item.LyricsEmbedded), "embedded"
	}
	audioPath := ActualAudioPath(item.Path)
	if !supportsEmbeddedLyrics(audioPath) {
		return "", ""
	}
	if lyric := strings.TrimSpace(s.probe(ctx, audioPath, probeOptions{DetectLyrics: true, ReadLyrics: true}).Lyrics); lyric != "" {
		_, _ = item.Update().SetLyricsEmbedded(lyric).SetLyricsSource("embedded").SetHasLyrics(true).Save(ctx)
		s.invalidateSongCatalog(ctx)
		return lyric, "embedded"
	}
	return "", ""
}

func readSidecarLyrics(audioPath string) string {
	if strings.TrimSpace(audioPath) == "" {
		return ""
	}
	base := strings.TrimSuffix(audioPath, filepath.Ext(audioPath))
	for _, ext := range []string{".lrc", ".rlrc", ".elrc"} {
		data, err := os.ReadFile(base + ext)
		if err == nil && strings.TrimSpace(string(data)) != "" {
			return strings.TrimSpace(string(data))
		}
	}
	return ""
}

func (s *Service) saveLyricsSidecarIfEnabled(ctx context.Context, audioPath, lyrics string) {
	settings, err := s.GetSettings(ctx)
	if err != nil || !settings.LyricsAutoSaveToSongDir {
		return
	}
	_, _ = writeSidecarLyrics(audioPath, lyrics)
}

func writeSidecarLyrics(audioPath, lyrics string) (bool, error) {
	audioPath = strings.TrimSpace(audioPath)
	lyrics = strings.TrimSpace(lyrics)
	if audioPath == "" || lyrics == "" {
		return false, nil
	}
	target := strings.TrimSuffix(audioPath, filepath.Ext(audioPath)) + ".lrc"
	if existing, err := os.ReadFile(target); err == nil && strings.TrimSpace(string(existing)) == lyrics {
		return false, nil
	}
	if err := os.WriteFile(target, []byte(lyrics+"\n"), 0o644); err != nil {
		return false, err
	}
	return true, nil
}

type albumSongCountRow struct {
	AlbumID *int `json:"album_songs"`
	Count   int  `json:"count"`
}

type artistSongCountRow struct {
	ArtistID *int `json:"artist_songs"`
	Count    int  `json:"count"`
}

type artistAlbumCountRow struct {
	ArtistID *int `json:"artist_albums"`
	Count    int  `json:"count"`
}

type playHistorySongCountRow struct {
	SongID *int `json:"song_play_history"`
	Count  int  `json:"count"`
}

func (s *Service) artistAlbumCounts(ctx context.Context) (map[int]int, error) {
	s.countCacheMu.RLock()
	if cached := s.artistAlbumCountsAll.get(s.countCacheTTL); cached != nil {
		s.countCacheMu.RUnlock()
		return cached, nil
	}
	s.countCacheMu.RUnlock()

	rows := []artistAlbumCountRow{}
	if err := s.client.Album.Query().Where(album.HasSongs()).GroupBy(album.ArtistColumn).Aggregate(ent.Count()).Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counts := make(map[int]int, len(rows))
	for _, row := range rows {
		if row.ArtistID != nil && *row.ArtistID > 0 {
			counts[*row.ArtistID] = row.Count
		}
	}
	s.countCacheMu.Lock()
	s.artistAlbumCountsAll = cachedCounts{counts: counts, fetched: time.Now()}
	s.countCacheMu.Unlock()
	return counts, nil
}

func (s *Service) artistAlbumCountsForIDs(ctx context.Context, ids []int) (map[int]int, error) {
	if len(ids) == 0 {
		return map[int]int{}, nil
	}
	s.countCacheMu.RLock()
	if cached := s.artistAlbumCountsAll.get(s.countCacheTTL); cached != nil {
		s.countCacheMu.RUnlock()
		return countsFromFullMap(cached, ids), nil
	}
	s.countCacheMu.RUnlock()

	rows := []artistAlbumCountRow{}
	if err := s.client.Album.Query().
		Where(album.HasSongs(), album.HasArtistWith(artist.IDIn(ids...))).
		GroupBy(album.ArtistColumn).
		Aggregate(ent.Count()).
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counts := make(map[int]int, len(rows))
	for _, row := range rows {
		if row.ArtistID != nil && *row.ArtistID > 0 {
			counts[*row.ArtistID] = row.Count
		}
	}
	return counts, nil
}

func (s *Service) Playlists(ctx context.Context, userID, limit int) ([]models.Playlist, error) {
	page, err := s.PlaylistsPage(ctx, userID, limit, 0)
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}

func (s *Service) PlaylistsPage(ctx context.Context, userID, limit, offset int) (models.PlaylistPage, error) {
	limit, offset = normalizePage(limit, offset)
	key := cacheKey("playlists-page", userID, s.userCacheVersion(ctx, userID), limit, offset)
	var cached models.PlaylistPage
	if ok, err := s.cacheGetJSON(ctx, key, &cached); err != nil {
		return models.PlaylistPage{}, err
	} else if ok {
		return cached, nil
	}
	total, err := s.client.Playlist.Query().Where(playlist.HasOwnerWith(user.ID(userID))).Count(ctx)
	if err != nil {
		return models.PlaylistPage{}, err
	}
	query := s.client.Playlist.Query().
		Where(playlist.HasOwnerWith(user.ID(userID))).
		Order(ent.Desc(playlist.FieldUpdatedAt)).
		Limit(limit)
	if offset > 0 {
		query = query.Offset(offset)
	}
	items, err := query.All(ctx)
	if err != nil {
		return models.PlaylistPage{}, err
	}
	out := make([]models.Playlist, 0, len(items))
	for _, p := range items {
		count, err := s.playlistSongCount(ctx, p)
		if err != nil {
			return models.PlaylistPage{}, err
		}
		out = append(out, mapPlaylistWithCount(p, count))
	}
	page := models.PlaylistPage{Items: out, Total: total, Limit: limit, Offset: offset, Page: offset/limit + 1}
	_ = s.cacheSetJSON(ctx, key, page)
	return page, nil
}

func (s *Service) Albums(ctx context.Context, userID, limit int) ([]models.Album, error) {
	page, err := s.AlbumsPage(ctx, userID, limit, 0, 0)
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}

func (s *Service) Album(ctx context.Context, userID, id int) (models.Album, error) {
	item, err := s.client.Album.Query().Where(album.ID(id), album.HasSongs()).WithArtist().Only(ctx)
	if err != nil {
		return models.Album{}, err
	}
	counts, err := s.albumSongCountsForIDs(ctx, []int{id})
	if err != nil {
		return models.Album{}, err
	}
	items, err := s.applyAlbumUserState(ctx, userID, []models.Album{mapAlbumWithCount(item, counts[item.ID])})
	if err != nil {
		return models.Album{}, err
	}
	return items[0], nil
}

// cachedSongCollection wraps a song-collection load with a kv cache and a
// singleflight barrier. The cache key embeds userID + userCacheVersion (per-user
// state like favorites/play-count is baked into the result), so it invalidates the
// same way as the sibling *Page methods. The singleflight collapses a burst of
// identical concurrent requests (the artist/album-open thundering herd) into a
// single DB load + single cache write.
func (s *Service) Artists(ctx context.Context, userID, limit int) ([]models.Artist, error) {
	page, err := s.ArtistsPage(ctx, userID, limit, 0, "")
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}

func (s *Service) Artist(ctx context.Context, userID, id int) (models.Artist, error) {
	item, err := s.client.Artist.Get(ctx, id)
	if err != nil {
		return models.Artist{}, err
	}
	songCounts, err := s.artistSongCountsForIDs(ctx, []int{id})
	if err != nil {
		return models.Artist{}, err
	}
	albumCounts, err := s.artistAlbumCountsForIDs(ctx, []int{id})
	if err != nil {
		return models.Artist{}, err
	}
	items, err := s.applyArtistUserState(ctx, userID, []models.Artist{mapArtistWithCounts(item, songCounts[id], albumCounts[id])})
	if err != nil {
		return models.Artist{}, err
	}
	return items[0], nil
}

func (s *Service) UploadWebFont(ctx context.Context, fontFile *multipart.FileHeader) (models.Settings, error) {
	if fontFile == nil {
		return models.Settings{}, errors.New("font file is required")
	}
	if err := os.MkdirAll(s.fontDir(), 0o755); err != nil {
		return models.Settings{}, err
	}
	filename := safeFontFileName(fontFile.Filename)
	if filename == "" || !isSupportedFont(filename) {
		return models.Settings{}, errors.New("unsupported font type")
	}
	src, err := fontFile.Open()
	if err != nil {
		return models.Settings{}, err
	}
	defer src.Close()
	dstPath := filepath.Join(s.fontDir(), filename)
	if _, err := os.Stat(dstPath); err == nil {
		ext := filepath.Ext(filename)
		base := strings.TrimSuffix(filename, ext)
		for i := 1; ; i++ {
			candidate := fmt.Sprintf("%s-%d%s", base, i, ext)
			dstPath = filepath.Join(s.fontDir(), candidate)
			if _, err := os.Stat(dstPath); errors.Is(err, os.ErrNotExist) {
				filename = candidate
				break
			}
		}
	}
	dst, err := os.Create(dstPath)
	if err != nil {
		return models.Settings{}, err
	}
	_, copyErr := io.Copy(dst, src)
	closeErr := dst.Close()
	if copyErr != nil {
		return models.Settings{}, copyErr
	}
	if closeErr != nil {
		return models.Settings{}, closeErr
	}
	font := webFontModel(filename, 0)
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return models.Settings{}, err
	}
	settings.WebFontFamily = font.Family
	settings.WebFontURL = font.URL
	return s.SaveSettings(ctx, settings)
}

var errProbeOutputTooLarge = errors.New("ffprobe output exceeded memory limit")

const maxFFprobeOutputBytes = 4 << 20

type probeOptions struct {
	DetectLyrics bool
	ReadLyrics   bool
}

func (meta fileMetadata) empty() bool {
	return meta.Title == "" &&
		meta.Artist == "" &&
		meta.Album == "" &&
		meta.AlbumArtist == "" &&
		meta.Lyrics == "" &&
		meta.Duration <= 0 &&
		meta.SampleRate <= 0 &&
		meta.BitRate <= 0 &&
		meta.BitDepth <= 0 &&
		meta.Year <= 0
}

func (s *Service) enrichMetadataViaTags(path string, meta *fileMetadata, options probeOptions) {
	hasLyrics := meta.HasLyrics
	if options.ReadLyrics {
		hasLyrics = strings.TrimSpace(meta.Lyrics) != ""
	}
	if meta.Title != "" && meta.Artist != "" && meta.Album != "" && (!options.DetectLyrics || hasLyrics) {
		return
	}
	tags := s.probeTags(path, options)
	if meta.Title == "" {
		meta.Title = tags.Title
	}
	if meta.Artist == "" {
		meta.Artist = tags.Artist
	}
	if meta.Album == "" {
		meta.Album = tags.Album
	}
	if meta.AlbumArtist == "" {
		meta.AlbumArtist = tags.AlbumArtist
	}
	if options.ReadLyrics && meta.Lyrics == "" {
		meta.Lyrics = tags.Lyrics
	}
	if options.DetectLyrics && !meta.HasLyrics {
		meta.HasLyrics = tags.HasLyrics || strings.TrimSpace(tags.Lyrics) != ""
	}
	if meta.Year == 0 && tags.Year > 0 {
		meta.Year = tags.Year
	}
}

type metadataTags map[string]string

func (tags *metadataTags) UnmarshalJSON(data []byte) error {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		*tags = metadataTags{}
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delim, ok := token.(json.Delim)
	if !ok || delim != '{' {
		return fmt.Errorf("expected metadata tags object")
	}
	out := metadataTags{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		key, ok := token.(string)
		if !ok {
			return fmt.Errorf("expected metadata tag key")
		}
		var raw any
		if err := decoder.Decode(&raw); err != nil {
			return err
		}
		value := metadataTagValue(raw)
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		if normalizedKey == "" || strings.TrimSpace(value) == "" {
			continue
		}
		if existing, ok := out[normalizedKey]; ok {
			out[normalizedKey] = preferredMetadataTagValue(existing, value)
		} else {
			out[normalizedKey] = value
		}
	}
	token, err = decoder.Token()
	if err != nil {
		return err
	}
	delim, ok = token.(json.Delim)
	if !ok || delim != '}' {
		return fmt.Errorf("expected end of metadata tags object")
	}
	*tags = out
	return nil
}

func metadataTagValue(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case float64, bool:
		return fmt.Sprint(v)
	default:
		return ""
	}
}

func preferredMetadataTagValue(existing, candidate string) string {
	existingClean := cleanMetadataText(existing)
	candidateClean := cleanMetadataText(candidate)
	if candidateClean == "" {
		return existing
	}
	if existingClean == "" {
		return candidate
	}
	candidateScore := metadataTextScore(candidateClean)
	existingScore := metadataTextScore(existingClean)
	if containsReplacement(candidateClean) {
		candidateScore -= 100
	}
	if containsReplacement(existingClean) {
		existingScore -= 100
	}
	if candidateScore > existingScore {
		return candidate
	}
	return existing
}

type filenameMetadata struct {
	Title  string
	Artist string
	Album  string
}

func applyMetadataFallback(path, libraryRoot string, meta *fileMetadata) {
	fallback := parseFilenameMetadata(path, libraryRoot)
	if metadataNeedsFilenameFallback(meta.Title) {
		meta.Title = fallback.Title
	}
	if metadataNeedsFilenameFallback(meta.Artist) {
		meta.Artist = fallback.Artist
	}
	if metadataNeedsFilenameFallback(meta.Album) {
		meta.Album = fallback.Album
	}
	if metadataNeedsFilenameFallback(meta.AlbumArtist) {
		meta.AlbumArtist = meta.Artist
	}
	if meta.Title == "" {
		meta.Title = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	if meta.Artist == "" {
		meta.Artist = "Unknown Artist"
	}
	if meta.Album == "" {
		meta.Album = "Unknown Album"
	}
}

func applyPathMetadataAssist(path, libraryRoot string, meta *fileMetadata) {
	pathMeta := metadataFromPath(path, libraryRoot)
	if shouldUsePathMetadataValue(meta.Title, pathMeta.Title, false) {
		meta.Title = pathMeta.Title
	}
	if shouldUsePathMetadataValue(meta.Artist, pathMeta.Artist, true) {
		meta.Artist = pathMeta.Artist
	}
	if shouldUsePathMetadataValue(meta.Album, pathMeta.Album, true) || shouldPreferPathAlbum(meta, pathMeta) {
		meta.Album = pathMeta.Album
	}
	if shouldUsePathMetadataValue(meta.AlbumArtist, pathMeta.AlbumArtist, true) {
		meta.AlbumArtist = pathMeta.AlbumArtist
	}
	if meta.AlbumArtist == "" {
		meta.AlbumArtist = firstString(pathMeta.AlbumArtist, meta.Artist)
	}
}

func metadataFromPath(path, libraryRoot string) fileMetadata {
	parsed := parseFilenameMetadata(path, libraryRoot)
	folderAlbum, folderArtist := metadataPathAlbumAndArtistFromFolder(path, libraryRoot)
	artistName := firstString(parsed.Artist, folderArtist)
	albumArtist := firstString(folderArtist, artistName)
	return fileMetadata{
		Title:       parsed.Title,
		Artist:      artistName,
		Album:       firstString(folderAlbum, parsed.Album),
		AlbumArtist: albumArtist,
	}
}

func shouldUsePathMetadataValue(existing, candidate string, strong bool) bool {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" || normalizeCompareText(existing) == normalizeCompareText(candidate) {
		return false
	}
	if metadataNeedsFilenameFallback(existing) || looksLikePromotionalMetadata(existing) {
		return true
	}
	return strong && looksLikeWeakMetadata(existing)
}

func shouldPreferPathAlbum(meta *fileMetadata, pathMeta fileMetadata) bool {
	if pathMeta.Album == "" {
		return false
	}
	if normalizeCompareText(meta.Album) == normalizeCompareText(pathMeta.Album) {
		return false
	}
	if normalizeCompareText(meta.Artist) != "" && normalizeCompareText(meta.Artist) == normalizeCompareText(pathMeta.AlbumArtist) {
		return true
	}
	if normalizeCompareText(meta.AlbumArtist) != "" && normalizeCompareText(meta.AlbumArtist) == normalizeCompareText(pathMeta.AlbumArtist) {
		return true
	}
	return false
}

func looksLikeWeakMetadata(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) <= 1 {
		return true
	}
	if strings.EqualFold(value, "Unknown Artist") || strings.EqualFold(value, "Unknown Album") {
		return true
	}
	return looksLikeTrackNumber(value)
}

func looksLikePromotionalMetadata(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return false
	}
	replacer := strings.NewReplacer(" ", "", "-", "", "_", "", "·", "", "。", ".", "，", ",", "：", ":", "／", "/", "\\", "")
	compact := replacer.Replace(normalized)
	score := 0
	for _, token := range []string{
		"www.", "http://", "https://", ".com", ".net", ".cn", ".org", ".me", ".top", ".xyz", "moofeel",
	} {
		if strings.Contains(normalized, token) {
			score += 3
		}
	}
	for _, token := range []string{
		"微信公众号", "公众号", "微信号", "微信", "微博", "qq群", "qq", "群号", "关注", "扫描二维码", "二维码",
		"论坛", "社区", "博客", "资源", "资源组", "下载", "网盘", "百度网盘", "提取码", "密码",
		"无损", "高品质", "ape", "flac", "hires", "hi-res", "音乐网", "音乐论坛", "音乐下载", "发烧", "母带",
		"by", "整理", "制作", "压制", "分享",
	} {
		if strings.Contains(normalized, token) || strings.Contains(compact, token) {
			score++
		}
	}
	return score >= 2
}

func metadataNeedsFilenameFallback(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || containsReplacement(value) {
		return true
	}
	if looksLikePlaceholderMojibake(value) {
		return true
	}
	if metadataTextScore(value) < 0 {
		return true
	}
	return false
}

func parseFilenameMetadata(path, libraryRoot string) filenameMetadata {
	stem := cleanFilenameForMetadata(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
	album := fallbackAlbumFromFolder(path, libraryRoot)
	if parsed, ok := parseBracketedFilenameMetadata(stem); ok {
		parsed.Album = album
		return parsed
	}
	parts, spacedSeparator := splitFilenameMetadataParts(stem)
	out := filenameMetadata{Title: stem, Album: album}
	switch {
	case len(parts) >= 3 && looksLikeTrackNumber(parts[0]):
		out.Artist = parts[1]
		out.Title = strings.Join(parts[2:], " - ")
	case len(parts) >= 2 && looksLikeTrackNumber(parts[0]):
		out.Title = strings.Join(parts[1:], " - ")
	case len(parts) >= 2 && spacedSeparator:
		out.Artist = parts[0]
		out.Title = strings.Join(parts[1:], " - ")
	case len(parts) == 2:
		out.Title = parts[0]
		out.Artist = parts[1]
	}
	out.Title = cleanFilenameForMetadata(out.Title)
	out.Artist = cleanFilenameForMetadata(out.Artist)
	out.Album = cleanFilenameForMetadata(out.Album)
	return out
}

func parseBracketedFilenameMetadata(stem string) (filenameMetadata, bool) {
	rest := strings.TrimSpace(stem)
	if strings.HasPrefix(rest, "(") {
		if end := strings.Index(rest, ")"); end > 0 && looksLikeTrackNumber(rest[1:end]) {
			rest = strings.TrimSpace(rest[end+1:])
		}
	}
	if strings.HasPrefix(rest, "[") {
		if end := strings.Index(rest, "]"); end > 0 {
			artist := cleanFilenameForMetadata(rest[1:end])
			title := cleanFilenameForMetadata(rest[end+1:])
			if artist != "" && title != "" {
				return filenameMetadata{Title: title, Artist: artist}, true
			}
		}
	}
	return filenameMetadata{}, false
}

func fallbackAlbumFromFolder(path, libraryRoot string) string {
	if strings.TrimSpace(libraryRoot) == "" {
		return ""
	}
	parent := filepath.Dir(path)
	root, err := filepath.Abs(libraryRoot)
	if err != nil {
		return ""
	}
	absParent, err := filepath.Abs(parent)
	if err != nil {
		return ""
	}
	if samePath(root, absParent) {
		return ""
	}
	rel, err := filepath.Rel(root, absParent)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return ""
	}
	return cleanFilenameForMetadata(filepath.Base(absParent))
}

func splitFilenameMetadataParts(stem string) ([]string, bool) {
	spacedSeparator := strings.Contains(stem, " - ")
	rawParts := strings.Split(stem, " - ")
	if !spacedSeparator && strings.Count(stem, "-") == 1 {
		rawParts = strings.Split(stem, "-")
	}
	parts := make([]string, 0, len(rawParts))
	for _, part := range rawParts {
		part = cleanFilenameForMetadata(part)
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts, spacedSeparator
}

func cleanFilenameForMetadata(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "_", " "))
	value = strings.Join(strings.Fields(value), " ")
	lower := strings.ToLower(value)
	if strings.Contains(lower, "official") {
		value = stripParentheticalOfficial(value)
	}
	return strings.TrimSpace(value)
}

func stripParentheticalOfficial(value string) string {
	for {
		start := strings.Index(value, "(")
		if start < 0 {
			break
		}
		end := strings.Index(value[start:], ")")
		if end < 0 {
			break
		}
		end += start
		if strings.Contains(strings.ToLower(value[start:end+1]), "official") {
			value = strings.TrimSpace(value[:start] + value[end+1:])
			continue
		}
		break
	}
	return value
}

func looksLikeTrackNumber(value string) bool {
	value = strings.TrimSpace(value)
	value = strings.Split(value, "/")[0]
	value = strings.TrimSuffix(value, ".")
	value = strings.TrimLeft(value, "0")
	if value == "" {
		value = "0"
	}
	_, err := strconv.Atoi(value)
	return err == nil
}

func looksLikePlaceholderMojibake(value string) bool {
	meaningful := 0
	placeholders := 0
	for _, r := range value {
		if r == ' ' || r == '-' || r == '_' || r == '[' || r == ']' || r == '(' || r == ')' || r == '/' {
			continue
		}
		meaningful++
		if r == '?' || r == '？' {
			placeholders++
		}
	}
	return meaningful > 0 && placeholders*2 >= meaningful
}

func normalizeTags(in map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range in {
		key := strings.ToLower(strings.TrimSpace(k))
		value := cleanMetadataText(v)
		out[key] = value
		if strings.HasPrefix(key, "lyrics-") && strings.TrimSpace(out["lyrics"]) == "" {
			out["lyrics"] = value
		}
	}
	return out
}

func first(tags map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(tags[k]); v != "" {
			return v
		}
	}
	return ""
}

func hasAnyTag(tags map[string]string, keys ...string) bool {
	for _, k := range keys {
		if strings.TrimSpace(tags[k]) != "" {
			return true
		}
	}
	return false
}

func parseYear(value string) int {
	value = strings.TrimSpace(value)
	for i := 0; i+4 <= len(value); i++ {
		year, err := strconv.Atoi(value[i : i+4])
		if err == nil && year >= 1000 && year <= 3000 {
			return year
		}
	}
	return 0
}

func audioMime(format string) string {
	switch format {
	case "mp3":
		return "audio/mpeg"
	case "flac":
		return "audio/flac"
	case "wav":
		return "audio/wav"
	case "m4a", "aac", "alac":
		return "audio/mp4"
	case "ogg", "oga":
		return "audio/ogg"
	case "opus":
		return "audio/opus"
	case "aiff", "aif":
		return "audio/aiff"
	case "ape":
		return "audio/x-ape"
	case "wma":
		return "audio/x-ms-wma"
	default:
		return "application/octet-stream"
	}
}

func audioMimeForPath(path, format string) string {
	format = strings.ToLower(strings.TrimPrefix(format, "."))
	if format == "wma" {
		return audioMime(format)
	}
	mimeType := mime.TypeByExtension(filepath.Ext(path))
	if mimeType != "" {
		return mimeType
	}
	return audioMime(format)
}

func sourceIf(ok bool, yes, no string) string {
	if ok {
		return yes
	}
	return no
}

func IsMissing(err error) bool { return errors.Is(err, os.ErrNotExist) || ent.IsNotFound(err) }

func (s *Service) refreshAlbumYearFromOnline(ctx context.Context, id int) (*ent.Album, error) {
	a, err := s.client.Album.Query().Where(album.ID(id)).WithArtist().Only(ctx)
	if err != nil || a.Year > 0 {
		return a, err
	}
	for _, item := range s.searchRemoteAlbums(ctx, a.Title, albumSearchArtistName(a)) {
		if item.Year <= 0 {
			continue
		}
		updated, err := a.Update().SetYear(item.Year).Save(ctx)
		return updated, err
	}
	return a, nil
}

const albumYearNegPrefix = "runtime:v1:albumyear-neg:"
const albumYearNegTTL = 7 * 24 * time.Hour    // don't retry a never-resolving year for a week
const albumYearInflightTTL = 30 * time.Second // cross-request dedupe window for a single lookup

// triggerAlbumYearRefresh kicks an online album-year lookup in the background so it
// NEVER blocks the request path (the previous inline call could stall a request up to
// 12s, and repeated forever for albums whose year never resolves online). It is deduped
// across requests via a SetNX inflight lock, deduped in-process via singleflight, and
// guarded by a negative cache so a failed lookup isn't retried for a week.
func (s *Service) triggerAlbumYearRefresh(albumID int) {
	if s.cache == nil || albumID <= 0 {
		return
	}
	bg := context.Background()
	negKey := fmt.Sprintf("%s%d", albumYearNegPrefix, albumID)
	if _, ok, _ := s.cache.Get(bg, negKey); ok {
		return // recently failed to resolve; skip
	}
	lockKey := negKey + ":inflight"
	if ok, err := s.cache.SetNX(bg, lockKey, []byte("1"), albumYearInflightTTL); err != nil || !ok {
		return // another request is already refreshing this album
	}
	go func() {
		defer func() { _ = s.cache.Delete(bg, lockKey) }()
		_, _, _ = s.yearRefreshSF.Do(strconv.Itoa(albumID), func() (any, error) {
			ctx, cancel := context.WithTimeout(bg, 15*time.Second)
			defer cancel()
			updated, err := s.refreshAlbumYearFromOnline(ctx, albumID)
			if err != nil || updated == nil || updated.Year == 0 {
				_ = s.cache.Set(bg, negKey, []byte("1"), albumYearNegTTL) // negative-cache the miss
				return nil, nil
			}
			s.invalidateLibraryCache(bg) // surface the resolved year in album-page / album-songs caches
			return nil, nil
		})
	}()
}

func albumSearchArtistName(a *ent.Album) string {
	if a == nil {
		return ""
	}
	artistName := strings.TrimSpace(a.AlbumArtist)
	if artistName == "" && a.Edges.Artist != nil {
		artistName = a.Edges.Artist.Name
	}
	return strings.TrimSpace(artistName)
}

func (s *Service) searchRemoteAlbums(ctx context.Context, title, artistName string) []online.AlbumInfo {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	type providerResult struct {
		items []online.AlbumInfo
	}
	resultCh := make(chan providerResult, len(s.online))
	var wg sync.WaitGroup
	for _, provider := range s.online {
		provider := provider
		wg.Add(1)
		go func() {
			defer wg.Done()
			if !acquireRemoteAlbumSearchSlot(ctx) {
				return
			}
			defer releaseRemoteAlbumSearchSlot()
			queries := []string{artistName}
			if strings.TrimSpace(artistName) != "" {
				queries = append(queries, "")
			}
			itemsOut := []online.AlbumInfo{}
			seenProvider := map[string]bool{}
			for _, currentArtist := range queries {
				items, err := provider.SearchAlbums(ctx, title, currentArtist)
				if err != nil {
					continue
				}
				for _, item := range items {
					key := item.Source + ":" + item.ID
					if item.ID == "" || seenProvider[key] {
						continue
					}
					seenProvider[key] = true
					info := online.AlbumInfo{AlbumCandidate: item}
					if detail, detailErr := provider.AlbumInfo(ctx, item.ID); detailErr == nil {
						mergeRemoteAlbumInfo(&info, detail)
					}
					itemsOut = append(itemsOut, info)
				}
			}
			select {
			case resultCh <- providerResult{items: itemsOut}:
			case <-ctx.Done():
			}
		}()
	}
	go func() {
		wg.Wait()
		close(resultCh)
	}()
	out := []online.AlbumInfo{}
	seen := map[string]bool{}
	for result := range resultCh {
		for _, item := range result.items {
			key := item.Source + ":" + item.ID
			if item.ID == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, item)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return remoteAlbumScore(out[i], title, artistName) > remoteAlbumScore(out[j], title, artistName)
	})
	if len(out) > 12 {
		out = out[:12]
	}
	return out
}

var remoteAlbumSearchSlots = make(chan struct{}, remoteAlbumSearchConcurrency)

func acquireRemoteAlbumSearchSlot(ctx context.Context) bool {
	select {
	case remoteAlbumSearchSlots <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

func releaseRemoteAlbumSearchSlot() {
	select {
	case <-remoteAlbumSearchSlots:
	default:
	}
}

func mergeRemoteAlbumInfo(base *online.AlbumInfo, detail online.AlbumInfo) {
	if strings.TrimSpace(detail.Title) != "" {
		base.Title = detail.Title
	}
	if strings.TrimSpace(detail.Artist) != "" {
		base.Artist = detail.Artist
	}
	if strings.TrimSpace(detail.Cover) != "" {
		base.Cover = detail.Cover
	}
	if strings.TrimSpace(detail.ReleaseDate) != "" {
		base.ReleaseDate = detail.ReleaseDate
	}
	if detail.Year > 0 {
		base.Year = detail.Year
	}
	if strings.TrimSpace(detail.Description) != "" {
		base.Description = detail.Description
	}
	if detail.TrackCount > 0 {
		base.TrackCount = detail.TrackCount
	}
	if strings.TrimSpace(detail.Link) != "" {
		base.Link = detail.Link
	}
	if len(detail.Tracks) > 0 {
		base.Tracks = detail.Tracks
	}
}

func remoteAlbumScore(item online.AlbumInfo, title, artistName string) int {
	score := 0
	if normalizeCompareText(item.Title) == normalizeCompareText(title) {
		score += 80
	} else if strings.Contains(normalizeCompareText(item.Title), normalizeCompareText(title)) || strings.Contains(normalizeCompareText(title), normalizeCompareText(item.Title)) {
		score += 35
	}
	if artistName != "" {
		if normalizeCompareText(item.Artist) == normalizeCompareText(artistName) {
			score += 60
		} else if strings.Contains(normalizeCompareText(item.Artist), normalizeCompareText(artistName)) || strings.Contains(normalizeCompareText(artistName), normalizeCompareText(item.Artist)) {
			score += 25
		}
	}
	if item.Cover != "" {
		score += 10
	}
	if item.Year > 0 {
		score += 20
	}
	if item.Description != "" {
		score += 5
	}
	if item.TrackCount > 0 {
		score += 8
	}
	return score
}

func normalizeCompareText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	for _, token := range []string{"（", "(", "[", "【"} {
		if idx := strings.Index(value, token); idx >= 0 {
			value = value[:idx]
		}
	}
	return strings.NewReplacer(" ", "", "-", "", "_", "", "·", "", "・", "", "'", "", "’", "").Replace(value)
}

func firstString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
