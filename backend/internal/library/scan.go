package library

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/playhistory"
	"lark/backend/ent/song"
	"lark/backend/ent/usersongfavorite"
	"lark/backend/internal/models"
)

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
		cueReferencedAudio := s.cueReferencedAudioPaths(scanCtx, rootPath)
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
			if isCUEFile(path) {
				cueResult, err := s.importCUEFile(scanCtx, path, false)
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
				result.Scanned += cueResult.Scanned
				result.Added += cueResult.Added
				result.Updated += cueResult.Updated
				for _, audioPath := range cueResult.AudioPaths {
					cueReferencedAudio[audioPath] = true
				}
				if cueResult.Scanned == 0 {
					result.Skipped++
				}
				s.updateScanProgress(path, result.CurrentDir, &result)
				return nil
			}
			abs, err := filepath.Abs(path)
			if err == nil && cueReferencedAudio[abs] {
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
			if result.Scanned%500 == 0 {
				debug.FreeOSMemory()
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
	if err := s.NormalizeArtists(ctx); err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("normalize artists: %v", err))
	}
	s.invalidateLibraryCache(ctx)
	s.invalidateSearchCatalogs(ctx)
	debug.FreeOSMemory()
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
func songPathMissing(path string) bool {
	ref, ok := parseCueVirtualSongPath(path)
	if ok {
		if _, err := os.Stat(ref.AudioPath); err != nil {
			return os.IsNotExist(err)
		}
		if _, err := os.Stat(ref.CuePath); err != nil {
			return os.IsNotExist(err)
		}
		return false
	}
	_, err := os.Stat(path)
	return os.IsNotExist(err)
}
func recentScanErrors(errors []string) []string {
	const maxScanStatusErrors = 50
	if len(errors) <= maxScanStatusErrors {
		return errors
	}
	return errors[len(errors)-maxScanStatusErrors:]
}
func cloneScanStatus(status models.ScanStatus) models.ScanStatus {
	status.Errors = append([]string{}, status.Errors...)
	return status
}
func (s *Service) ImportFile(ctx context.Context, path string) (bool, error) {
	return s.importFile(ctx, path, true)
}
func (s *Service) importFile(ctx context.Context, path string, invalidate bool) (bool, error) {
	if isCUEFile(path) {
		result, err := s.importCUEFile(ctx, path, invalidate)
		return result.Added > 0, err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return false, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return false, err
	}
	if info.IsDir() || !IsAudioSupported(abs) {
		return false, fmt.Errorf("unsupported audio file")
	}
	sizeBytes := info.Size()
	modTimeUnixNano := info.ModTime().UnixNano()
	existing, err := s.client.Song.Query().Where(song.Path(abs)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return false, err
	}
	existingNotFound := ent.IsNotFound(err)
	reusedMissingContent := false
	if err == nil && existing.SizeBytes == sizeBytes && existing.ModTimeUnixNano == modTimeUnixNano {
		return false, nil
	}
	meta := s.probe(ctx, abs, probeOptions{
		DetectLyrics: supportsEmbeddedLyrics(abs),
		ReadLyrics:   false,
	})
	probedMeta := meta
	applyMetadataFallback(abs, s.libraryDir, &meta)
	if settings, err := s.GetSettings(ctx); err == nil {
		if settings.LibraryPathMetadataAssist {
			applyPathMetadataAssist(abs, s.libraryDir, &meta)
		}
		if !settings.MetadataGrouping {
			meta.AlbumArtist = meta.Artist
		}
		if settings.LibraryTagWriteback {
			written, err := writeBackCorrectedMetadata(abs, probedMeta, meta)
			if err != nil {
				return false, err
			}
			if written {
				info, err = os.Stat(abs)
				if err != nil {
					return false, err
				}
				sizeBytes = info.Size()
				modTimeUnixNano = info.ModTime().UnixNano()
			}
		}
	}
	format := strings.TrimPrefix(strings.ToLower(filepath.Ext(abs)), ".")
	mimeType := audioMimeForPath(abs, format)
	artistEntity, err := s.ensureArtist(ctx, meta.Artist)
	if err != nil {
		return false, err
	}
	albumEntity, err := s.ensureAlbum(ctx, meta.Album, meta.AlbumArtist, artistEntity, meta.Year)
	if err != nil {
		return false, err
	}
	contentHash := songContentHash(meta.Artist, meta.Album, meta.Title)
	if existingNotFound && contentHash != "" {
		reusable, skipDuplicate, err := s.reusableSongByContentHash(ctx, contentHash, abs)
		if err != nil {
			return false, err
		}
		if skipDuplicate {
			return false, nil
		}
		if reusable != nil {
			existing = reusable
			existingNotFound = false
			reusedMissingContent = true
		}
	}
	lyricsSource := ""
	if meta.HasLyrics {
		lyricsSource = "embedded"
	}
	if existingNotFound {
		create := s.client.Song.Create().
			SetTitle(meta.Title).
			SetPath(abs).
			SetFileName(filepath.Base(abs)).
			SetFormat(format).
			SetMime(mimeType).
			SetSizeBytes(sizeBytes).
			SetModTimeUnixNano(modTimeUnixNano).
			SetContentHash(contentHash).
			SetDurationSeconds(meta.Duration).
			SetSampleRate(meta.SampleRate).
			SetBitRate(meta.BitRate).
			SetBitDepth(meta.BitDepth).
			SetYear(meta.Year).
			SetArtist(artistEntity).
			SetAlbum(albumEntity).
			SetHasLyrics(meta.HasLyrics)
		if lyricsSource != "" {
			create.SetLyricsSource(lyricsSource)
		}
		_, err = create.Save(ctx)
		if err == nil && invalidate {
			s.invalidateLibraryCache(ctx)
			s.invalidateSearchCatalogs(ctx)
		}
		return true, err
	}
	update := existing.Update().
		SetTitle(meta.Title).
		SetPath(abs).
		SetFileName(filepath.Base(abs)).
		SetFormat(format).
		SetMime(mimeType).
		SetSizeBytes(sizeBytes).
		SetModTimeUnixNano(modTimeUnixNano).
		SetContentHash(contentHash).
		SetDurationSeconds(meta.Duration).
		SetSampleRate(meta.SampleRate).
		SetBitRate(meta.BitRate).
		SetBitDepth(meta.BitDepth).
		SetYear(meta.Year).
		SetArtist(artistEntity).
		SetAlbum(albumEntity)
	if meta.HasLyrics {
		update.SetLyricsEmbedded("").SetLyricsSource("embedded").SetHasLyrics(true)
	} else if existing.LyricsSource == "embedded" {
		update.SetLyricsEmbedded("").SetLyricsSource("").SetHasLyrics(false)
	}
	_, err = update.Save(ctx)
	if err == nil && invalidate {
		s.invalidateLibraryCache(ctx)
		s.invalidateSearchCatalogs(ctx)
	}
	return reusedMissingContent, err
}
func (s *Service) importCUEFile(ctx context.Context, cuePath string, invalidate bool) (cueImportResult, error) {
	absCue, err := filepath.Abs(cuePath)
	if err != nil {
		return cueImportResult{}, err
	}
	cueInfo, err := os.Stat(absCue)
	if err != nil {
		return cueImportResult{}, err
	}
	sheet, err := s.parseCueSheet(ctx, absCue)
	if err != nil {
		if errors.Is(err, errCueNoAudioTracks) {
			return cueImportResult{}, nil
		}
		return cueImportResult{}, err
	}
	result := cueImportResult{AudioPaths: uniqueCueAudioPaths(sheet)}
	currentPaths := map[string]bool{}
	audioMeta := map[string]fileMetadata{}
	audioInfo := map[string]os.FileInfo{}

	for _, audioPath := range result.AudioPaths {
		if !IsAudioSupported(audioPath) {
			return result, fmt.Errorf("unsupported cue audio format: %s", audioPath)
		}
		info, err := os.Stat(audioPath)
		if err != nil {
			return result, err
		}
		audioInfo[audioPath] = info
		audioMeta[audioPath] = s.probe(ctx, audioPath, probeOptions{
			DetectLyrics: supportsEmbeddedLyrics(audioPath),
			ReadLyrics:   false,
		})
	}

	for _, track := range sheet.Tracks {
		if track.File == "" || !IsAudioSupported(track.File) {
			continue
		}
		info := audioInfo[track.File]
		baseMeta := audioMeta[track.File]
		if info == nil {
			continue
		}
		duration := 0.0
		if track.EndSeconds > track.StartSeconds {
			duration = track.EndSeconds - track.StartSeconds
		}
		if duration <= 0 && len(sheet.Tracks) == 1 && baseMeta.Duration > 0 {
			duration = baseMeta.Duration
		}
		title := firstString(track.Title, fmt.Sprintf("Track %02d", track.Number))
		trackArtist := firstString(track.Performer, sheet.Performer, baseMeta.Artist, "Unknown Artist")
		albumTitle := firstString(sheet.Title, baseMeta.Album, fallbackAlbumFromFolder(track.File, s.libraryDir), "Unknown Album")
		albumArtist := firstString(sheet.Performer, baseMeta.AlbumArtist, trackArtist)
		meta := fileMetadata{
			Title:       title,
			Artist:      trackArtist,
			Album:       albumTitle,
			AlbumArtist: albumArtist,
			HasLyrics:   baseMeta.HasLyrics,
			Duration:    duration,
			SampleRate:  baseMeta.SampleRate,
			BitRate:     baseMeta.BitRate,
			BitDepth:    baseMeta.BitDepth,
			Year:        baseMeta.Year,
		}
		if settings, err := s.GetSettings(ctx); err == nil {
			if settings.LibraryPathMetadataAssist {
				applyPathMetadataAssist(track.File, s.libraryDir, &meta)
			}
			if !settings.MetadataGrouping {
				meta.AlbumArtist = meta.Artist
			}
		}
		sizeBytes := info.Size() + cueInfo.Size()
		modTime := info.ModTime()
		if cueInfo.ModTime().After(modTime) {
			modTime = cueInfo.ModTime()
		}
		virtualPath := cueVirtualSongPath(track.File, absCue, track.Number, track.StartSeconds, track.EndSeconds)
		currentPaths[virtualPath] = true
		result.Scanned++
		added, err := s.upsertCUETrack(ctx, virtualPath, track.File, meta, sizeBytes, modTime.UnixNano())
		if err != nil {
			return result, err
		}
		if added {
			result.Added++
		} else {
			result.Updated++
		}
	}
	if err := s.cleanupCUESongRows(ctx, absCue, result.AudioPaths, currentPaths); err != nil {
		return result, err
	}
	if invalidate {
		s.invalidateLibraryCache(ctx)
		s.invalidateSearchCatalogs(ctx)
	}
	return result, nil
}
func (s *Service) upsertCUETrack(ctx context.Context, virtualPath, audioPath string, meta fileMetadata, sizeBytes, modTimeUnixNano int64) (bool, error) {
	existing, err := s.client.Song.Query().Where(song.Path(virtualPath)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return false, err
	}
	existingNotFound := ent.IsNotFound(err)
	if err == nil && existing.SizeBytes == sizeBytes && existing.ModTimeUnixNano == modTimeUnixNano {
		return false, nil
	}
	format := strings.TrimPrefix(strings.ToLower(filepath.Ext(audioPath)), ".")
	mimeType := audioMimeForPath(audioPath, format)
	artistEntity, err := s.ensureArtist(ctx, meta.Artist)
	if err != nil {
		return false, err
	}
	albumEntity, err := s.ensureAlbum(ctx, meta.Album, meta.AlbumArtist, artistEntity, meta.Year)
	if err != nil {
		return false, err
	}
	contentHash := cueTrackContentHash(virtualPath, meta)
	lyricsSource := ""
	if meta.HasLyrics {
		lyricsSource = "embedded"
	}
	if existingNotFound {
		create := s.client.Song.Create().
			SetTitle(meta.Title).
			SetPath(virtualPath).
			SetFileName(filepath.Base(audioPath)).
			SetFormat(format).
			SetMime(mimeType).
			SetSizeBytes(sizeBytes).
			SetModTimeUnixNano(modTimeUnixNano).
			SetContentHash(contentHash).
			SetDurationSeconds(meta.Duration).
			SetSampleRate(meta.SampleRate).
			SetBitRate(meta.BitRate).
			SetBitDepth(meta.BitDepth).
			SetYear(meta.Year).
			SetArtist(artistEntity).
			SetAlbum(albumEntity).
			SetHasLyrics(meta.HasLyrics)
		if lyricsSource != "" {
			create.SetLyricsSource(lyricsSource)
		}
		_, err := create.Save(ctx)
		return true, err
	}
	update := existing.Update().
		SetTitle(meta.Title).
		SetPath(virtualPath).
		SetFileName(filepath.Base(audioPath)).
		SetFormat(format).
		SetMime(mimeType).
		SetSizeBytes(sizeBytes).
		SetModTimeUnixNano(modTimeUnixNano).
		SetContentHash(contentHash).
		SetDurationSeconds(meta.Duration).
		SetSampleRate(meta.SampleRate).
		SetBitRate(meta.BitRate).
		SetBitDepth(meta.BitDepth).
		SetYear(meta.Year).
		SetArtist(artistEntity).
		SetAlbum(albumEntity)
	if meta.HasLyrics {
		update.SetLyricsEmbedded("").SetLyricsSource("embedded").SetHasLyrics(true)
	} else if existing.LyricsSource == "embedded" {
		update.SetLyricsEmbedded("").SetLyricsSource("").SetHasLyrics(false)
	}
	return false, update.Exec(ctx)
}
func cueTrackContentHash(virtualPath string, meta fileMetadata) string {
	seed := strings.Join([]string{virtualPath, meta.Artist, meta.Album, meta.Title}, "\x00")
	sum := sha1.Sum([]byte(seed))
	return hex.EncodeToString(sum[:])
}
func (s *Service) cleanupCUESongRows(ctx context.Context, cuePath string, audioPaths []string, currentPaths map[string]bool) error {
	deleteIDs := []int{}
	if len(audioPaths) > 0 {
		fullAudioRows, err := s.client.Song.Query().Select(song.FieldID).Where(song.PathIn(audioPaths...)).All(ctx)
		if err != nil {
			return err
		}
		for _, item := range fullAudioRows {
			deleteIDs = append(deleteIDs, item.ID)
		}
	}
	virtualRows, err := s.client.Song.Query().
		Select(song.FieldID, song.FieldPath).
		Where(song.PathContains(cueVirtualMarker)).
		All(ctx)
	if err != nil {
		return err
	}
	for _, item := range virtualRows {
		ref, ok := parseCueVirtualSongPath(item.Path)
		if !ok || ref.CuePath != cuePath || currentPaths[item.Path] {
			continue
		}
		deleteIDs = append(deleteIDs, item.ID)
	}
	return s.deleteSongIDs(ctx, deleteIDs)
}
func (s *Service) deleteSongIDs(ctx context.Context, ids []int) error {
	if len(ids) == 0 {
		return nil
	}
	if _, err := s.client.UserSongFavorite.Delete().
		Where(usersongfavorite.HasSongWith(song.IDIn(ids...))).
		Exec(ctx); err != nil {
		return err
	}
	if _, err := s.client.PlayHistory.Delete().
		Where(playhistory.HasSongWith(song.IDIn(ids...))).
		Exec(ctx); err != nil {
		return err
	}
	_, err := s.client.Song.Delete().Where(song.IDIn(ids...)).Exec(ctx)
	return err
}
func (s *Service) cueReferencedAudioPaths(ctx context.Context, root string) map[string]bool {
	out := map[string]bool{}
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil || d.IsDir() || !isCUEFile(path) {
			return nil
		}
		paths, err := cueSheetAudioPaths(path)
		if err != nil {
			return nil
		}
		for _, audioPath := range paths {
			out[audioPath] = true
		}
		return nil
	})
	return out
}
func (s *Service) firstCueReferencingAudio(ctx context.Context, audioPath string) (string, bool) {
	absAudio, err := filepath.Abs(audioPath)
	if err != nil {
		return "", false
	}
	dir := filepath.Dir(absAudio)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", false
	}
	for _, entry := range entries {
		if entry.IsDir() || !isCUEFile(entry.Name()) {
			continue
		}
		cuePath := filepath.Join(dir, entry.Name())
		paths, err := cueSheetAudioPaths(cuePath)
		if err != nil {
			continue
		}
		for _, path := range paths {
			if ctx.Err() != nil {
				return "", false
			}
			if samePath(path, absAudio) {
				return cuePath, true
			}
		}
	}
	return "", false
}
