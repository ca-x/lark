package library

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"lark/backend/ent"
	entalbum "lark/backend/ent/album"
	"lark/backend/ent/song"
	"lark/backend/ent/useralbumfavorite"
	"lark/backend/internal/models"

	taglib "go.senan.xyz/taglib"
)

type FolderMetadataField string

const (
	FolderMetadataFieldTitle       FolderMetadataField = "title"
	FolderMetadataFieldArtist      FolderMetadataField = "artist"
	FolderMetadataFieldAlbum       FolderMetadataField = "album"
	FolderMetadataFieldAlbumArtist FolderMetadataField = "album_artist"
	FolderMetadataFieldGenre       FolderMetadataField = "genre"
	FolderMetadataFieldYear        FolderMetadataField = "year"
	FolderMetadataFieldLanguage    FolderMetadataField = "language"
	FolderMetadataFieldStyle       FolderMetadataField = "style"
	FolderMetadataFieldTrack       FolderMetadataField = "track"
)

var errFolderMetadataConfirmationRequired = errors.New("folder metadata correction confirmation is required")

const folderMetadataCorrectionMaxSongs = 5000

type FolderMetadataCorrectionInput struct {
	Path              string
	Field             FolderMetadataField
	Value             string
	WriteFiles        bool
	UpdateDatabase    bool
	Confirm           bool
	ExpectedSongCount *int
	ExpectedFileCount *int
	ExpectedSnapshot  string
}

func ParseFolderMetadataField(value string) (FolderMetadataField, error) {
	field := FolderMetadataField(strings.ToLower(strings.TrimSpace(value)))
	switch field {
	case FolderMetadataFieldTitle,
		FolderMetadataFieldArtist,
		FolderMetadataFieldAlbum,
		FolderMetadataFieldAlbumArtist,
		FolderMetadataFieldGenre,
		FolderMetadataFieldYear,
		FolderMetadataFieldLanguage,
		FolderMetadataFieldStyle,
		FolderMetadataFieldTrack:
		return field, nil
	default:
		return "", fmt.Errorf("unsupported metadata field")
	}
}

func normalizeFolderMetadataCorrectionInput(input FolderMetadataCorrectionInput) (FolderMetadataCorrectionInput, error) {
	field, err := ParseFolderMetadataField(string(input.Field))
	if err != nil {
		return FolderMetadataCorrectionInput{}, err
	}
	input.Field = field
	input.Path = strings.TrimSpace(input.Path)
	if input.Path == "" {
		input.Path = "."
	}
	input.Value = strings.TrimSpace(input.Value)
	if input.Value == "" {
		return FolderMetadataCorrectionInput{}, fmt.Errorf("metadata value is required")
	}
	if utf8.RuneCountInString(input.Value) > 512 {
		return FolderMetadataCorrectionInput{}, fmt.Errorf("metadata value exceeds 512 characters")
	}
	if input.Field == FolderMetadataFieldTrack && utf8.RuneCountInString(input.Value) > 64 {
		return FolderMetadataCorrectionInput{}, fmt.Errorf("track number exceeds 64 characters")
	}
	if !input.WriteFiles && !input.UpdateDatabase {
		return FolderMetadataCorrectionInput{}, fmt.Errorf("select at least one correction destination")
	}
	if input.Field == FolderMetadataFieldYear {
		year, err := strconv.Atoi(input.Value)
		if err != nil || year < 1 || year > 9999 {
			return FolderMetadataCorrectionInput{}, fmt.Errorf("year must be between 1 and 9999")
		}
		input.Value = strconv.Itoa(year)
	}
	if input.Field == FolderMetadataFieldArtist || input.Field == FolderMetadataFieldAlbumArtist {
		input.Value = normalizeArtistName(input.Value)
	}
	return input, nil
}

func (s *Service) PreviewFolderMetadataCorrection(ctx context.Context, userID int, input FolderMetadataCorrectionInput) (models.FolderMetadataCorrectionPreview, error) {
	input, err := normalizeFolderMetadataCorrectionInput(input)
	if err != nil {
		return models.FolderMetadataCorrectionPreview{}, err
	}
	items, _, err := s.folderMetadataCorrectionSongs(ctx, userID, input.Path)
	if err != nil {
		return models.FolderMetadataCorrectionPreview{}, err
	}
	groups := metadataWritebackFileGroups(items)
	preview := models.FolderMetadataCorrectionPreview{
		Field:     string(input.Field),
		Value:     input.Value,
		Snapshot:  folderMetadataCorrectionSnapshot(items, input),
		SongCount: len(items),
		FileCount: len(groups),
		Items:     []models.FolderMetadataCorrectionPreviewItem{},
	}
	const previewLimit = 12
	for _, item := range items[:min(len(items), previewLimit)] {
		preview.Items = append(preview.Items, models.FolderMetadataCorrectionPreviewItem{
			SongID:   item.ID,
			FileName: item.FileName,
			Title:    item.Title,
			Before:   folderMetadataValue(item, input.Field),
			After:    input.Value,
		})
	}
	return preview, nil
}

func (s *Service) CorrectFolderMetadata(ctx context.Context, userID int, input FolderMetadataCorrectionInput) (models.FolderMetadataCorrectionResult, error) {
	if !input.Confirm {
		return models.FolderMetadataCorrectionResult{}, errFolderMetadataConfirmationRequired
	}
	if !s.scanRunMu.TryLock() {
		return models.FolderMetadataCorrectionResult{}, ErrScanRunning
	}
	defer s.scanRunMu.Unlock()
	s.metadataWriteMu.Lock()
	defer s.metadataWriteMu.Unlock()
	input, err := normalizeFolderMetadataCorrectionInput(input)
	if err != nil {
		return models.FolderMetadataCorrectionResult{}, err
	}
	items, selectedRoot, err := s.folderMetadataCorrectionSongs(ctx, userID, input.Path)
	if err != nil {
		return models.FolderMetadataCorrectionResult{}, err
	}
	groups := metadataWritebackFileGroups(items)
	if input.ExpectedSongCount == nil || input.ExpectedFileCount == nil {
		return models.FolderMetadataCorrectionResult{}, fmt.Errorf("preview is required before correction")
	}
	if *input.ExpectedSongCount != len(items) || *input.ExpectedFileCount != len(groups) {
		return models.FolderMetadataCorrectionResult{}, fmt.Errorf("folder contents changed; preview again")
	}
	if input.ExpectedSnapshot == "" || input.ExpectedSnapshot != folderMetadataCorrectionSnapshot(items, input) {
		return models.FolderMetadataCorrectionResult{}, fmt.Errorf("folder contents changed; preview again")
	}
	result := models.FolderMetadataCorrectionResult{
		SongCount: len(items),
		FileCount: len(groups),
		Items:     []models.FolderMetadataCorrectionItem{},
	}
	databaseReadySongIDs := map[int]bool{}
	for _, group := range groups {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		fileStatus := ""
		fileMessage := ""
		fileOK := true
		if input.WriteFiles {
			if group.CUETrackCount > 0 {
				fileOK = false
				fileStatus = "failed"
				fileMessage = "CUE virtual tracks cannot safely share audio-file metadata writes"
				result.Failed++
			} else {
				writeErr := validateFolderMetadataWritePath(group.Path, selectedRoot)
				written := false
				if writeErr == nil {
					written, writeErr = writeFolderMetadataField(group.Path, input.Field, input.Value)
				}
				switch {
				case writeErr != nil:
					fileOK = false
					fileStatus = "failed"
					fileMessage = writeErr.Error()
					result.Failed++
				case written:
					fileStatus = "updated"
					result.FileUpdated++
				default:
					fileStatus = "skipped"
					result.Skipped++
				}
			}
		}
		groupCtx := ctx
		cancelGroup := func() {}
		stopAfterGroup := false
		if ctx.Err() != nil && fileStatus == "updated" {
			groupCtx, cancelGroup = context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
			stopAfterGroup = true
		}

		for _, item := range group.Songs {
			databaseStatus := ""
			message := fileMessage
			if input.UpdateDatabase {
				if !fileOK {
					databaseStatus = "skipped"
				} else if folderMetadataValue(item, input.Field) == input.Value {
					databaseStatus = "skipped"
					result.Skipped++
					databaseReadySongIDs[item.ID] = true
				} else if updateErr := s.updateFolderMetadataSong(groupCtx, item, input.Field, input.Value, group.Path, input.WriteFiles); updateErr != nil {
					databaseStatus = "failed"
					message = updateErr.Error()
					result.Failed++
				} else {
					databaseStatus = "updated"
					result.DatabaseUpdated++
					databaseReadySongIDs[item.ID] = true
				}
			} else if input.WriteFiles && fileStatus == "updated" {
				if updateErr := updateFolderMetadataFileFingerprint(groupCtx, item, group.Path); updateErr != nil {
					message = fmt.Sprintf("file written, but library fingerprint update failed: %v", updateErr)
					result.Failed++
				}
			}
			result.Items = append(result.Items, models.FolderMetadataCorrectionItem{
				SongID:         item.ID,
				FileName:       item.FileName,
				Title:          item.Title,
				FileStatus:     fileStatus,
				DatabaseStatus: databaseStatus,
				Message:        message,
			})
		}
		cancelGroup()
		if stopAfterGroup {
			s.invalidateFolderMetadataCorrectionCaches(ctx)
			return result, ctx.Err()
		}
	}
	if input.UpdateDatabase && input.Field == FolderMetadataFieldYear {
		year, _ := strconv.Atoi(input.Value)
		if err := s.updateFullySelectedAlbumYears(ctx, items, databaseReadySongIDs, year); err != nil {
			result.Failed++
			result.Items = append(result.Items, models.FolderMetadataCorrectionItem{Title: "Album year", DatabaseStatus: "failed", Message: err.Error()})
		}
	}
	if input.UpdateDatabase && (input.Field == FolderMetadataFieldAlbum || input.Field == FolderMetadataFieldAlbumArtist) {
		if err := s.cleanupFolderCorrectionAlbums(ctx, items); err != nil {
			result.Failed++
			result.Items = append(result.Items, models.FolderMetadataCorrectionItem{Title: "Old album cleanup", DatabaseStatus: "failed", Message: err.Error()})
		}
	}
	if result.FileUpdated > 0 || result.DatabaseUpdated > 0 {
		s.invalidateFolderMetadataCorrectionCaches(ctx)
	}
	return result, nil
}

func (s *Service) invalidateFolderMetadataCorrectionCaches(ctx context.Context) {
	cacheCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	s.invalidateLibraryCache(cacheCtx)
	s.invalidateSearchCatalogs(cacheCtx)
}

func (s *Service) updateFullySelectedAlbumYears(ctx context.Context, items []*ent.Song, readySongIDs map[int]bool, year int) error {
	selectedByAlbum := map[int]int{}
	readyByAlbum := map[int]int{}
	albums := map[int]*ent.Album{}
	for _, item := range items {
		if item == nil || item.Edges.Album == nil {
			continue
		}
		albumID := item.Edges.Album.ID
		selectedByAlbum[albumID]++
		albums[albumID] = item.Edges.Album
		if readySongIDs[item.ID] {
			readyByAlbum[albumID]++
		}
	}
	for albumID, item := range albums {
		total, err := item.QuerySongs().Count(ctx)
		if err != nil {
			return err
		}
		if total != selectedByAlbum[albumID] || readyByAlbum[albumID] != selectedByAlbum[albumID] || item.Year == year {
			continue
		}
		if _, err := item.Update().SetYear(year).Save(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) cleanupFolderCorrectionAlbums(ctx context.Context, items []*ent.Song) error {
	ids := []int{}
	seen := map[int]bool{}
	for _, item := range items {
		if item == nil || item.Edges.Album == nil || seen[item.Edges.Album.ID] {
			continue
		}
		seen[item.Edges.Album.ID] = true
		ids = append(ids, item.Edges.Album.ID)
	}
	if len(ids) == 0 {
		return nil
	}
	empty, err := s.client.Album.Query().Select(entalbum.FieldID).Where(entalbum.IDIn(ids...), entalbum.Not(entalbum.HasSongs())).All(ctx)
	if err != nil {
		return err
	}
	for _, item := range empty {
		if _, err := s.client.UserAlbumFavorite.Delete().Where(useralbumfavorite.HasAlbumWith(entalbum.ID(item.ID))).Exec(ctx); err != nil {
			return err
		}
		if err := s.client.Album.DeleteOneID(item.ID).Exec(ctx); err != nil && !ent.IsNotFound(err) {
			return err
		}
	}
	return nil
}

func updateFolderMetadataFileFingerprint(ctx context.Context, item *ent.Song, audioPath string) error {
	info, err := os.Stat(audioPath)
	if err != nil {
		return err
	}
	_, err = item.Update().SetSizeBytes(info.Size()).SetModTimeUnixNano(info.ModTime().UnixNano()).Save(ctx)
	return err
}

func (s *Service) folderMetadataCorrectionSongs(ctx context.Context, userID int, relPath string) ([]*ent.Song, string, error) {
	resolved, err := s.resolveLibraryFolderForUser(ctx, userID, relPath)
	if err != nil {
		return nil, "", err
	}
	prefix := resolved.Path + string(os.PathSeparator)
	items, err := s.client.Song.Query().
		Where(song.Or(song.Path(resolved.Path), song.PathHasPrefix(prefix))).
		WithArtist().
		WithAlbum(func(q *ent.AlbumQuery) { q.WithArtist() }).
		Order(ent.Asc(song.FieldPath)).
		Limit(folderMetadataCorrectionMaxSongs + 1).
		All(ctx)
	if err != nil {
		return nil, "", err
	}
	if len(items) > folderMetadataCorrectionMaxSongs {
		return nil, "", fmt.Errorf("folder correction is limited to %d songs; choose a smaller folder", folderMetadataCorrectionMaxSongs)
	}
	resolvedRoot, err := filepath.EvalSymlinks(resolved.Path)
	if err != nil {
		return nil, "", err
	}
	for _, item := range items {
		audioPath := ResolveAudioSegment(item.Path).Path
		if err := validateFolderMetadataWritePath(audioPath, resolvedRoot); err != nil {
			return nil, "", err
		}
	}
	return items, resolvedRoot, nil
}

func validateFolderMetadataWritePath(path, selectedRoot string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("song symlinks are not supported for metadata correction")
	}
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(selectedRoot, resolvedPath)
	if err != nil || rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("song path resolves outside the selected folder")
	}
	return nil
}

func folderMetadataCorrectionSnapshot(items []*ent.Song, input FolderMetadataCorrectionInput) string {
	hash := sha256.New()
	_, _ = fmt.Fprintf(hash, "%s\x00%s\x00%s\x00%t\x00%t\x00", input.Path, input.Field, input.Value, input.WriteFiles, input.UpdateDatabase)
	for _, item := range items {
		_, _ = fmt.Fprintf(hash, "%d\x00%s\x00%d\x00%d\x00%d\x00", item.ID, item.Path, item.SizeBytes, item.ModTimeUnixNano, item.UpdatedAt.UnixNano())
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func folderMetadataValue(item *ent.Song, field FolderMetadataField) string {
	if item == nil {
		return ""
	}
	switch field {
	case FolderMetadataFieldTitle:
		return item.Title
	case FolderMetadataFieldArtist:
		return songArtistName(item)
	case FolderMetadataFieldAlbum:
		return songAlbumTitle(item)
	case FolderMetadataFieldAlbumArtist:
		return songAlbumArtist(item)
	case FolderMetadataFieldGenre:
		return item.Genre
	case FolderMetadataFieldYear:
		if item.Year > 0 {
			return strconv.Itoa(item.Year)
		}
	case FolderMetadataFieldLanguage:
		return item.Language
	case FolderMetadataFieldStyle:
		return item.Style
	case FolderMetadataFieldTrack:
		return item.Track
	}
	return ""
}

func writeFolderMetadataField(path string, field FolderMetadataField, value string) (bool, error) {
	if isWAVMetadataPath(path) {
		existing := probeWAVMetadata(path)
		if folderMetadataValueFromWAV(existing, field) == value {
			return false, nil
		}
		patch := fileMetadata{}
		switch field {
		case FolderMetadataFieldTitle:
			patch.Title = value
		case FolderMetadataFieldArtist:
			patch.Artist = value
		case FolderMetadataFieldAlbum:
			patch.Album = value
		case FolderMetadataFieldYear:
			patch.Year, _ = strconv.Atoi(value)
		default:
			return false, fmt.Errorf("%s tags are not supported for WAV files", strings.ReplaceAll(string(field), "_", " "))
		}
		written, err := writeMergedWAVInfoMetadata(path, patch)
		if err != nil || !written {
			return written, err
		}
		if got := folderMetadataValueFromWAV(probeWAVMetadata(path), field); got != value {
			return false, fmt.Errorf("audio tag verification failed")
		}
		return true, nil
	}
	key := folderMetadataTagKey(field)
	if key == "" {
		return false, fmt.Errorf("unsupported audio metadata field")
	}
	existing, err := taglib.ReadTags(path)
	if err != nil {
		return false, err
	}
	if values := existing[key]; len(values) > 0 && strings.TrimSpace(values[0]) == value {
		return false, nil
	}
	if err := taglib.WriteTags(path, map[string][]string{key: {value}}, 0); err != nil {
		return false, err
	}
	if err := verifyWrittenAudioTags(path, map[string][]string{key: {value}}); err != nil {
		return false, err
	}
	return true, nil
}

func folderMetadataTagKey(field FolderMetadataField) string {
	switch field {
	case FolderMetadataFieldTitle:
		return taglib.Title
	case FolderMetadataFieldArtist:
		return taglib.Artist
	case FolderMetadataFieldAlbum:
		return taglib.Album
	case FolderMetadataFieldAlbumArtist:
		return taglib.AlbumArtist
	case FolderMetadataFieldGenre:
		return taglib.Genre
	case FolderMetadataFieldYear:
		return taglib.Date
	case FolderMetadataFieldLanguage:
		return taglib.Language
	case FolderMetadataFieldStyle:
		return "STYLE"
	case FolderMetadataFieldTrack:
		return taglib.TrackNumber
	default:
		return ""
	}
}

func folderMetadataValueFromWAV(meta fileMetadata, field FolderMetadataField) string {
	switch field {
	case FolderMetadataFieldTitle:
		return meta.Title
	case FolderMetadataFieldArtist:
		return meta.Artist
	case FolderMetadataFieldAlbum:
		return meta.Album
	case FolderMetadataFieldYear:
		if meta.Year > 0 {
			return strconv.Itoa(meta.Year)
		}
	}
	return ""
}

func (s *Service) updateFolderMetadataSong(ctx context.Context, item *ent.Song, field FolderMetadataField, value, audioPath string, refreshFileInfo bool) error {
	update := item.Update()
	title := item.Title
	artistName := songArtistName(item)
	albumTitle := songAlbumTitle(item)
	albumArtist := songAlbumArtist(item)
	year := item.Year
	artistItem := item.Edges.Artist
	albumItem := item.Edges.Album

	switch field {
	case FolderMetadataFieldTitle:
		title = value
		update.SetTitle(value)
	case FolderMetadataFieldArtist:
		var err error
		artistName = value
		artistItem, err = s.ensureArtist(ctx, value)
		if err != nil {
			return err
		}
		update.SetArtist(artistItem)
	case FolderMetadataFieldAlbum:
		albumTitle = value
		albumOwner := artistItem
		if item.Edges.Album != nil && item.Edges.Album.Edges.Artist != nil {
			albumOwner = item.Edges.Album.Edges.Artist
		}
		var err error
		albumItem, err = s.ensureAlbum(ctx, value, albumArtist, albumOwner, year)
		if err != nil {
			return err
		}
		if item.Edges.Album != nil && item.Edges.Album.ID != albumItem.ID {
			if err := s.copyFolderCorrectionAlbumFavorites(ctx, item.Edges.Album.ID, albumItem.ID); err != nil {
				return err
			}
		}
		update.SetAlbum(albumItem)
	case FolderMetadataFieldAlbumArtist:
		albumArtist = value
		albumOwner, err := s.ensureArtist(ctx, value)
		if err != nil {
			return err
		}
		albumItem, err = s.ensureAlbum(ctx, albumTitle, value, albumOwner, year)
		if err != nil {
			return err
		}
		if item.Edges.Album != nil && item.Edges.Album.ID != albumItem.ID {
			if err := s.copyFolderCorrectionAlbumFavorites(ctx, item.Edges.Album.ID, albumItem.ID); err != nil {
				return err
			}
		}
		update.SetAlbum(albumItem)
	case FolderMetadataFieldGenre:
		update.SetGenre(value)
	case FolderMetadataFieldYear:
		year, _ = strconv.Atoi(value)
		update.SetYear(year)
	case FolderMetadataFieldLanguage:
		update.SetLanguage(value)
	case FolderMetadataFieldStyle:
		update.SetStyle(value)
	case FolderMetadataFieldTrack:
		update.SetTrack(value)
	}
	if refreshFileInfo {
		info, err := os.Stat(audioPath)
		if err != nil {
			return err
		}
		update.SetSizeBytes(info.Size()).SetModTimeUnixNano(info.ModTime().UnixNano())
	}
	if field == FolderMetadataFieldTitle || field == FolderMetadataFieldArtist || field == FolderMetadataFieldAlbum {
		if ResolveAudioSegment(item.Path).IsCUETrack {
			update.SetContentHash(cueTrackContentHash(item.Path, fileMetadata{Title: title, Artist: artistName, Album: albumTitle}))
		} else {
			update.SetContentHash(songContentHash(artistName, albumTitle, title))
		}
	}
	_, err := update.Save(ctx)
	return err
}

func (s *Service) copyFolderCorrectionAlbumFavorites(ctx context.Context, fromAlbumID, toAlbumID int) error {
	if fromAlbumID <= 0 || toAlbumID <= 0 || fromAlbumID == toAlbumID {
		return nil
	}
	favorites, err := s.client.UserAlbumFavorite.Query().
		Where(useralbumfavorite.HasAlbumWith(entalbum.ID(fromAlbumID))).
		WithUser().
		All(ctx)
	if err != nil {
		return err
	}
	for _, favorite := range favorites {
		if favorite.Edges.User == nil {
			continue
		}
		if _, err := s.client.UserAlbumFavorite.Create().SetUserID(favorite.Edges.User.ID).SetAlbumID(toAlbumID).Save(ctx); err != nil && !ent.IsConstraintError(err) {
			return err
		}
	}
	return nil
}
