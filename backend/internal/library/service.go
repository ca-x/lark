package library

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/dhowden/tag"

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

var supportedExts = map[string]bool{
	".mp3": true, ".flac": true, ".wav": true, ".aiff": true, ".aif": true,
	".m4a": true, ".aac": true, ".ogg": true, ".oga": true, ".opus": true,
	".dsf": true, ".dff": true, ".dst": true, ".ape": true, ".alac": true,
}

var coverHTTPClient = &http.Client{Timeout: 6 * time.Second}

type Service struct {
	client     *ent.Client
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

func New(client *ent.Client, dataDir, libraryDir, ffprobe, ffmpeg string, neteaseClient *netease.Client, qqClient *qqmusic.Client, opts ...Option) *Service {
	svc := &Service{client: client, dataDir: dataDir, libraryDir: libraryDir, ffprobe: ffprobe, ffmpeg: ffmpeg, netease: neteaseClient, qqmusic: qqClient, online: online.Providers(), cache: kv.NoopStore{}, cacheTTL: 2 * time.Minute}
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
	ID      string
	Path    string
	Note    string
	Builtin bool
}

func (s *Service) builtinLibraryRoot() (libraryRoot, error) {
	path, err := filepath.Abs(s.libraryDir)
	if err != nil {
		return libraryRoot{}, err
	}
	return libraryRoot{ID: "env", Path: path, Note: "", Builtin: true}, nil
}

func (s *Service) effectiveLibraryRoots(ctx context.Context, userID int) ([]libraryRoot, error) {
	root, err := s.builtinLibraryRoot()
	if err != nil {
		return nil, err
	}
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
		roots = append(roots, libraryRoot{ID: strconv.Itoa(item.ID), Path: abs, Note: item.Note})
	}
	return roots, nil
}

func (s *Service) LibraryDirectories(ctx context.Context, userID int) ([]models.LibraryDirectory, error) {
	root, err := s.builtinLibraryRoot()
	if err != nil {
		return nil, err
	}
	out := []models.LibraryDirectory{{ID: root.ID, Path: root.Path, Builtin: true}}
	if userID == 0 || s.client == nil {
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
		out = append(out, mapLibraryDirectory(item))
	}
	return out, nil
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
	return nil
}

type resolvedFolderRoot struct {
	Root libraryRoot
	Rel  string
	Path string
}

func (s *Service) resolveLibraryFolderForUser(ctx context.Context, userID int, relPath string) (resolvedFolderRoot, error) {
	roots, err := s.effectiveLibraryRoots(ctx, userID)
	if err != nil {
		return resolvedFolderRoot{}, err
	}
	rootID, rel := splitRootedFolderPath(relPath)
	var root libraryRoot
	found := false
	for _, item := range roots {
		if item.ID == rootID {
			root = item
			found = true
			break
		}
	}
	if !found {
		return resolvedFolderRoot{}, fmt.Errorf("library directory not found")
	}
	cleanRel := filepath.Clean(strings.TrimSpace(rel))
	if cleanRel == "" || cleanRel == "." || cleanRel == string(os.PathSeparator) {
		return resolvedFolderRoot{Root: root, Rel: "", Path: root.Path}, nil
	}
	if filepath.IsAbs(cleanRel) {
		return resolvedFolderRoot{}, fmt.Errorf("folder path must be relative")
	}
	target, err := filepath.Abs(filepath.Join(root.Path, cleanRel))
	if err != nil {
		return resolvedFolderRoot{}, err
	}
	if target != root.Path && !strings.HasPrefix(target, root.Path+string(os.PathSeparator)) {
		return resolvedFolderRoot{}, fmt.Errorf("folder path escapes library")
	}
	return resolvedFolderRoot{Root: root, Rel: normalizeFolderRel(cleanRel), Path: target}, nil
}

func splitRootedFolderPath(path string) (string, string) {
	trimmed := strings.TrimSpace(path)
	if strings.HasPrefix(trimmed, "@") {
		parts := strings.SplitN(strings.TrimPrefix(trimmed, "@"), ":", 2)
		if len(parts) == 2 && strings.TrimSpace(parts[0]) != "" {
			return strings.TrimSpace(parts[0]), parts[1]
		}
	}
	return "env", trimmed
}

func rootedFolderPath(rootID, rel string) string {
	clean := displayFolderRel(normalizeFolderRel(rel))
	if rootID == "env" {
		return clean
	}
	return "@" + rootID + ":" + clean
}

func (s *Service) rootDisplayName(root libraryRoot) string {
	if strings.TrimSpace(root.Note) != "" {
		return root.Note
	}
	return filepath.Base(root.Path)
}

func IsSupported(path string) bool { return supportedExts[strings.ToLower(filepath.Ext(path))] }

func (s *Service) ScanStatus() models.ScanStatus {
	s.scanMu.RLock()
	defer s.scanMu.RUnlock()
	return cloneScanStatus(s.scanStatus)
}

func (s *Service) Scan(ctx context.Context, userID int) (models.ScanResult, error) {
	if !s.scanRunMu.TryLock() {
		return models.ScanResult{Errors: []string{ErrScanRunning.Error()}}, ErrScanRunning
	}
	defer s.scanRunMu.Unlock()
	started := time.Now()
	roots, err := s.effectiveLibraryRoots(ctx, userID)
	if err != nil {
		return models.ScanResult{Errors: []string{err.Error()}}, err
	}
	scanCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	s.setScanStatus(func(status *models.ScanStatus) {
		s.scanCancel = cancel
		*status = models.ScanStatus{Running: true, CurrentDir: s.libraryDir, Errors: []string{}, StartedAt: &started}
	})
	result := models.ScanResult{Errors: []string{}}
	defer func() {
		finished := time.Now()
		s.setScanStatus(func(status *models.ScanStatus) {
			status.Running = false
			status.Canceled = result.Canceled
			status.FinishedAt = &finished
			s.scanCancel = nil
		})
	}()
	for _, root := range roots {
		rootPath := root.Path
		err := filepath.WalkDir(rootPath, func(path string, d os.DirEntry, err error) error {
			if scanCtx.Err() != nil {
				result.Canceled = true
				return ErrScanCanceled
			}
			if err != nil {
				result.Errors = append(result.Errors, err.Error())
				s.updateScanProgress(path, filepath.Dir(path), &result)
				return nil
			}
			if d.IsDir() {
				if shouldSkipScanDir(rootPath, path, d.Name()) {
					result.Skipped++
					s.updateScanProgress("", filepath.Dir(path), &result)
					return filepath.SkipDir
				}
				result.CurrentDir = path
				s.updateScanProgress("", path, &result)
				return nil
			}
			result.CurrentDir = filepath.Dir(path)
			s.updateScanProgress(path, result.CurrentDir, &result)
			if !IsSupported(path) {
				result.Skipped++
				s.updateScanProgress(path, result.CurrentDir, &result)
				return nil
			}
			result.Scanned++
			added, err := s.importFile(scanCtx, path, false)
			if scanCtx.Err() != nil {
				result.Canceled = true
				s.updateScanProgress(path, result.CurrentDir, &result)
				return ErrScanCanceled
			}
			if err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", path, err))
				s.updateScanProgress(path, result.CurrentDir, &result)
				return nil
			}
			if added {
				result.Added++
			} else {
				result.Updated++
			}
			s.updateScanProgress(path, result.CurrentDir, &result)
			return nil
		})
		if errors.Is(err, ErrScanCanceled) {
			break
		}
		if err != nil {
			return result, err
		}
	}
	if result.Canceled {
		s.invalidateLibraryCache(ctx)
		s.invalidateSearchCatalogs(ctx)
		return result, nil
	}
	rootPaths := make([]string, 0, len(roots))
	for _, root := range roots {
		rootPaths = append(rootPaths, root.Path)
	}
	if err := s.cleanupMissingLibraryEntries(ctx, rootPaths); err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("cleanup missing library entries: %v", err))
	}
	s.invalidateLibraryCache(ctx)
	s.invalidateSearchCatalogs(ctx)
	return result, nil
}

func (s *Service) CancelScan() bool {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	if !s.scanStatus.Running || s.scanCancel == nil {
		return false
	}
	s.scanStatus.Canceled = true
	s.scanCancel()
	return true
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
			if _, err := os.Stat(item.Path); os.IsNotExist(err) {
				missingIDs = append(missingIDs, item.ID)
			}
		}
		if len(missingIDs) > 0 {
			if _, err := s.client.UserSongFavorite.Delete().
				Where(usersongfavorite.HasSongWith(song.IDIn(missingIDs...))).
				Exec(ctx); err != nil {
				return err
			}
			if _, err := s.client.PlayHistory.Delete().
				Where(playhistory.HasSongWith(song.IDIn(missingIDs...))).
				Exec(ctx); err != nil {
				return err
			}
			if _, err := s.client.Song.Delete().Where(song.IDIn(missingIDs...)).Exec(ctx); err != nil {
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

func shouldSkipScanDir(root, path, name string) bool {
	if samePath(root, path) {
		return false
	}
	return name == ".shared-center"
}

func samePath(a, b string) bool {
	absA, errA := filepath.Abs(a)
	absB, errB := filepath.Abs(b)
	if errA == nil && errB == nil {
		return filepath.Clean(absA) == filepath.Clean(absB)
	}
	return filepath.Clean(a) == filepath.Clean(b)
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
		status.Errors = append(status.Errors[:0], result.Errors...)
	})
}

func (s *Service) setScanStatus(update func(*models.ScanStatus)) {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	update(&s.scanStatus)
}

func cloneScanStatus(status models.ScanStatus) models.ScanStatus {
	status.Errors = append([]string{}, status.Errors...)
	return status
}

func (s *Service) ImportFile(ctx context.Context, path string) (bool, error) {
	return s.importFile(ctx, path, true)
}

func (s *Service) importFile(ctx context.Context, path string, invalidate bool) (bool, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return false, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return false, err
	}
	if info.IsDir() || !IsSupported(abs) {
		return false, fmt.Errorf("unsupported audio file")
	}
	meta := s.probe(ctx, abs)
	applyMetadataFallback(abs, s.libraryDir, &meta)
	format := strings.TrimPrefix(strings.ToLower(filepath.Ext(abs)), ".")
	mimeType := mime.TypeByExtension(filepath.Ext(abs))
	if mimeType == "" {
		mimeType = audioMime(format)
	}
	artistEntity, err := s.ensureArtist(ctx, meta.Artist)
	if err != nil {
		return false, err
	}
	albumEntity, err := s.ensureAlbum(ctx, meta.Album, meta.AlbumArtist, artistEntity, meta.Year)
	if err != nil {
		return false, err
	}
	existing, err := s.client.Song.Query().Where(song.Path(abs)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return false, err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.Song.Create().
			SetTitle(meta.Title).
			SetPath(abs).
			SetFileName(filepath.Base(abs)).
			SetFormat(format).
			SetMime(mimeType).
			SetSizeBytes(info.Size()).
			SetDurationSeconds(meta.Duration).
			SetSampleRate(meta.SampleRate).
			SetBitRate(meta.BitRate).
			SetBitDepth(meta.BitDepth).
			SetYear(meta.Year).
			SetLyricsEmbedded(meta.Lyrics).
			SetLyricsSource(sourceIf(meta.Lyrics != "", "embedded", "")).
			SetArtist(artistEntity).
			SetAlbum(albumEntity).
			Save(ctx)
		if err == nil && invalidate {
			s.invalidateLibraryCache(ctx)
			s.invalidateSearchCatalogs(ctx)
		}
		return true, err
	}
	_, err = existing.Update().
		SetTitle(meta.Title).
		SetFileName(filepath.Base(abs)).
		SetFormat(format).
		SetMime(mimeType).
		SetSizeBytes(info.Size()).
		SetDurationSeconds(meta.Duration).
		SetSampleRate(meta.SampleRate).
		SetBitRate(meta.BitRate).
		SetBitDepth(meta.BitDepth).
		SetYear(meta.Year).
		SetLyricsEmbedded(meta.Lyrics).
		SetLyricsSource(sourceIf(meta.Lyrics != "", "embedded", existing.LyricsSource)).
		SetArtist(artistEntity).
		SetAlbum(albumEntity).
		Save(ctx)
	if err == nil && invalidate {
		s.invalidateLibraryCache(ctx)
		s.invalidateSearchCatalogs(ctx)
	}
	return false, err
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
	cacheable := limit <= 500
	key := ""
	if cacheable {
		key = cacheKey("songs-page", userID, s.userCacheVersion(ctx, userID), term, favorites, limit, offset)
		var cached models.SongPage
		if ok, err := s.cacheGetJSON(ctx, key, &cached); err != nil {
			return models.SongPage{}, err
		} else if ok {
			return cached, nil
		}
	}
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
	query := s.client.Song.Query().WithArtist().WithAlbum().Order(ent.Desc(song.FieldUpdatedAt))
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
	out, err := s.applySongUserState(ctx, userID, mapSongs(items))
	if err != nil {
		return models.SongPage{}, err
	}
	page := models.SongPage{
		Items:  out,
		Total:  total,
		Limit:  limit,
		Offset: offset,
		Page:   offset/limit + 1,
	}
	if cacheable {
		_ = s.cacheSetJSON(ctx, key, page)
	}
	return page, nil
}

func (s *Service) songListPredicates(ctx context.Context, userID int, term string, favorites bool) ([]predicate.Song, error) {
	predicates := []predicate.Song{}
	if term != "" {
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

func (s *Service) RecentAddedSongs(ctx context.Context, userID, limit int) ([]models.Song, error) {
	if limit <= 0 || limit > 50 {
		limit = 12
	}
	items, err := s.client.Song.Query().
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
	histories, err := s.client.PlayHistory.Query().
		Where(playhistory.HasUserWith(user.ID(userID))).
		WithSong(func(q *ent.SongQuery) {
			q.WithArtist().WithAlbum()
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
	return s.applySongUserState(ctx, userID, mapSongs(items))
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

func dailyCandidateOffset(day string, userID, total, candidateLimit int) int {
	if total <= candidateLimit {
		return 0
	}
	return int(dailySeed(day, userID) % uint64(total-candidateLimit+1))
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

const libraryCachePrefix = "library:v1:"
const artistCatalogCacheKey = libraryCachePrefix + "catalog:v2:artists"
const songCatalogCacheKey = libraryCachePrefix + "catalog:v2:songs"
const transcodeWarmLeasePrefix = "runtime:v1:transcode-warm:"
const remoteAlbumSearchConcurrency = 3

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

func (s *Service) TryAcquireTranscodeWarmLease(ctx context.Context, cachePath string, ttl time.Duration) (bool, error) {
	if s.cache == nil || ttl <= 0 {
		return true, nil
	}
	value := []byte(strconv.FormatInt(time.Now().Unix(), 10))
	return s.cache.SetNX(ctx, transcodeWarmLeaseKey(cachePath), value, ttl)
}

func (s *Service) ReleaseTranscodeWarmLease(ctx context.Context, cachePath string) {
	if s.cache == nil {
		return
	}
	_ = s.cache.Delete(ctx, transcodeWarmLeaseKey(cachePath))
}

func transcodeWarmLeaseKey(cachePath string) string {
	sum := sha1.Sum([]byte(cachePath))
	return transcodeWarmLeasePrefix + hex.EncodeToString(sum[:])
}

func (s *Service) invalidateLibraryCache(ctx context.Context) {
	if s.cache == nil {
		return
	}
	_ = s.cache.DeletePrefix(ctx, libraryCachePrefix)
}

const userVersionPrefix = libraryCachePrefix + "uver:v1:"

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

func (s *Service) FolderDirectory(ctx context.Context, userID int, relPath string) (*models.FolderDirectory, error) {
	resolved, err := s.resolveLibraryFolderForUser(ctx, userID, relPath)
	if err != nil {
		return nil, err
	}
	root := resolved.Root.Path
	currentRel := displayFolderRel(resolved.Rel)
	roots, err := s.effectiveLibraryRoots(ctx, userID)
	if err != nil {
		return nil, err
	}
	prefix := resolved.Path
	if !strings.HasSuffix(prefix, string(os.PathSeparator)) {
		prefix += string(os.PathSeparator)
	}
	currentClean := normalizeFolderRel(currentRel)
	children := map[string]*models.Folder{}
	childOrder := []string{}
	directSongIDs := []int{}
	var songCount int
	var duration float64
	var coverID int

	if err := s.forEachSongSummary(ctx, []predicate.Song{song.Or(song.PathHasPrefix(prefix), song.Path(resolved.Path))}, func(item *ent.Song) error {
		itemRel, ok := relativeFolderPath(root, filepath.Dir(item.Path))
		if !ok {
			return nil
		}
		itemClean := normalizeFolderRel(itemRel)
		if !isFolderDescendantOrSame(currentClean, itemClean) {
			return nil
		}
		songCount++
		duration += item.DurationSeconds
		if coverID == 0 {
			coverID = item.ID
		}
		if itemClean == currentClean {
			directSongIDs = append(directSongIDs, item.ID)
			return nil
		}
		childRel, ok := immediateChildFolder(currentClean, itemClean)
		if !ok {
			return nil
		}
		child := children[childRel]
		if child == nil {
			child = &models.Folder{
				Path:        rootedFolderPath(resolved.Root.ID, childRel),
				Name:        filepath.Base(filepath.FromSlash(childRel)),
				CoverSongID: item.ID,
			}
			children[childRel] = child
			childOrder = append(childOrder, childRel)
		}
		child.SongCount++
		child.DurationSeconds += item.DurationSeconds
		return nil
	}); err != nil {
		return nil, err
	}

	if resolved.Root.ID == "env" && currentClean == "" {
		for _, extraRoot := range roots {
			if extraRoot.ID == "env" {
				continue
			}
			folder := &models.Folder{Path: rootedFolderPath(extraRoot.ID, "."), Name: s.rootDisplayName(extraRoot)}
			rootItems, err := s.folderSummarySongs(ctx, extraRoot.Path)
			if err != nil {
				return nil, err
			}
			for _, item := range rootItems {
				folder.SongCount++
				folder.DurationSeconds += item.DurationSeconds
				if folder.CoverSongID == 0 {
					folder.CoverSongID = item.ID
				}
			}
			children[folder.Path] = folder
			childOrder = append(childOrder, folder.Path)
		}
	}

	sort.SliceStable(childOrder, func(i, j int) bool {
		return strings.ToLower(children[childOrder[i]].Name) < strings.ToLower(children[childOrder[j]].Name)
	})
	folders := make([]models.Folder, 0, len(childOrder))
	for _, childRel := range childOrder {
		folders = append(folders, *children[childRel])
	}
	directEntSongs, err := s.songsByID(ctx, directSongIDs)
	if err != nil {
		return nil, err
	}
	directSongs, err := s.applySongUserState(ctx, userID, mapSongs(directEntSongs))
	if err != nil {
		return nil, err
	}

	parentPath := ""
	if currentClean != "" {
		parentPath = rootedFolderPath(resolved.Root.ID, parentFolderRel(currentClean))
	}

	return &models.FolderDirectory{
		Path:            rootedFolderPath(resolved.Root.ID, currentClean),
		Name:            s.folderDisplayName(root, currentClean),
		ParentPath:      parentPath,
		Breadcrumbs:     s.folderBreadcrumbsForRoot(resolved.Root, currentClean),
		Folders:         folders,
		Songs:           directSongs,
		SongCount:       songCount,
		DurationSeconds: duration,
		CoverSongID:     coverID,
	}, nil
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
		WithArtist().
		WithAlbum().
		Order(ent.Asc(song.FieldPath)).
		All(ctx)
}

func (s *Service) FolderSongs(ctx context.Context, userID int, relPath string, limit int) ([]models.Song, error) {
	resolved, err := s.resolveLibraryFolderForUser(ctx, userID, relPath)
	if err != nil {
		return nil, err
	}
	folderPath := resolved.Path
	prefix := folderPath
	if !strings.HasSuffix(prefix, string(os.PathSeparator)) {
		prefix += string(os.PathSeparator)
	}
	query := s.client.Song.Query().
		Where(song.Or(song.PathHasPrefix(prefix), song.Path(folderPath))).
		WithArtist().
		WithAlbum().
		Order(ent.Asc(song.FieldPath))
	query = applySongQueryLimit(query, limit)
	items, err := query.All(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.applySongUserState(ctx, userID, mapSongs(items))
	if err != nil {
		return nil, err
	}
	return out, nil
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

func isFolderDescendantOrSame(parent, child string) bool {
	if parent == "" {
		return true
	}
	return child == parent || strings.HasPrefix(child, parent+"/")
}

func immediateChildFolder(parent, child string) (string, bool) {
	if child == parent {
		return "", false
	}
	remainder := child
	if parent != "" {
		if !strings.HasPrefix(child, parent+"/") {
			return "", false
		}
		remainder = strings.TrimPrefix(child, parent+"/")
	}
	first, _, _ := strings.Cut(remainder, "/")
	if first == "" {
		return "", false
	}
	if parent == "" {
		return first, true
	}
	return parent + "/" + first, true
}

func parentFolderRel(rel string) string {
	clean := normalizeFolderRel(rel)
	if clean == "" {
		return ""
	}
	parent := filepath.ToSlash(filepath.Dir(clean))
	if parent == "." {
		return "."
	}
	return parent
}

func (s *Service) folderDisplayName(root, rel string) string {
	if normalizeFolderRel(rel) == "" {
		return filepath.Base(root)
	}
	return filepath.Base(filepath.FromSlash(rel))
}

func (s *Service) folderBreadcrumbs(root, rel string) []models.FolderBreadcrumb {
	clean := normalizeFolderRel(rel)
	breadcrumbs := []models.FolderBreadcrumb{{
		Path: ".",
		Name: filepath.Base(root),
	}}
	if clean == "" {
		return breadcrumbs
	}
	parts := strings.Split(clean, "/")
	for i := range parts {
		path := strings.Join(parts[:i+1], "/")
		breadcrumbs = append(breadcrumbs, models.FolderBreadcrumb{
			Path: path,
			Name: parts[i],
		})
	}
	return breadcrumbs
}

func (s *Service) resolveLibraryFolder(relPath string) (string, error) {
	root, err := filepath.Abs(s.libraryDir)
	if err != nil {
		return "", err
	}
	cleanRel := filepath.Clean(strings.TrimSpace(relPath))
	if cleanRel == "" || cleanRel == "." || cleanRel == string(os.PathSeparator) {
		return root, nil
	}
	if filepath.IsAbs(cleanRel) {
		return "", fmt.Errorf("folder path must be relative")
	}
	target, err := filepath.Abs(filepath.Join(root, cleanRel))
	if err != nil {
		return "", err
	}
	if target != root && !strings.HasPrefix(target, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("folder path escapes library")
	}
	return target, nil
}

func matchingLibraryRoot(roots []libraryRoot, path string) (libraryRoot, string, bool) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return libraryRoot{}, "", false
	}
	var best libraryRoot
	bestRel := ""
	bestLen := -1
	for _, root := range roots {
		rel, ok := relativeFolderPath(root.Path, abs)
		if !ok {
			continue
		}
		if len(root.Path) > bestLen {
			best = root
			bestRel = rel
			bestLen = len(root.Path)
		}
	}
	if bestLen < 0 {
		return libraryRoot{}, "", false
	}
	return best, bestRel, true
}

func (s *Service) folderBreadcrumbsForRoot(root libraryRoot, rel string) []models.FolderBreadcrumb {
	clean := normalizeFolderRel(rel)
	breadcrumbs := []models.FolderBreadcrumb{{
		Path: rootedFolderPath(root.ID, "."),
		Name: s.rootDisplayName(root),
	}}
	if clean == "" {
		return breadcrumbs
	}
	parts := strings.Split(clean, "/")
	for i := range parts {
		path := strings.Join(parts[:i+1], "/")
		breadcrumbs = append(breadcrumbs, models.FolderBreadcrumb{
			Path: rootedFolderPath(root.ID, path),
			Name: parts[i],
		})
	}
	return breadcrumbs
}

func relativeFolderPath(root, folder string) (string, bool) {
	rel, err := filepath.Rel(root, folder)
	if err != nil {
		return "", false
	}
	if strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", false
	}
	if rel == "" {
		return ".", true
	}
	return filepath.ToSlash(rel), true
}

func (s *Service) RawSong(ctx context.Context, id int) (*ent.Song, error) {
	return s.client.Song.Get(ctx, id)
}

func (s *Service) SongCover(ctx context.Context, id int) ([]byte, string, error) {
	item, err := s.client.Song.Get(ctx, id)
	if err != nil {
		return nil, "", err
	}
	return s.cachedEmbeddedCover(item)
}

func (s *Service) AlbumCover(ctx context.Context, id int) ([]byte, string, error) {
	items, err := s.client.Song.Query().
		Select(song.FieldID, song.FieldPath).
		Where(song.HasAlbumWith(album.ID(id))).
		Order(ent.Asc(song.FieldID)).
		Limit(50).
		All(ctx)
	if err != nil {
		return nil, "", err
	}
	data, mimeType, err := s.firstEmbeddedCover(items)
	if err != nil || len(data) > 0 {
		return data, mimeType, err
	}
	a, err := s.client.Album.Query().Where(album.ID(id)).WithArtist().Only(ctx)
	if err != nil {
		return nil, "", err
	}
	for _, info := range s.searchRemoteAlbums(ctx, a.Title, albumSearchArtistName(a)) {
		if a.Year == 0 && info.Year > 0 {
			if updated, updateErr := a.Update().SetYear(info.Year).Save(ctx); updateErr == nil {
				a = updated
			}
		}
		if strings.TrimSpace(info.Cover) == "" {
			continue
		}
		return s.cachedRemoteImage(ctx, "album", strconv.Itoa(id), info.Cover)
	}
	return nil, "", nil
}

func (s *Service) ArtistCover(ctx context.Context, id int) ([]byte, string, error) {
	items, err := s.client.Song.Query().
		Select(song.FieldID, song.FieldPath).
		Where(song.HasArtistWith(artist.ID(id))).
		Order(ent.Asc(song.FieldID)).
		Limit(50).
		All(ctx)
	if err != nil {
		return nil, "", err
	}
	data, mimeType, err := s.firstEmbeddedCover(items)
	if err != nil || len(data) > 0 {
		return data, mimeType, err
	}
	a, err := s.client.Artist.Query().Where(artist.ID(id)).WithAlbums(func(q *ent.AlbumQuery) {
		q.Where(album.HasSongs()).Order(ent.Desc(album.FieldUpdatedAt)).Limit(20)
	}).Only(ctx)
	if err != nil {
		return nil, "", err
	}
	for _, candidate := range a.Edges.Albums {
		infoItems := s.searchRemoteAlbums(ctx, candidate.Title, firstString(candidate.AlbumArtist, a.Name))
		for _, info := range infoItems {
			if strings.TrimSpace(info.Cover) == "" {
				continue
			}
			return s.cachedRemoteImage(ctx, "artist", strconv.Itoa(id), info.Cover)
		}
	}
	return nil, "", nil
}

func (s *Service) cachedRemoteImage(ctx context.Context, kind, key, remoteURL string) ([]byte, string, error) {
	remoteURL = strings.TrimSpace(remoteURL)
	if remoteURL == "" {
		return nil, "", nil
	}
	cacheDir := filepath.Join(s.dataDir, "online-covers", kind)
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return nil, "", err
	}
	safeKey := strings.NewReplacer("/", "_", "\\", "_", ":", "_").Replace(key)
	failPath := filepath.Join(cacheDir, safeKey+".fail")
	if info, err := os.Stat(failPath); err == nil && time.Since(info.ModTime()) < 30*time.Minute {
		return nil, "", nil
	}
	for _, ext := range []string{".jpg", ".png", ".webp"} {
		path := filepath.Join(cacheDir, safeKey+ext)
		data, err := os.ReadFile(path)
		if err == nil && len(data) > 0 {
			return data, mime.TypeByExtension(ext), nil
		}
	}
	downloadCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(downloadCtx, http.MethodGet, remoteURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 Lark Music Player")
	res, err := coverHTTPClient.Do(req)
	if err != nil {
		recordRemoteCoverFailure(failPath)
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		recordRemoteCoverFailure(failPath)
		return nil, "", fmt.Errorf("cover status %d", res.StatusCode)
	}
	contentType := res.Header.Get("Content-Type")
	ext := ".jpg"
	if strings.Contains(contentType, "png") {
		ext = ".png"
	} else if strings.Contains(contentType, "webp") {
		ext = ".webp"
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		recordRemoteCoverFailure(failPath)
		return nil, "", err
	}
	if len(data) == 0 {
		recordRemoteCoverFailure(failPath)
		return nil, "", nil
	}
	_ = os.WriteFile(filepath.Join(cacheDir, safeKey+ext), data, 0o644)
	_ = os.Remove(failPath)
	if contentType == "" {
		contentType = mime.TypeByExtension(ext)
	}
	return data, contentType, nil
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
	abs, err := filepath.Abs(item.Path)
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

func coverExtByMime(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".bin"
	}
}

func coverMimeByExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

func coverFromFile(path string) ([]byte, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	m, err := tag.ReadFrom(f)
	if err != nil {
		return nil, "", err
	}
	pic := m.Picture()
	if pic == nil || len(pic.Data) == 0 {
		return nil, "", nil
	}
	mimeType := strings.TrimSpace(pic.MIMEType)
	if mimeType == "" {
		switch strings.ToLower(pic.Ext) {
		case "jpg", "jpeg":
			mimeType = "image/jpeg"
		case "png":
			mimeType = "image/png"
		case "webp":
			mimeType = "image/webp"
		default:
			mimeType = "application/octet-stream"
		}
	}
	return pic.Data, mimeType, nil
}

func (s *Service) ToggleSongFavorite(ctx context.Context, userID, id int) (models.Song, error) {
	if _, err := s.client.Song.Get(ctx, id); err != nil {
		return models.Song{}, err
	}
	existing, err := s.client.UserSongFavorite.Query().
		Where(usersongfavorite.HasUserWith(user.ID(userID)), usersongfavorite.HasSongWith(song.ID(id))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.Song{}, err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.UserSongFavorite.Create().SetUserID(userID).SetSongID(id).Save(ctx)
	} else {
		err = s.client.UserSongFavorite.DeleteOneID(existing.ID).Exec(ctx)
	}
	if err != nil {
		return models.Song{}, err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	return s.Song(ctx, userID, id)
}

func (s *Service) MarkPlayed(ctx context.Context, userID, id int) error {
	item, err := s.client.Song.Get(ctx, id)
	if err != nil {
		return err
	}
	if _, err := s.client.PlayHistory.Create().
		SetUserID(userID).
		SetSongID(id).
		SetDurationSeconds(item.DurationSeconds).
		Save(ctx); err != nil {
		return err
	}
	if err := s.client.Song.UpdateOneID(id).AddPlayCount(1).SetLastPlayedAt(time.Now()).Exec(ctx); err != nil {
		return err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	s.invalidateSongCatalog(ctx)
	return nil
}

func (s *Service) SavePlaybackProgress(ctx context.Context, userID, id int, progressSeconds, durationSeconds float64, completed bool) error {
	item, err := s.client.Song.Get(ctx, id)
	if err != nil {
		return err
	}
	if durationSeconds <= 0 {
		durationSeconds = item.DurationSeconds
	}
	if progressSeconds < 0 {
		progressSeconds = 0
	}
	if durationSeconds > 0 && progressSeconds > durationSeconds {
		progressSeconds = durationSeconds
	}
	if durationSeconds > 0 && durationSeconds-progressSeconds <= 3 {
		completed = true
	}
	now := time.Now()
	history, err := s.client.PlayHistory.Query().
		Where(playhistory.HasUserWith(user.ID(userID)), playhistory.HasSongWith(song.ID(id))).
		Order(ent.Desc(playhistory.FieldUpdatedAt), ent.Desc(playhistory.FieldPlayedAt)).
		First(ctx)
	if ent.IsNotFound(err) {
		_, err = s.client.PlayHistory.Create().
			SetUserID(userID).
			SetSongID(id).
			SetPlayedAt(now).
			SetProgressSeconds(progressSeconds).
			SetDurationSeconds(durationSeconds).
			SetCompleted(completed).
			Save(ctx)
		if err == nil {
			s.invalidateUserLibraryCache(ctx, userID)
		}
		return err
	}
	if err != nil {
		return err
	}
	err = s.client.PlayHistory.UpdateOneID(history.ID).
		SetProgressSeconds(progressSeconds).
		SetDurationSeconds(durationSeconds).
		SetCompleted(completed).
		SetUpdatedAt(now).
		Exec(ctx)
	if err == nil {
		s.invalidateUserLibraryCache(ctx, userID)
	}
	return err
}

func (s *Service) Lyrics(ctx context.Context, id int, sourceID string) (models.Lyrics, error) {
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().Only(ctx)
	if err != nil {
		return models.Lyrics{}, err
	}
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" || strings.EqualFold(sourceID, "embedded") {
		includeSidecar := sourceID == ""
		if lyric, source := s.preferredLocalLyrics(ctx, item, includeSidecar); lyric != "" {
			if item.LyricsSource != source || strings.TrimSpace(item.LyricsEmbedded) != lyric {
				_, _ = item.Update().SetLyricsEmbedded(lyric).SetLyricsSource(source).Save(ctx)
				s.invalidateSongCatalog(ctx)
			}
			return models.Lyrics{SongID: id, Source: source, Lyrics: lyric}, nil
		}
		if strings.EqualFold(sourceID, "embedded") {
			return models.Lyrics{SongID: id, Source: "embedded:not-found", Lyrics: ""}, nil
		}
		if strings.TrimSpace(item.LyricsEmbedded) != "" && strings.TrimSpace(item.LyricsSource) != "" {
			return models.Lyrics{SongID: id, Source: item.LyricsSource, Lyrics: item.LyricsEmbedded}, nil
		}
	}
	if sourceID == "" {
		sourceID = strings.TrimSpace(item.NeteaseID)
	}
	artistName := ""
	if item.Edges.Artist != nil {
		artistName = item.Edges.Artist.Name
	}
	cleanArtist, cleanTitle := cleanLyricArtistTitle(artistName, item.Title)
	var lyric, matchedID, matchedSource string
	for index, title := range lyricTitleQueryVariants(cleanTitle) {
		preferredID := sourceID
		if index > 0 {
			preferredID = ""
		}
		var matchErr error
		lyric, matchedID, matchedSource, matchErr = s.matchOnlineLyrics(ctx, title, cleanArtist, preferredID)
		if matchErr != nil {
			return models.Lyrics{}, matchErr
		}
		if strings.TrimSpace(lyric) != "" {
			break
		}
	}
	if strings.TrimSpace(lyric) == "" {
		return models.Lyrics{SongID: id, Source: "online:not-found", Lyrics: ""}, nil
	}
	if matchedSource == "" {
		matchedSource = "online"
	}
	update := item.Update().SetLyricsEmbedded(lyric).SetLyricsSource(matchedSource)
	if matchedSource == "netease" && matchedID != "" {
		update.SetNeteaseID(matchedID)
	}
	_, _ = update.Save(ctx)
	s.invalidateSongCatalog(ctx)
	return models.Lyrics{SongID: id, Source: matchedSource, Lyrics: lyric, Fetched: true}, nil
}

func (s *Service) preferredLocalLyrics(ctx context.Context, item *ent.Song, includeSidecar bool) (string, string) {
	if item == nil {
		return "", ""
	}
	if includeSidecar {
		if lyric := readSidecarLyrics(item.Path); lyric != "" {
			return lyric, "file"
		}
	}
	if item != nil && item.LyricsSource == "embedded" && strings.TrimSpace(item.LyricsEmbedded) != "" {
		return strings.TrimSpace(item.LyricsEmbedded), "embedded"
	}
	if lyric := strings.TrimSpace(s.probe(ctx, item.Path).Lyrics); lyric != "" {
		return lyric, "embedded"
	}
	return "", ""
}

func preferredEmbeddedLyrics(item *ent.Song, fileLyrics string) string {
	if item != nil && item.LyricsSource == "embedded" && strings.TrimSpace(item.LyricsEmbedded) != "" {
		return strings.TrimSpace(item.LyricsEmbedded)
	}
	return strings.TrimSpace(fileLyrics)
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

func (s *Service) LyricCandidates(ctx context.Context, id int) ([]models.LyricCandidate, error) {
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().Only(ctx)
	if err != nil {
		return nil, err
	}
	artistName := ""
	if item.Edges.Artist != nil {
		artistName = item.Edges.Artist.Name
	}
	out := []models.LyricCandidate{}
	seen := map[string]bool{}
	appendCandidates := func(items []models.LyricCandidate) {
		for _, candidate := range items {
			key := candidate.Source + ":" + candidate.ID
			if candidate.ID == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, candidate)
		}
	}
	cleanArtist, cleanTitle := cleanLyricArtistTitle(artistName, item.Title)
	titleVariants := lyricTitleQueryVariants(cleanTitle)
	if s.netease != nil {
		for _, title := range titleVariants {
			items, _ := s.netease.SearchCandidates(ctx, title, cleanArtist)
			appendCandidates(items)
		}
	}
	if s.qqmusic != nil {
		for _, title := range titleVariants {
			items, _ := s.qqmusic.SearchCandidates(ctx, title, cleanArtist)
			appendCandidates(items)
		}
	}
	for _, provider := range s.online {
		for _, title := range titleVariants {
			items, err := provider.SearchSongs(ctx, title, cleanArtist)
			if err != nil {
				continue
			}
			candidates := make([]models.LyricCandidate, 0, len(items))
			for _, found := range items {
				candidates = append(candidates, models.LyricCandidate{ID: found.ID, Source: provider.Name(), Title: found.Title, Artist: found.Artist})
			}
			appendCandidates(candidates)
		}
	}
	return out, nil
}

func (s *Service) SelectLyrics(ctx context.Context, id int, source, sourceID string) (models.Lyrics, error) {
	source = strings.ToLower(strings.TrimSpace(source))
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return models.Lyrics{}, fmt.Errorf("lyric candidate id is required")
	}
	lyric, err := s.fetchLyricsBySource(ctx, source, sourceID)
	if err != nil {
		return models.Lyrics{}, err
	}
	if strings.TrimSpace(lyric) == "" {
		return models.Lyrics{SongID: id, Source: source + ":not-found", Lyrics: ""}, nil
	}
	update := s.client.Song.UpdateOneID(id).SetLyricsEmbedded(lyric).SetLyricsSource(source)
	if source == "netease" {
		update.SetNeteaseID(sourceID)
	}
	if err := update.Exec(ctx); err != nil {
		return models.Lyrics{}, err
	}
	s.invalidateSongCatalog(ctx)
	return models.Lyrics{SongID: id, Source: source, Lyrics: lyric, Fetched: true}, nil
}

func (s *Service) matchOnlineLyrics(ctx context.Context, title, artist, preferredID string) (string, string, string, error) {
	preferredID = strings.TrimSpace(preferredID)
	if strings.Contains(preferredID, ":") {
		parts := strings.SplitN(preferredID, ":", 2)
		lyric, err := s.fetchLyricsBySource(ctx, parts[0], parts[1])
		return lyric, parts[1], strings.ToLower(strings.TrimSpace(parts[0])), err
	}
	if preferredID != "" && s.netease != nil {
		lyric, err := s.netease.Lyrics(ctx, preferredID)
		if err != nil {
			return "", "", "", err
		}
		if strings.TrimSpace(lyric) != "" {
			return lyric, preferredID, "netease", nil
		}
	}
	if s.netease != nil {
		id, err := s.netease.SearchSongID(ctx, title, artist)
		if err == nil && strings.TrimSpace(id) != "" {
			lyric, lyricErr := s.netease.Lyrics(ctx, id)
			if lyricErr != nil {
				return "", "", "", lyricErr
			}
			if strings.TrimSpace(lyric) != "" {
				return lyric, id, "netease", nil
			}
		}
	}
	if s.qqmusic != nil {
		id, err := s.qqmusic.SearchSongID(ctx, title, artist)
		if err == nil && strings.TrimSpace(id) != "" {
			lyric, lyricErr := s.qqmusic.Lyrics(ctx, id)
			if lyricErr != nil {
				return "", "", "", lyricErr
			}
			if strings.TrimSpace(lyric) != "" {
				return lyric, id, "qq", nil
			}
		}
	}
	for _, provider := range s.online {
		found, err := provider.SearchSongs(ctx, title, artist)
		if err != nil {
			continue
		}
		for _, candidate := range found {
			lyric, lyricErr := provider.Lyrics(ctx, candidate)
			if lyricErr != nil || strings.TrimSpace(lyric) == "" {
				continue
			}
			return lyric, candidate.ID, provider.Name(), nil
		}
	}
	return "", "", "", nil
}

func (s *Service) fetchLyricsBySource(ctx context.Context, source, sourceID string) (string, error) {
	source = strings.ToLower(strings.TrimSpace(source))
	switch source {
	case "netease", "":
		if s.netease == nil {
			return "", nil
		}
		return s.netease.Lyrics(ctx, sourceID)
	case "qq", "qqmusic":
		if s.qqmusic == nil {
			return "", nil
		}
		return s.qqmusic.Lyrics(ctx, sourceID)
	default:
		for _, provider := range s.online {
			if provider.Name() != source {
				continue
			}
			return provider.Lyrics(ctx, online.Song{Source: provider.Name(), ID: sourceID, Extra: map[string]string{"rid": sourceID, "hash": sourceID, "content_id": sourceID, "tsid": sourceID, "track_id": sourceID, "songid": strings.Split(sourceID, "|")[0]}})
		}
		return "", fmt.Errorf("unsupported lyric source")
	}
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

func (s *Service) albumSongCounts(ctx context.Context) (map[int]int, error) {
	rows := []albumSongCountRow{}
	if err := s.client.Song.Query().GroupBy(song.AlbumColumn).Aggregate(ent.Count()).Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counts := make(map[int]int, len(rows))
	for _, row := range rows {
		if row.AlbumID != nil && *row.AlbumID > 0 {
			counts[*row.AlbumID] = row.Count
		}
	}
	return counts, nil
}

func (s *Service) albumSongCountsForIDs(ctx context.Context, ids []int) (map[int]int, error) {
	if len(ids) == 0 {
		return map[int]int{}, nil
	}
	rows := []albumSongCountRow{}
	if err := s.client.Song.Query().
		Where(song.HasAlbumWith(album.IDIn(ids...))).
		GroupBy(song.AlbumColumn).
		Aggregate(ent.Count()).
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counts := make(map[int]int, len(rows))
	for _, row := range rows {
		if row.AlbumID != nil && *row.AlbumID > 0 {
			counts[*row.AlbumID] = row.Count
		}
	}
	return counts, nil
}

func (s *Service) artistSongCounts(ctx context.Context) (map[int]int, error) {
	rows := []artistSongCountRow{}
	if err := s.client.Song.Query().GroupBy(song.ArtistColumn).Aggregate(ent.Count()).Scan(ctx, &rows); err != nil {
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

func (s *Service) artistSongCountsForIDs(ctx context.Context, ids []int) (map[int]int, error) {
	if len(ids) == 0 {
		return map[int]int{}, nil
	}
	rows := []artistSongCountRow{}
	if err := s.client.Song.Query().
		Where(song.HasArtistWith(artist.IDIn(ids...))).
		GroupBy(song.ArtistColumn).
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

func (s *Service) artistAlbumCounts(ctx context.Context) (map[int]int, error) {
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
	return counts, nil
}

func (s *Service) artistAlbumCountsForIDs(ctx context.Context, ids []int) (map[int]int, error) {
	if len(ids) == 0 {
		return map[int]int{}, nil
	}
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

func collectAlbumIDs(items []*ent.Album) []int {
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids
}

func collectArtistIDs(items []*ent.Artist) []int {
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return ids
}

func (s *Service) playlistSongCount(ctx context.Context, item *ent.Playlist) (int, error) {
	if item == nil {
		return 0, nil
	}
	return item.QuerySongs().Count(ctx)
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

func (s *Service) CreatePlaylist(ctx context.Context, userID int, name, description, theme string) (models.Playlist, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return models.Playlist{}, fmt.Errorf("playlist name is required")
	}
	if theme == "" {
		theme = "deep-space"
	}
	p, err := s.client.Playlist.Create().SetName(name).SetDescription(description).SetCoverTheme(theme).SetOwnerID(userID).Save(ctx)
	if err != nil {
		return models.Playlist{}, err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	return mapPlaylist(p), nil
}

func (s *Service) PlaylistSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error) {
	p, err := s.client.Playlist.Query().
		Where(playlist.ID(id), playlist.HasOwnerWith(user.ID(userID))).
		WithSongs(func(q *ent.SongQuery) {
			q.WithArtist().WithAlbum()
			limitCollectionSongQuery(q, limit)
		}).
		Only(ctx)
	if err != nil {
		return nil, err
	}
	out := mapSongs(p.Edges.Songs)
	return s.applySongUserState(ctx, userID, out)
}

func (s *Service) AddSongToPlaylist(ctx context.Context, userID, playlistID, songID int) error {
	p, err := s.client.Playlist.Query().Where(playlist.ID(playlistID), playlist.HasOwnerWith(user.ID(userID))).Only(ctx)
	if err != nil {
		return err
	}
	if err := p.Update().AddSongIDs(songID).Exec(ctx); err != nil {
		return err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	return nil
}

func (s *Service) RemoveSongFromPlaylist(ctx context.Context, userID, playlistID, songID int) error {
	p, err := s.client.Playlist.Query().Where(playlist.ID(playlistID), playlist.HasOwnerWith(user.ID(userID))).Only(ctx)
	if err != nil {
		return err
	}
	if err := p.Update().RemoveSongIDs(songID).Exec(ctx); err != nil {
		return err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	return nil
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

func (s *Service) AlbumsPage(ctx context.Context, userID, limit, offset, artistID int) (models.AlbumPage, error) {
	limit, offset = normalizePage(limit, offset)
	key := cacheKey("albums-page", userID, s.userCacheVersion(ctx, userID), limit, offset, artistID)
	var cached models.AlbumPage
	if ok, err := s.cacheGetJSON(ctx, key, &cached); err != nil {
		return models.AlbumPage{}, err
	} else if ok {
		return cached, nil
	}
	predicates := []predicate.Album{album.HasSongs()}
	if artistID > 0 {
		predicates = append(predicates, album.HasArtistWith(artist.ID(artistID)))
	}
	total, err := s.client.Album.Query().Where(predicates...).Count(ctx)
	if err != nil {
		return models.AlbumPage{}, err
	}
	query := s.client.Album.Query().Where(predicates...).WithArtist().Order(ent.Desc(album.FieldUpdatedAt)).Limit(limit)
	if offset > 0 {
		query = query.Offset(offset)
	}
	items, err := query.All(ctx)
	if err != nil {
		return models.AlbumPage{}, err
	}
	counts, err := s.albumSongCountsForIDs(ctx, collectAlbumIDs(items))
	if err != nil {
		return models.AlbumPage{}, err
	}
	out := make([]models.Album, 0, len(items))
	for _, a := range items {
		out = append(out, mapAlbumWithCount(a, counts[a.ID]))
	}
	out, err = s.applyAlbumUserState(ctx, userID, out)
	if err != nil {
		return models.AlbumPage{}, err
	}
	page := models.AlbumPage{Items: out, Total: total, Limit: limit, Offset: offset, Page: offset/limit + 1}
	_ = s.cacheSetJSON(ctx, key, page)
	return page, nil
}

func (s *Service) AlbumSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error) {
	a, err := s.client.Album.Query().Where(album.ID(id)).WithArtist().WithSongs(func(q *ent.SongQuery) {
		q.WithArtist().WithAlbum()
		limitCollectionSongQuery(q, limit)
	}).Only(ctx)
	if err != nil {
		return nil, err
	}
	if a.Year == 0 {
		_, _ = s.refreshAlbumYearFromOnline(ctx, id)
	}
	out := mapSongs(a.Edges.Songs)
	return s.applySongUserState(ctx, userID, out)
}

func (s *Service) Artists(ctx context.Context, userID, limit int) ([]models.Artist, error) {
	page, err := s.ArtistsPage(ctx, userID, limit, 0)
	if err != nil {
		return nil, err
	}
	return page.Items, nil
}

func (s *Service) FavoriteArtists(ctx context.Context, userID, limit int) ([]models.Artist, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	favorites, err := s.client.UserArtistFavorite.Query().
		Where(userartistfavorite.HasUserWith(user.ID(userID))).
		WithArtist().
		Order(ent.Desc(userartistfavorite.FieldCreatedAt)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(favorites))
	for _, favorite := range favorites {
		if favorite.Edges.Artist != nil {
			ids = append(ids, favorite.Edges.Artist.ID)
		}
	}
	songCounts, err := s.artistSongCountsForIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	albumCounts, err := s.artistAlbumCountsForIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]models.Artist, 0, len(favorites))
	for _, favorite := range favorites {
		if favorite.Edges.Artist == nil {
			continue
		}
		item := mapArtistWithCounts(favorite.Edges.Artist, songCounts[favorite.Edges.Artist.ID], albumCounts[favorite.Edges.Artist.ID])
		item.Favorite = true
		out = append(out, item)
	}
	return out, nil
}

func (s *Service) SearchArtists(ctx context.Context, userID int, term string, limit int) ([]models.Artist, error) {
	term = strings.TrimSpace(term)
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	query := s.client.Artist.Query().Order(ent.Asc(artist.FieldName)).Limit(limit)
	if term != "" {
		query = query.Where(artist.NameContainsFold(term))
	}
	items, err := query.All(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	songCounts, err := s.artistSongCountsForIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	albumCounts, err := s.artistAlbumCountsForIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]models.Artist, 0, len(items))
	for _, item := range items {
		out = append(out, mapArtistWithCounts(item, songCounts[item.ID], albumCounts[item.ID]))
	}
	return s.applyArtistUserState(ctx, userID, out)
}

func (s *Service) ArtistsPage(ctx context.Context, userID, limit, offset int) (models.ArtistPage, error) {
	limit, offset = normalizePage(limit, offset)
	key := cacheKey("artists-page", userID, s.userCacheVersion(ctx, userID), limit, offset)
	var cached models.ArtistPage
	if ok, err := s.cacheGetJSON(ctx, key, &cached); err != nil {
		return models.ArtistPage{}, err
	} else if ok {
		return cached, nil
	}
	total, err := s.client.Artist.Query().Count(ctx)
	if err != nil {
		return models.ArtistPage{}, err
	}
	query := s.client.Artist.Query().Order(ent.Asc(artist.FieldName)).Limit(limit)
	if offset > 0 {
		query = query.Offset(offset)
	}
	items, err := query.All(ctx)
	if err != nil {
		return models.ArtistPage{}, err
	}
	songCounts, err := s.artistSongCountsForIDs(ctx, collectArtistIDs(items))
	if err != nil {
		return models.ArtistPage{}, err
	}
	albumCounts, err := s.artistAlbumCountsForIDs(ctx, collectArtistIDs(items))
	if err != nil {
		return models.ArtistPage{}, err
	}
	out := make([]models.Artist, 0, len(items))
	for _, a := range items {
		out = append(out, mapArtistWithCounts(a, songCounts[a.ID], albumCounts[a.ID]))
	}
	out, err = s.applyArtistUserState(ctx, userID, out)
	if err != nil {
		return models.ArtistPage{}, err
	}
	page := models.ArtistPage{Items: out, Total: total, Limit: limit, Offset: offset, Page: offset/limit + 1}
	_ = s.cacheSetJSON(ctx, key, page)
	return page, nil
}

func (s *Service) ArtistSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error) {
	a, err := s.client.Artist.Query().Where(artist.ID(id)).WithSongs(func(q *ent.SongQuery) {
		q.WithArtist().WithAlbum().Order(ent.Asc(song.FieldTitle))
		limitCollectionSongQuery(q, limit)
	}).Only(ctx)
	if err != nil {
		return nil, err
	}
	out := mapSongs(a.Edges.Songs)
	return s.applySongUserState(ctx, userID, out)
}

func (s *Service) ToggleAlbumFavorite(ctx context.Context, userID, id int) (models.Album, error) {
	if _, err := s.client.Album.Get(ctx, id); err != nil {
		return models.Album{}, err
	}
	existing, err := s.client.UserAlbumFavorite.Query().
		Where(useralbumfavorite.HasUserWith(user.ID(userID)), useralbumfavorite.HasAlbumWith(album.ID(id))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.Album{}, err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.UserAlbumFavorite.Create().SetUserID(userID).SetAlbumID(id).Save(ctx)
	} else {
		err = s.client.UserAlbumFavorite.DeleteOneID(existing.ID).Exec(ctx)
	}
	if err != nil {
		return models.Album{}, err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	a, err := s.client.Album.Query().Where(album.ID(id)).WithArtist().Only(ctx)
	if err != nil {
		return models.Album{}, err
	}
	counts, err := s.albumSongCountsForIDs(ctx, []int{id})
	if err != nil {
		return models.Album{}, err
	}
	items, err := s.applyAlbumUserState(ctx, userID, []models.Album{mapAlbumWithCount(a, counts[a.ID])})
	if err != nil {
		return models.Album{}, err
	}
	return items[0], nil
}

func (s *Service) ToggleArtistFavorite(ctx context.Context, userID, id int) (models.Artist, error) {
	if _, err := s.client.Artist.Get(ctx, id); err != nil {
		return models.Artist{}, err
	}
	existing, err := s.client.UserArtistFavorite.Query().
		Where(userartistfavorite.HasUserWith(user.ID(userID)), userartistfavorite.HasArtistWith(artist.ID(id))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.Artist{}, err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.UserArtistFavorite.Create().SetUserID(userID).SetArtistID(id).Save(ctx)
	} else {
		err = s.client.UserArtistFavorite.DeleteOneID(existing.ID).Exec(ctx)
	}
	if err != nil {
		return models.Artist{}, err
	}
	s.invalidateUserLibraryCache(ctx, userID)
	a, err := s.client.Artist.Get(ctx, id)
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
	items, err := s.applyArtistUserState(ctx, userID, []models.Artist{mapArtistWithCounts(a, songCounts[a.ID], albumCounts[a.ID])})
	if err != nil {
		return models.Artist{}, err
	}
	return items[0], nil
}

func (s *Service) GetSettings(ctx context.Context) (models.Settings, error) {
	settings := models.Settings{Language: "zh-CN", Theme: "deep-space", SleepTimerMins: 0, LibraryPath: s.libraryDir, NeteaseFallback: true, RegistrationEnabled: false}
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
		case "web_font_family":
			settings.WebFontFamily = item.Value
		case "web_font_url":
			settings.WebFontURL = item.Value
		}
	}
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
	pairs := map[string]string{"language": settings.Language, "theme": settings.Theme, "sleep_timer_mins": strconv.Itoa(settings.SleepTimerMins), "netease_fallback": strconv.FormatBool(settings.NeteaseFallback), settingRegistrationEnabled: strconv.FormatBool(settings.RegistrationEnabled), "web_font_family": settings.WebFontFamily, "web_font_url": settings.WebFontURL}
	for key, value := range pairs {
		if err := s.setSetting(ctx, key, value); err != nil {
			return models.Settings{}, err
		}
	}
	return s.GetSettings(ctx)
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
		return s.SaveSettings(ctx, settings)
	}
	return settings, nil
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

func (s *Service) ensureArtist(ctx context.Context, name string) (*ent.Artist, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Unknown Artist"
	}
	item, err := s.client.Artist.Query().Where(artist.Name(name)).Only(ctx)
	if err == nil {
		return item, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	return s.client.Artist.Create().SetName(name).Save(ctx)
}

func (s *Service) ensureAlbum(ctx context.Context, title, albumArtist string, ar *ent.Artist, year int) (*ent.Album, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Unknown Album"
	}
	albumArtist = strings.TrimSpace(albumArtist)
	if albumArtist == "" && ar != nil {
		albumArtist = strings.TrimSpace(ar.Name)
	}
	item, err := s.client.Album.Query().Where(album.Title(title), album.AlbumArtist(albumArtist)).Only(ctx)
	if err == nil {
		if item.Year == 0 && year > 0 {
			updated, updateErr := item.Update().SetYear(year).Save(ctx)
			if updateErr != nil {
				return nil, updateErr
			}
			return updated, nil
		}
		return item, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	return s.client.Album.Create().SetTitle(title).SetAlbumArtist(albumArtist).SetYear(year).SetArtist(ar).Save(ctx)
}

func prepareProbeCommand(cmd *exec.Cmd) {
	prepareProbeProcessGroup(cmd)
	cmd.Cancel = func() error {
		terminateProbeCommand(cmd)
		return nil
	}
	cmd.WaitDelay = 5 * time.Second
}

var errProbeOutputTooLarge = errors.New("ffprobe output exceeded memory limit")

const maxFFprobeOutputBytes = 4 << 20

func commandOutputLimited(cmd *exec.Cmd, limit int64) ([]byte, error) {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	data, readErr := io.ReadAll(io.LimitReader(stdout, limit+1))
	if int64(len(data)) > limit {
		terminateProbeCommand(cmd)
		readErr = errProbeOutputTooLarge
	}
	waitErr := cmd.Wait()
	if readErr != nil {
		return nil, readErr
	}
	if waitErr != nil {
		return nil, waitErr
	}
	return data, nil
}

func terminateProbeCommand(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		return
	}
	if terminateProbeProcessGroup(cmd) {
		return
	}
	_ = cmd.Process.Kill()
}

func (s *Service) probe(ctx context.Context, path string) fileMetadata {
	if s.ffprobe != "" {
		if meta := s.probeViaFFprobe(ctx, path); !meta.empty() {
			s.enrichMetadataViaTags(path, &meta)
			mergeFileMetadata(&meta, probeWAVMetadata(path))
			return meta
		}
	}
	meta := s.probeTags(path)
	mergeFileMetadata(&meta, probeWAVMetadata(path))
	return meta
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

func (s *Service) probeViaFFprobe(ctx context.Context, path string) fileMetadata {
	probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, s.ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path)
	prepareProbeCommand(cmd)
	out, err := commandOutputLimited(cmd, maxFFprobeOutputBytes)
	if err != nil {
		return fileMetadata{}
	}
	var probed ffprobeOutput
	if err := json.Unmarshal(out, &probed); err != nil {
		return fileMetadata{}
	}
	tags := normalizeTags(map[string]string(probed.Format.Tags))
	meta := fileMetadata{
		Title:       first(tags, "title"),
		Artist:      first(tags, "artist", "album_artist", "albumartist"),
		Album:       first(tags, "album"),
		AlbumArtist: first(tags, "album_artist", "albumartist"),
		Lyrics:      first(tags, "lyrics", "unsyncedlyrics", "unsynced_lyrics", "syncedlyrics"),
		Year:        parseYear(first(tags, "date", "year", "originaldate", "originalyear", "releasedate")),
	}
	if duration, _ := strconv.ParseFloat(probed.Format.Duration, 64); duration > 0 {
		meta.Duration = duration
	}
	if bitrate, _ := strconv.Atoi(probed.Format.BitRate); bitrate > 0 {
		meta.BitRate = bitrate
	}
	for _, stream := range probed.Streams {
		if stream.CodecType != "audio" {
			continue
		}
		if sampleRate, _ := strconv.Atoi(stream.SampleRate); sampleRate > 0 {
			meta.SampleRate = sampleRate
		}
		if stream.Bits > 0 {
			meta.BitDepth = stream.Bits
		}
		streamTags := normalizeTags(map[string]string(stream.Tags))
		if meta.Lyrics == "" {
			meta.Lyrics = first(streamTags, "lyrics", "unsyncedlyrics", "unsynced_lyrics", "syncedlyrics")
		}
		if meta.Year == 0 {
			meta.Year = parseYear(first(streamTags, "date", "year", "originaldate", "originalyear", "releasedate"))
		}
		break
	}
	return meta
}

func (s *Service) enrichMetadataViaTags(path string, meta *fileMetadata) {
	if meta.Title != "" && meta.Artist != "" && meta.Album != "" && meta.Lyrics != "" {
		return
	}
	tags := s.probeTags(path)
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
	if meta.Lyrics == "" {
		meta.Lyrics = tags.Lyrics
	}
	if meta.Year == 0 && tags.Year > 0 {
		meta.Year = tags.Year
	}
}

func (s *Service) probeTags(path string) fileMetadata {
	f, err := os.Open(path)
	if err != nil {
		return fileMetadata{}
	}
	defer f.Close()
	m, err := tag.ReadFrom(f)
	if err != nil {
		return fileMetadata{}
	}
	meta := fileMetadata{
		Title:       cleanMetadataText(m.Title()),
		Artist:      cleanMetadataText(m.Artist()),
		Album:       cleanMetadataText(m.Album()),
		AlbumArtist: cleanMetadataText(m.AlbumArtist()),
		Year:        m.Year(),
		Lyrics:      cleanMetadataText(m.Lyrics()),
	}
	if meta.Artist == "" {
		meta.Artist = cleanMetadataText(m.Composer())
	}
	return meta
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
	default:
		return "application/octet-stream"
	}
}

func sourceIf(ok bool, yes, no string) string {
	if ok {
		return yes
	}
	return no
}

func (s *Service) applySongUserState(ctx context.Context, userID int, items []models.Song) ([]models.Song, error) {
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	favorites, err := s.client.UserSongFavorite.Query().
		Where(usersongfavorite.HasUserWith(user.ID(userID)), usersongfavorite.HasSongWith(song.IDIn(ids...))).
		WithSong().
		All(ctx)
	if err != nil {
		return nil, err
	}
	favoriteIDs := map[int]bool{}
	for _, favorite := range favorites {
		if favorite.Edges.Song != nil {
			favoriteIDs[favorite.Edges.Song.ID] = true
		}
	}
	playCounts, err := s.playHistoryCountsForSongs(ctx, userID, ids)
	if err != nil {
		return nil, err
	}
	lastPlayed, resumePositions, err := s.latestPlayHistoryStateForSongs(ctx, userID, items)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].Favorite = favoriteIDs[items[i].ID]
		items[i].PlayCount = playCounts[items[i].ID]
		items[i].ResumePosition = resumePositions[items[i].ID]
		if playedAt, ok := lastPlayed[items[i].ID]; ok {
			items[i].LastPlayedAt = &playedAt
		} else {
			items[i].LastPlayedAt = nil
		}
	}
	return items, nil
}

func (s *Service) playHistoryCountsForSongs(ctx context.Context, userID int, ids []int) (map[int]int, error) {
	rows := []playHistorySongCountRow{}
	if err := s.client.PlayHistory.Query().
		Where(playhistory.HasUserWith(user.ID(userID)), playhistory.HasSongWith(song.IDIn(ids...))).
		GroupBy(playhistory.SongColumn).
		Aggregate(ent.Count()).
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	counts := make(map[int]int, len(rows))
	for _, row := range rows {
		if row.SongID != nil && *row.SongID > 0 {
			counts[*row.SongID] = row.Count
		}
	}
	return counts, nil
}

func (s *Service) latestPlayHistoryStateForSongs(ctx context.Context, userID int, items []models.Song) (map[int]time.Time, map[int]float64, error) {
	lastPlayed := map[int]time.Time{}
	resumePositions := map[int]float64{}
	ids := make([]int, 0, len(items))
	durationByID := make(map[int]float64, len(items))
	for i := range items {
		ids = append(ids, items[i].ID)
		durationByID[items[i].ID] = items[i].DurationSeconds
	}
	limit := maxInt(len(ids)*4, 200)
	if limit > 1000 {
		limit = 1000
	}
	histories, err := s.client.PlayHistory.Query().
		Where(playhistory.HasUserWith(user.ID(userID)), playhistory.HasSongWith(song.IDIn(ids...))).
		WithSong(func(q *ent.SongQuery) { q.Select(song.FieldID, song.FieldDurationSeconds) }).
		Order(ent.Desc(playhistory.FieldUpdatedAt), ent.Desc(playhistory.FieldPlayedAt)).
		Limit(limit).
		All(ctx)
	if err != nil {
		return nil, nil, err
	}
	for _, history := range histories {
		if history.Edges.Song == nil {
			continue
		}
		songID := history.Edges.Song.ID
		if _, ok := lastPlayed[songID]; ok {
			continue
		}
		lastPlayed[songID] = history.PlayedAt
		if !history.Completed && history.ProgressSeconds >= 5 {
			duration := history.DurationSeconds
			if duration <= 0 {
				duration = durationByID[songID]
			}
			if duration <= 0 || history.ProgressSeconds < duration-5 {
				resumePositions[songID] = history.ProgressSeconds
			}
		}
	}
	return lastPlayed, resumePositions, nil
}

func (s *Service) applyAlbumUserState(ctx context.Context, userID int, items []models.Album) ([]models.Album, error) {
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	favorites, err := s.client.UserAlbumFavorite.Query().
		Where(useralbumfavorite.HasUserWith(user.ID(userID)), useralbumfavorite.HasAlbumWith(album.IDIn(ids...))).
		WithAlbum().
		All(ctx)
	if err != nil {
		return nil, err
	}
	favoriteIDs := map[int]bool{}
	for _, favorite := range favorites {
		if favorite.Edges.Album != nil {
			favoriteIDs[favorite.Edges.Album.ID] = true
		}
	}
	for i := range items {
		items[i].Favorite = favoriteIDs[items[i].ID]
	}
	return items, nil
}

func (s *Service) applyArtistUserState(ctx context.Context, userID int, items []models.Artist) ([]models.Artist, error) {
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	favorites, err := s.client.UserArtistFavorite.Query().
		Where(userartistfavorite.HasUserWith(user.ID(userID)), userartistfavorite.HasArtistWith(artist.IDIn(ids...))).
		WithArtist().
		All(ctx)
	if err != nil {
		return nil, err
	}
	favoriteIDs := map[int]bool{}
	for _, favorite := range favorites {
		if favorite.Edges.Artist != nil {
			favoriteIDs[favorite.Edges.Artist.ID] = true
		}
	}
	for i := range items {
		items[i].Favorite = favoriteIDs[items[i].ID]
	}
	return items, nil
}

func mapLibraryDirectory(item *ent.LibraryDirectory) models.LibraryDirectory {
	return models.LibraryDirectory{ID: strconv.Itoa(item.ID), Path: item.Path, Note: item.Note, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func mapSongs(items []*ent.Song) []models.Song {
	out := make([]models.Song, 0, len(items))
	for _, item := range items {
		out = append(out, mapSong(item))
	}
	return out
}

func mapSong(item *ent.Song) models.Song {
	artistID, albumID := 0, 0
	artistName, albumTitle := "", ""
	if item.Edges.Artist != nil {
		artistID = item.Edges.Artist.ID
		artistName = item.Edges.Artist.Name
	}
	if item.Edges.Album != nil {
		albumID = item.Edges.Album.ID
		albumTitle = item.Edges.Album.Title
	}
	return models.Song{ID: item.ID, Title: item.Title, ArtistID: artistID, Artist: artistName, AlbumID: albumID, Album: albumTitle, Path: item.Path, FileName: item.FileName, Format: item.Format, Mime: item.Mime, SizeBytes: item.SizeBytes, DurationSeconds: item.DurationSeconds, SampleRate: item.SampleRate, BitRate: item.BitRate, BitDepth: item.BitDepth, Year: item.Year, NeteaseID: item.NeteaseID, Favorite: item.Favorite, PlayCount: item.PlayCount, LastPlayedAt: item.LastPlayedAt, HasLyrics: strings.TrimSpace(item.LyricsEmbedded) != "", LyricsSource: item.LyricsSource, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func mapAlbum(item *ent.Album) models.Album {
	count := 0
	if item.Edges.Songs != nil {
		count = len(item.Edges.Songs)
	}
	return mapAlbumWithCount(item, count)
}

func mapAlbumWithCount(item *ent.Album, songCount int) models.Album {
	artistID := 0
	artistName := ""
	if item.Edges.Artist != nil {
		artistID = item.Edges.Artist.ID
		artistName = item.Edges.Artist.Name
	}
	year := item.Year
	for _, song := range item.Edges.Songs {
		if song.Year > 0 && (year == 0 || song.Year < year) {
			year = song.Year
		}
	}
	return models.Album{ID: item.ID, Title: item.Title, ArtistID: artistID, Artist: artistName, AlbumArtist: item.AlbumArtist, Year: year, Favorite: item.Favorite, SongCount: songCount, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func mapArtist(item *ent.Artist) models.Artist {
	return mapArtistWithCounts(item, len(item.Edges.Songs), len(item.Edges.Albums))
}

func mapArtistWithCounts(item *ent.Artist, songCount, albumCount int) models.Artist {
	return models.Artist{ID: item.ID, Name: item.Name, SongCount: songCount, AlbumCount: albumCount, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func mapPlaylist(item *ent.Playlist) models.Playlist {
	count := 0
	if item.Edges.Songs != nil {
		count = len(item.Edges.Songs)
	}
	return mapPlaylistWithCount(item, count)
}

func mapPlaylistWithCount(item *ent.Playlist, songCount int) models.Playlist {
	return models.Playlist{ID: item.ID, Name: item.Name, Description: item.Description, CoverTheme: item.CoverTheme, Favorite: item.Favorite, SongCount: songCount, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
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
