package library

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/song"
	"lark/backend/internal/models"

	taglib "go.senan.xyz/taglib"
)

const metadataCoverMaxBytes = 8 << 20
const metadataPathCandidateSource = "path"

type MetadataWritebackInput struct {
	Title            string
	Artist           string
	Album            string
	AlbumArtist      string
	Year             int
	CoverURL         string
	CoverData        []byte
	CoverMime        string
	PathAssist       bool
	ConfirmWriteback bool
}

var errMetadataWritebackConfirmationRequired = errors.New("metadata writeback confirmation is required")

func (s *Service) SongMetadataCandidates(ctx context.Context, id int) ([]models.MetadataCandidate, error) {
	item, err := s.client.Song.Query().
		Where(song.ID(id)).
		WithArtist().
		WithAlbum().
		Only(ctx)
	if err != nil {
		return nil, err
	}
	title := strings.TrimSpace(item.Title)
	artistName := ""
	if item.Edges.Artist != nil {
		artistName = strings.TrimSpace(item.Edges.Artist.Name)
	}
	pathCandidate, hasPathCandidate := metadataPathCandidateFromSong(item, s.libraryDir)
	if title == "" {
		if hasPathCandidate {
			return []models.MetadataCandidate{pathCandidate}, nil
		}
		return []models.MetadataCandidate{}, nil
	}
	searchCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	type providerResult struct {
		items []models.MetadataCandidate
	}
	resultCh := make(chan providerResult, len(s.online))
	var wg sync.WaitGroup
	for _, provider := range s.online {
		provider := provider
		wg.Add(1)
		go func() {
			defer wg.Done()
			found, err := provider.SearchSongs(searchCtx, title, artistName)
			if err != nil {
				return
			}
			items := make([]models.MetadataCandidate, 0, len(found))
			for _, candidate := range found {
				if strings.TrimSpace(candidate.ID) == "" || strings.TrimSpace(candidate.Title) == "" {
					continue
				}
				items = append(items, models.MetadataCandidate{
					Source: provider.Name(),
					ID:     candidate.ID,
					Title:  strings.TrimSpace(candidate.Title),
					Artist: strings.TrimSpace(candidate.Artist),
					Album:  strings.TrimSpace(candidate.Album),
					Cover:  strings.TrimSpace(candidate.Cover),
				})
			}
			select {
			case resultCh <- providerResult{items: items}:
			case <-searchCtx.Done():
			}
		}()
	}
	go func() {
		wg.Wait()
		close(resultCh)
	}()

	out := []models.MetadataCandidate{}
	seen := map[string]bool{}
	for result := range resultCh {
		for _, candidate := range result.items {
			key := candidate.Source + ":" + candidate.ID
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, candidate)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return metadataCandidateScore(out[i], title, artistName) > metadataCandidateScore(out[j], title, artistName)
	})
	if len(out) > 12 {
		out = out[:12]
	}
	if hasPathCandidate {
		out = append([]models.MetadataCandidate{pathCandidate}, out...)
	}
	return out, nil
}

func (s *Service) AlbumMetadataCandidates(ctx context.Context, id int) ([]models.MetadataCandidate, error) {
	item, err := s.client.Album.Query().
		Where(album.ID(id)).
		WithArtist().
		WithSongs(func(q *ent.SongQuery) {
			q.Order(ent.Asc(song.FieldID))
		}).
		Only(ctx)
	if err != nil {
		return nil, err
	}
	remote := s.searchRemoteAlbums(ctx, item.Title, albumSearchArtistName(item))
	out := make([]models.MetadataCandidate, 0, len(remote))
	for _, candidate := range remote {
		out = append(out, models.MetadataCandidate{
			Source:      candidate.Source,
			ID:          candidate.ID,
			Title:       strings.TrimSpace(candidate.Title),
			Artist:      strings.TrimSpace(candidate.Artist),
			Year:        candidate.Year,
			Cover:       strings.TrimSpace(candidate.Cover),
			ReleaseDate: strings.TrimSpace(candidate.ReleaseDate),
			Link:        strings.TrimSpace(candidate.Link),
		})
	}
	if candidate, ok := metadataPathCandidateFromAlbum(item, s.libraryDir); ok {
		out = append([]models.MetadataCandidate{candidate}, out...)
	}
	return out, nil
}

func (s *Service) UpdateSongMetadata(ctx context.Context, userID, id int, input MetadataWritebackInput) (models.MetadataWritebackResult, error) {
	if !input.ConfirmWriteback {
		return models.MetadataWritebackResult{}, errMetadataWritebackConfirmationRequired
	}
	input = normalizeMetadataWritebackInput(input)
	if input.Year < 0 || input.Year > 9999 {
		return models.MetadataWritebackResult{}, fmt.Errorf("year must be between 0 and 9999")
	}
	item, err := s.client.Song.Query().
		Where(song.ID(id)).
		WithArtist().
		WithAlbum().
		Only(ctx)
	if err != nil {
		return models.MetadataWritebackResult{}, err
	}
	result := newMetadataWritebackResult()
	source := ResolveAudioSegment(item.Path)
	if source.IsCUETrack {
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			SongID:  item.ID,
			Title:   item.Title,
			Path:    item.Path,
			Status:  "failed",
			Message: "CUE virtual tracks share one audio file; edit the album metadata instead",
		})
		return result, nil
	}
	audioPath, err := filepath.Abs(source.Path)
	if err != nil {
		return models.MetadataWritebackResult{}, err
	}
	if !metadataWritebackHasChanges(input) {
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			SongID:  item.ID,
			Title:   item.Title,
			Path:    audioPath,
			Status:  "skipped",
			Message: "no metadata fields were provided",
		})
		return result, nil
	}
	coverData, coverMime, err := s.metadataCoverData(ctx, input)
	if err != nil {
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			SongID:  item.ID,
			Title:   item.Title,
			Path:    audioPath,
			Status:  "failed",
			Message: err.Error(),
		})
		return result, nil
	}
	tags := taglibTagsForSong(input)
	wavMeta := wavPatchForSong(input)
	written, err := writeAudioMetadata(audioPath, tags, wavMeta, coverData, coverMime)
	if err != nil {
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			SongID:  item.ID,
			Title:   item.Title,
			Path:    audioPath,
			Status:  "failed",
			Message: err.Error(),
		})
		return result, nil
	}
	if !written {
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			SongID:  item.ID,
			Title:   item.Title,
			Path:    audioPath,
			Status:  "skipped",
			Message: "file metadata did not change",
		})
		return result, nil
	}

	updatedSong, err := s.updateSongRowAfterWriteback(ctx, item, input, audioPath)
	if err != nil {
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			SongID:  item.ID,
			Title:   item.Title,
			Path:    audioPath,
			Status:  "failed",
			Message: err.Error(),
		})
		return result, nil
	}
	coverVersion := time.Now().UnixNano()
	if len(coverData) > 0 {
		if updatedSong.Edges.Album != nil {
			_ = s.writeCollectionCoverCache("albums", strconv.Itoa(updatedSong.Edges.Album.ID), coverMime, coverData)
		}
	}
	modelItems, err := s.applySongUserState(ctx, userID, []models.Song{mapSong(updatedSong)})
	if err != nil {
		return result, err
	}
	modelItems[0].CoverVersion = coverVersion
	result.Song = &modelItems[0]
	addMetadataWritebackItem(&result, models.MetadataWritebackItem{
		SongID: item.ID,
		Title:  modelItems[0].Title,
		Path:   audioPath,
		Status: "updated",
	})
	s.invalidateLibraryCache(ctx)
	s.invalidateSearchCatalogs(ctx)
	return result, nil
}

func (s *Service) UpdateAlbumMetadata(ctx context.Context, userID, id int, input MetadataWritebackInput) (models.MetadataWritebackResult, error) {
	if !input.ConfirmWriteback {
		return models.MetadataWritebackResult{}, errMetadataWritebackConfirmationRequired
	}
	input = normalizeMetadataWritebackInput(input)
	if input.Year < 0 || input.Year > 9999 {
		return models.MetadataWritebackResult{}, fmt.Errorf("year must be between 0 and 9999")
	}
	item, err := s.client.Album.Query().
		Where(album.ID(id)).
		WithArtist().
		WithSongs(func(q *ent.SongQuery) {
			q.WithArtist().WithAlbum().Order(ent.Asc(song.FieldID))
		}).
		Only(ctx)
	if err != nil {
		return models.MetadataWritebackResult{}, err
	}
	result := newMetadataWritebackResult()
	if len(item.Edges.Songs) == 0 {
		return result, nil
	}
	if input.PathAssist {
		return s.updateAlbumMetadataFromPath(ctx, userID, item, input)
	}
	if !metadataWritebackHasChanges(input) {
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			Path:    item.Title,
			Status:  "skipped",
			Message: "no metadata fields were provided",
		})
		return result, nil
	}
	coverData, coverMime, err := s.metadataCoverData(ctx, input)
	if err != nil {
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			Path:    item.Title,
			Status:  "failed",
			Message: err.Error(),
		})
		return result, nil
	}

	targetTitle := firstString(input.Title, item.Title)
	targetAlbumArtist := firstString(input.AlbumArtist, item.AlbumArtist, albumSearchArtistName(item))
	targetYear := input.Year
	if targetYear <= 0 {
		targetYear = item.Year
	}
	targetArtist := item.Edges.Artist
	if targetAlbumArtist != "" {
		targetArtist, err = s.ensureArtist(ctx, targetAlbumArtist)
		if err != nil {
			return models.MetadataWritebackResult{}, err
		}
	}
	targetSongArtistName := albumTargetTrackArtistName(input, item)
	var targetSongArtist *ent.Artist
	if targetSongArtistName != "" {
		if targetArtist != nil && strings.EqualFold(strings.TrimSpace(targetArtist.Name), targetSongArtistName) {
			targetSongArtist = targetArtist
		} else {
			targetSongArtist, err = s.ensureArtist(ctx, targetSongArtistName)
			if err != nil {
				return models.MetadataWritebackResult{}, err
			}
		}
	}
	targetAlbum, err := s.ensureAlbum(ctx, targetTitle, targetAlbumArtist, targetArtist, targetYear)
	if err != nil {
		return models.MetadataWritebackResult{}, err
	}

	groups := metadataWritebackFileGroups(item.Edges.Songs)
	coverVersion := time.Now().UnixNano()
	updatedSongIDs := []int{}
	for _, group := range groups {
		tags := taglibTagsForAlbum(input, targetSongArtistName)
		wavMeta := wavPatchForAlbum(input, targetSongArtistName)
		written, writeErr := writeAudioMetadata(group.Path, tags, wavMeta, coverData, coverMime)
		if writeErr != nil {
			addMetadataWritebackItem(&result, models.MetadataWritebackItem{
				Path:    group.Path,
				Status:  "failed",
				Message: writeErr.Error(),
			})
			continue
		}
		if !written {
			addMetadataWritebackItem(&result, models.MetadataWritebackItem{
				Path:    group.Path,
				Status:  "skipped",
				Message: "file metadata did not change",
			})
			continue
		}
		for _, songItem := range group.Songs {
			if err := s.updateAlbumSongRowAfterWriteback(ctx, songItem, targetSongArtist, targetAlbum, input.Year, group.Path); err != nil {
				addMetadataWritebackItem(&result, models.MetadataWritebackItem{
					SongID:  songItem.ID,
					Title:   songItem.Title,
					Path:    group.Path,
					Status:  "failed",
					Message: err.Error(),
				})
				continue
			}
			updatedSongIDs = append(updatedSongIDs, songItem.ID)
		}
		message := ""
		if group.CUETrackCount > 0 {
			message = fmt.Sprintf("%d CUE virtual tracks share this audio file; wrote once", group.CUETrackCount)
		}
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			Path:    group.Path,
			Status:  "updated",
			Message: message,
		})
	}
	if result.Updated == 0 {
		return result, nil
	}
	if len(coverData) > 0 {
		_ = s.writeCollectionCoverCache("albums", strconv.Itoa(targetAlbum.ID), coverMime, coverData)
		if targetAlbum.ID != item.ID {
			_ = s.writeCollectionCoverCache("albums", strconv.Itoa(item.ID), coverMime, coverData)
		}
	}
	s.invalidateLibraryCache(ctx)
	s.invalidateSearchCatalogs(ctx)

	albumModel, err := s.albumModelForUser(ctx, userID, targetAlbum.ID, coverVersion)
	if err != nil {
		return result, err
	}
	result.Album = &albumModel
	if len(updatedSongIDs) > 0 {
		songModels, err := s.songsForUserByIDs(ctx, userID, updatedSongIDs, coverVersion)
		if err != nil {
			return result, err
		}
		result.Songs = songModels
	}
	return result, nil
}

func (s *Service) updateAlbumMetadataFromPath(ctx context.Context, userID int, item *ent.Album, input MetadataWritebackInput) (models.MetadataWritebackResult, error) {
	result := newMetadataWritebackResult()
	groups := metadataWritebackFileGroups(item.Edges.Songs)
	if len(groups) == 0 {
		return result, nil
	}
	coverData, coverMime, err := s.metadataCoverData(ctx, input)
	if err != nil {
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			Path:    item.Title,
			Status:  "failed",
			Message: err.Error(),
		})
		return result, nil
	}
	coverVersion := time.Now().UnixNano()
	updatedSongIDs := []int{}
	updatedAlbumIDs := map[int]bool{}
	for _, group := range groups {
		pathMeta := metadataFromPath(group.Path, s.libraryDir)
		if pathMeta.Title == "" && len(group.Songs) == 1 {
			pathMeta.Title = group.Songs[0].Title
		}
		pathMeta.Album = firstString(pathMeta.Album, songAlbumTitle(firstSong(group.Songs)), item.Title)
		pathMeta.Artist = firstString(pathMeta.Artist, songArtistName(firstSong(group.Songs)), pathMeta.AlbumArtist, unknownArtistName)
		pathMeta.AlbumArtist = firstString(pathMeta.AlbumArtist, pathMeta.Artist, albumSearchArtistName(item))
		targetYear := input.Year
		if targetYear <= 0 {
			targetYear = firstSongYear(group.Songs)
		}
		pathMeta.Year = targetYear

		tags := taglibTagsForPathMetadata(pathMeta, group.CUETrackCount == 0)
		wavMeta := wavPatchForPathMetadata(pathMeta, group.CUETrackCount == 0)
		written, writeErr := writeAudioMetadata(group.Path, tags, wavMeta, coverData, coverMime)
		if writeErr != nil {
			addMetadataWritebackItem(&result, models.MetadataWritebackItem{
				Path:    group.Path,
				Status:  "failed",
				Message: writeErr.Error(),
			})
			continue
		}
		if !written {
			addMetadataWritebackItem(&result, models.MetadataWritebackItem{
				Path:    group.Path,
				Status:  "skipped",
				Message: "file metadata did not change",
			})
			continue
		}

		artistItem, err := s.ensureArtist(ctx, pathMeta.Artist)
		if err != nil {
			addMetadataWritebackItem(&result, models.MetadataWritebackItem{
				Path:    group.Path,
				Status:  "failed",
				Message: err.Error(),
			})
			continue
		}
		albumItem, err := s.ensureAlbum(ctx, pathMeta.Album, pathMeta.AlbumArtist, artistItem, targetYear)
		if err != nil {
			addMetadataWritebackItem(&result, models.MetadataWritebackItem{
				Path:    group.Path,
				Status:  "failed",
				Message: err.Error(),
			})
			continue
		}
		for _, songItem := range group.Songs {
			title := songItem.Title
			if group.CUETrackCount == 0 && pathMeta.Title != "" {
				title = pathMeta.Title
			}
			if err := s.updatePathAssistedSongRow(ctx, songItem, artistItem, albumItem, title, targetYear, group.Path); err != nil {
				addMetadataWritebackItem(&result, models.MetadataWritebackItem{
					SongID:  songItem.ID,
					Title:   songItem.Title,
					Path:    group.Path,
					Status:  "failed",
					Message: err.Error(),
				})
				continue
			}
			updatedSongIDs = append(updatedSongIDs, songItem.ID)
		}
		updatedAlbumIDs[albumItem.ID] = true
		if len(coverData) > 0 {
			_ = s.writeCollectionCoverCache("albums", strconv.Itoa(albumItem.ID), coverMime, coverData)
		}
		message := fmt.Sprintf("%s · %s", pathMeta.AlbumArtist, pathMeta.Album)
		if group.CUETrackCount > 0 {
			message = fmt.Sprintf("%s; %d CUE virtual tracks share this audio file", message, group.CUETrackCount)
		}
		addMetadataWritebackItem(&result, models.MetadataWritebackItem{
			Path:    group.Path,
			Status:  "updated",
			Message: message,
		})
	}
	if result.Updated == 0 {
		return result, nil
	}
	s.invalidateLibraryCache(ctx)
	s.invalidateSearchCatalogs(ctx)

	if len(updatedSongIDs) > 0 {
		songModels, err := s.songsForUserByIDs(ctx, userID, updatedSongIDs, coverVersion)
		if err != nil {
			return result, err
		}
		result.Songs = songModels
	}
	albumIDs := make([]int, 0, len(updatedAlbumIDs))
	for id := range updatedAlbumIDs {
		albumIDs = append(albumIDs, id)
	}
	sort.Ints(albumIDs)
	albumModels, err := s.albumsForUserByIDs(ctx, userID, albumIDs, coverVersion)
	if err != nil {
		return result, err
	}
	result.Albums = albumModels
	if len(albumModels) == 1 {
		result.Album = &albumModels[0]
	}
	return result, nil
}

func metadataCandidateScore(candidate models.MetadataCandidate, title, artistName string) int {
	score := 0
	if strings.EqualFold(strings.TrimSpace(candidate.Title), strings.TrimSpace(title)) {
		score += 8
	} else if strings.Contains(strings.ToLower(candidate.Title), strings.ToLower(title)) {
		score += 3
	}
	if artistName != "" {
		if strings.EqualFold(strings.TrimSpace(candidate.Artist), strings.TrimSpace(artistName)) {
			score += 6
		} else if strings.Contains(strings.ToLower(candidate.Artist), strings.ToLower(artistName)) {
			score += 2
		}
	}
	if strings.TrimSpace(candidate.Cover) != "" {
		score++
	}
	return score
}

func metadataPathCandidateFromSong(item *ent.Song, libraryRoot string) (models.MetadataCandidate, bool) {
	if item == nil || strings.TrimSpace(item.Path) == "" {
		return models.MetadataCandidate{}, false
	}
	parsed := parseFilenameMetadata(ActualAudioPath(item.Path), libraryRoot)
	if strings.TrimSpace(parsed.Title) == "" {
		return models.MetadataCandidate{}, false
	}
	return models.MetadataCandidate{
		Source: metadataPathCandidateSource,
		ID:     fmt.Sprintf("song-%d", item.ID),
		Title:  parsed.Title,
		Artist: parsed.Artist,
		Album:  parsed.Album,
	}, true
}

func metadataPathCandidateFromAlbum(item *ent.Album, libraryRoot string) (models.MetadataCandidate, bool) {
	if item == nil || len(item.Edges.Songs) == 0 {
		return models.MetadataCandidate{}, false
	}
	albumVotes := []string{}
	artistVotes := []string{}
	seenPaths := map[string]bool{}
	for _, songItem := range item.Edges.Songs {
		if songItem == nil || strings.TrimSpace(songItem.Path) == "" {
			continue
		}
		audioPath := ActualAudioPath(songItem.Path)
		if seenPaths[audioPath] {
			continue
		}
		seenPaths[audioPath] = true
		parsed := parseFilenameMetadata(audioPath, libraryRoot)
		folderAlbum, folderArtist := metadataPathAlbumAndArtistFromFolder(audioPath, libraryRoot)
		if folderAlbum != "" {
			albumVotes = append(albumVotes, folderAlbum)
		} else if parsed.Album != "" {
			albumVotes = append(albumVotes, parsed.Album)
		}
		if folderArtist != "" {
			artistVotes = append(artistVotes, folderArtist)
		} else if parsed.Artist != "" && !looksLikeTrackNumber(parsed.Artist) {
			artistVotes = append(artistVotes, parsed.Artist)
		}
	}
	title := mostCommonMetadataPathValue(albumVotes)
	artistName := mostCommonMetadataPathValue(artistVotes)
	if title == "" && artistName == "" {
		return models.MetadataCandidate{}, false
	}
	return models.MetadataCandidate{
		Source:     metadataPathCandidateSource,
		ID:         fmt.Sprintf("album-%d", item.ID),
		Title:      title,
		Artist:     artistName,
		PathGroups: len(metadataPathAlbumGroupsFromSongs(item.Edges.Songs, libraryRoot)),
		SongCount:  len(item.Edges.Songs),
	}, true
}

func metadataPathAlbumAndArtistFromFolder(path, libraryRoot string) (string, string) {
	if strings.TrimSpace(path) == "" || strings.TrimSpace(libraryRoot) == "" {
		return "", ""
	}
	root, err := filepath.Abs(libraryRoot)
	if err != nil {
		return "", ""
	}
	audioPath, err := filepath.Abs(path)
	if err != nil {
		return "", ""
	}
	parent := filepath.Dir(audioPath)
	if samePath(root, parent) {
		return "", ""
	}
	albumDir := parent
	albumName := cleanFilenameForMetadata(filepath.Base(albumDir))
	if looksLikeDiscFolderName(albumName) {
		albumDir = filepath.Dir(albumDir)
		albumName = cleanFilenameForMetadata(filepath.Base(albumDir))
	}
	if albumName == "" || samePath(root, albumDir) {
		return "", ""
	}
	artistDir := filepath.Dir(albumDir)
	artistName := ""
	if !samePath(root, artistDir) {
		if rel, err := filepath.Rel(root, artistDir); err == nil && rel != "." && !strings.HasPrefix(rel, "..") {
			artistName = cleanFilenameForMetadata(filepath.Base(artistDir))
		}
	}
	return albumName, artistName
}

func looksLikeDiscFolderName(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.NewReplacer(" ", "", "-", "", "_", "", ".", "").Replace(normalized)
	for _, prefix := range []string{"cd", "disc", "disk", "vol", "volume"} {
		if rest := strings.TrimPrefix(normalized, prefix); rest != normalized && rest != "" && looksLikeTrackNumber(rest) {
			return true
		}
	}
	return false
}

func mostCommonMetadataPathValue(values []string) string {
	type vote struct {
		value string
		count int
		first int
	}
	votes := map[string]vote{}
	for index, value := range values {
		value = cleanFilenameForMetadata(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		current, ok := votes[key]
		if !ok {
			votes[key] = vote{value: value, count: 1, first: index}
			continue
		}
		current.count++
		votes[key] = current
	}
	best := vote{first: len(values) + 1}
	for _, current := range votes {
		if current.count > best.count || (current.count == best.count && current.first < best.first) {
			best = current
		}
	}
	return best.value
}

type metadataPathAlbumGroup struct {
	Album       string
	AlbumArtist string
	Songs       []*ent.Song
}

func metadataPathAlbumGroupsFromSongs(items []*ent.Song, libraryRoot string) []metadataPathAlbumGroup {
	groupsByKey := map[string]*metadataPathAlbumGroup{}
	order := []string{}
	for _, songItem := range items {
		if songItem == nil || strings.TrimSpace(songItem.Path) == "" {
			continue
		}
		audioPath := ActualAudioPath(songItem.Path)
		pathMeta := metadataFromPath(audioPath, libraryRoot)
		albumTitle := firstString(pathMeta.Album, songAlbumTitle(songItem), "Unknown Album")
		albumArtist := firstString(pathMeta.AlbumArtist, songAlbumArtist(songItem), songArtistName(songItem), unknownArtistName)
		key := strings.ToLower(normalizeCompareText(albumArtist) + "\x00" + normalizeCompareText(albumTitle))
		group := groupsByKey[key]
		if group == nil {
			group = &metadataPathAlbumGroup{Album: albumTitle, AlbumArtist: albumArtist}
			groupsByKey[key] = group
			order = append(order, key)
		}
		group.Songs = append(group.Songs, songItem)
	}
	out := make([]metadataPathAlbumGroup, 0, len(order))
	for _, key := range order {
		out = append(out, *groupsByKey[key])
	}
	return out
}

func normalizeMetadataWritebackInput(input MetadataWritebackInput) MetadataWritebackInput {
	input.Title = strings.TrimSpace(input.Title)
	input.Artist = strings.TrimSpace(input.Artist)
	input.Album = strings.TrimSpace(input.Album)
	input.AlbumArtist = strings.TrimSpace(input.AlbumArtist)
	input.CoverURL = strings.TrimSpace(input.CoverURL)
	input.CoverMime = strings.TrimSpace(input.CoverMime)
	return input
}

func metadataWritebackHasChanges(input MetadataWritebackInput) bool {
	return input.Title != "" || input.Artist != "" || input.Album != "" || input.AlbumArtist != "" || input.Year > 0 || input.CoverURL != "" || len(input.CoverData) > 0
}

func taglibTagsForSong(input MetadataWritebackInput) map[string][]string {
	tags := map[string][]string{}
	if input.Title != "" {
		tags[taglib.Title] = []string{input.Title}
	}
	if input.Artist != "" {
		tags[taglib.Artist] = []string{input.Artist}
	}
	if input.Album != "" {
		tags[taglib.Album] = []string{input.Album}
	}
	if input.Year > 0 {
		tags[taglib.Date] = []string{strconv.Itoa(input.Year)}
	}
	return tags
}

func taglibTagsForAlbum(input MetadataWritebackInput, trackArtist string) map[string][]string {
	tags := map[string][]string{}
	if input.Title != "" {
		tags[taglib.Album] = []string{input.Title}
	}
	if trackArtist != "" {
		tags[taglib.Artist] = []string{trackArtist}
	}
	if input.AlbumArtist != "" {
		tags[taglib.AlbumArtist] = []string{input.AlbumArtist}
	}
	if input.Year > 0 {
		tags[taglib.Date] = []string{strconv.Itoa(input.Year)}
	}
	return tags
}

func albumTargetTrackArtistName(input MetadataWritebackInput, item *ent.Album) string {
	if input.Artist != "" {
		return input.Artist
	}
	if input.AlbumArtist == "" || !albumArtistMatchesEverySongArtist(item) {
		return ""
	}
	return input.AlbumArtist
}

func albumArtistMatchesEverySongArtist(item *ent.Album) bool {
	currentAlbumArtist := albumSearchArtistName(item)
	if currentAlbumArtist == "" || item == nil || len(item.Edges.Songs) == 0 {
		return false
	}
	for _, songItem := range item.Edges.Songs {
		if !sameMetadataArtistName(songArtistName(songItem), currentAlbumArtist) {
			return false
		}
	}
	return true
}

func sameMetadataArtistName(a, b string) bool {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	return a != "" && b != "" && strings.EqualFold(normalizeCompareText(a), normalizeCompareText(b))
}

func wavPatchForSong(input MetadataWritebackInput) fileMetadata {
	return fileMetadata{Title: input.Title, Artist: input.Artist, Album: input.Album, Year: input.Year}
}

func wavPatchForAlbum(input MetadataWritebackInput, trackArtist string) fileMetadata {
	return fileMetadata{Artist: trackArtist, Album: input.Title, Year: input.Year}
}

func taglibTagsForPathMetadata(meta fileMetadata, includeTitle bool) map[string][]string {
	tags := map[string][]string{}
	if includeTitle && meta.Title != "" {
		tags[taglib.Title] = []string{meta.Title}
	}
	if meta.Artist != "" {
		tags[taglib.Artist] = []string{meta.Artist}
	}
	if meta.Album != "" {
		tags[taglib.Album] = []string{meta.Album}
	}
	if meta.AlbumArtist != "" {
		tags[taglib.AlbumArtist] = []string{meta.AlbumArtist}
	}
	if meta.Year > 0 {
		tags[taglib.Date] = []string{strconv.Itoa(meta.Year)}
	}
	return tags
}

func wavPatchForPathMetadata(meta fileMetadata, includeTitle bool) fileMetadata {
	patch := fileMetadata{Artist: meta.Artist, Album: meta.Album, Year: meta.Year}
	if includeTitle {
		patch.Title = meta.Title
	}
	return patch
}

func writeAudioMetadata(path string, tags map[string][]string, wavPatch fileMetadata, coverData []byte, coverMime string) (bool, error) {
	written := false
	if len(tags) > 0 {
		if isWAVMetadataPath(path) {
			ok, err := writeMergedWAVInfoMetadata(path, wavPatch)
			if err != nil {
				return false, err
			}
			written = written || ok
		} else {
			if err := taglib.WriteTags(path, tags, 0); err != nil {
				return false, err
			}
			written = true
		}
	}
	if len(coverData) > 0 {
		if err := taglib.WriteImageOptions(path, coverData, 0, "Front Cover", "Updated by Lark", coverMime); err != nil {
			return false, err
		}
		written = true
	}
	return written, nil
}

func isWAVMetadataPath(path string) bool {
	return strings.EqualFold(strings.TrimPrefix(filepath.Ext(path), "."), "wav")
}

func writeMergedWAVInfoMetadata(path string, patch fileMetadata) (bool, error) {
	meta := probeWAVMetadata(path)
	if patch.Title != "" {
		meta.Title = patch.Title
	}
	if patch.Artist != "" {
		meta.Artist = patch.Artist
	}
	if patch.Album != "" {
		meta.Album = patch.Album
	}
	if patch.Year > 0 {
		meta.Year = patch.Year
	}
	return writeWAVInfoMetadata(path, meta)
}

func (s *Service) metadataCoverData(ctx context.Context, input MetadataWritebackInput) ([]byte, string, error) {
	if len(input.CoverData) > 0 {
		if len(input.CoverData) > metadataCoverMaxBytes {
			return nil, "", fmt.Errorf("cover image exceeds %d MB", metadataCoverMaxBytes>>20)
		}
		mimeType, ok := detectWritebackCoverMime(input.CoverData, input.CoverMime)
		if !ok {
			return nil, "", fmt.Errorf("cover image must be JPEG, PNG, WebP, GIF or BMP")
		}
		return input.CoverData, mimeType, nil
	}
	if input.CoverURL == "" {
		return nil, "", nil
	}
	return downloadMetadataCover(ctx, input.CoverURL)
}

func downloadMetadataCover(ctx context.Context, rawURL string) ([]byte, string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed == nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, "", fmt.Errorf("cover url must be http or https")
	}
	downloadCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(downloadCtx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 Lark Music Player")
	res, err := coverHTTPClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, "", fmt.Errorf("cover url returned status %d", res.StatusCode)
	}
	if res.ContentLength > metadataCoverMaxBytes {
		return nil, "", fmt.Errorf("cover image exceeds %d MB", metadataCoverMaxBytes>>20)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, metadataCoverMaxBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > metadataCoverMaxBytes {
		return nil, "", fmt.Errorf("cover image exceeds %d MB", metadataCoverMaxBytes>>20)
	}
	if len(data) == 0 {
		return nil, "", fmt.Errorf("cover image is empty")
	}
	mimeType, ok := detectWritebackCoverMime(data, res.Header.Get("Content-Type"))
	if !ok {
		return nil, "", fmt.Errorf("cover image must be JPEG, PNG, WebP, GIF or BMP")
	}
	return data, mimeType, nil
}

func detectWritebackCoverMime(data []byte, hinted string) (string, bool) {
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(hinted, ";")[0]))
	if mimeType == "" || !isSupportedWritebackCoverMime(mimeType) {
		mimeType = detectWritebackCoverMimeByMagic(data)
	}
	if mimeType == "" {
		mimeType = strings.ToLower(http.DetectContentType(data))
	}
	if mimeType == "image/jpg" {
		mimeType = "image/jpeg"
	}
	if isSupportedWritebackCoverMime(mimeType) {
		return mimeType, true
	}
	if ext := strings.ToLower(mime.TypeByExtension(filepath.Ext(hinted))); isSupportedWritebackCoverMime(ext) {
		return ext, true
	}
	return "", false
}

func detectWritebackCoverMimeByMagic(data []byte) string {
	switch {
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "image/jpeg"
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return "image/png"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp"
	case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		return "image/gif"
	case len(data) >= 2 && string(data[:2]) == "BM":
		return "image/bmp"
	default:
		return ""
	}
}

func isSupportedWritebackCoverMime(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp":
		return true
	default:
		return false
	}
}

func (s *Service) updateSongRowAfterWriteback(ctx context.Context, item *ent.Song, input MetadataWritebackInput, audioPath string) (*ent.Song, error) {
	title := firstString(input.Title, item.Title)
	artistName := input.Artist
	if artistName == "" && item.Edges.Artist != nil {
		artistName = item.Edges.Artist.Name
	}
	albumTitle := input.Album
	if albumTitle == "" && item.Edges.Album != nil {
		albumTitle = item.Edges.Album.Title
	}
	year := input.Year
	if year <= 0 {
		year = item.Year
	}
	artistItem, err := s.ensureArtist(ctx, artistName)
	if err != nil {
		return nil, err
	}
	albumArtist := ""
	if item.Edges.Album != nil {
		albumArtist = item.Edges.Album.AlbumArtist
	}
	albumItem, err := s.ensureAlbum(ctx, albumTitle, albumArtist, artistItem, year)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(audioPath)
	if err != nil {
		return nil, err
	}
	if _, err := item.Update().
		SetTitle(title).
		SetYear(year).
		SetSizeBytes(info.Size()).
		SetModTimeUnixNano(info.ModTime().UnixNano()).
		SetArtist(artistItem).
		SetAlbum(albumItem).
		Save(ctx); err != nil {
		return nil, err
	}
	return s.client.Song.Query().Where(song.ID(item.ID)).WithArtist().WithAlbum().Only(ctx)
}

func (s *Service) updateAlbumSongRowAfterWriteback(ctx context.Context, item *ent.Song, targetArtist *ent.Artist, targetAlbum *ent.Album, year int, audioPath string) error {
	info, err := os.Stat(audioPath)
	if err != nil {
		return err
	}
	update := item.Update().
		SetSizeBytes(info.Size()).
		SetModTimeUnixNano(info.ModTime().UnixNano()).
		SetAlbum(targetAlbum)
	if targetArtist != nil {
		update.SetArtist(targetArtist)
	}
	if year > 0 {
		update.SetYear(year)
	}
	_, err = update.Save(ctx)
	return err
}

func (s *Service) updatePathAssistedSongRow(ctx context.Context, item *ent.Song, artistItem *ent.Artist, albumItem *ent.Album, title string, year int, audioPath string) error {
	info, err := os.Stat(audioPath)
	if err != nil {
		return err
	}
	update := item.Update().
		SetTitle(firstString(title, item.Title)).
		SetSizeBytes(info.Size()).
		SetModTimeUnixNano(info.ModTime().UnixNano()).
		SetArtist(artistItem).
		SetAlbum(albumItem)
	if year > 0 {
		update.SetYear(year)
	}
	_, err = update.Save(ctx)
	return err
}

func (s *Service) albumModelForUser(ctx context.Context, userID, id int, coverVersion int64) (models.Album, error) {
	item, err := s.client.Album.Query().Where(album.ID(id)).WithArtist().WithSongs().Only(ctx)
	if err != nil {
		return models.Album{}, err
	}
	counts, err := s.albumSongCountsForIDs(ctx, []int{id})
	if err != nil {
		return models.Album{}, err
	}
	items, err := s.applyAlbumUserState(ctx, userID, []models.Album{mapAlbumWithCount(item, counts[id])})
	if err != nil {
		return models.Album{}, err
	}
	items[0].CoverVersion = coverVersion
	return items[0], nil
}

func (s *Service) albumsForUserByIDs(ctx context.Context, userID int, ids []int, coverVersion int64) ([]models.Album, error) {
	if len(ids) == 0 {
		return []models.Album{}, nil
	}
	items, err := s.client.Album.Query().
		Where(album.IDIn(ids...)).
		WithArtist().
		WithSongs().
		Order(ent.Asc(album.FieldID)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	counts, err := s.albumSongCountsForIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]models.Album, 0, len(items))
	for _, item := range items {
		out = append(out, mapAlbumWithCount(item, counts[item.ID]))
	}
	out, err = s.applyAlbumUserState(ctx, userID, out)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].CoverVersion = coverVersion
	}
	return out, nil
}

func (s *Service) songsForUserByIDs(ctx context.Context, userID int, ids []int, coverVersion int64) ([]models.Song, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	items, err := s.client.Song.Query().
		Where(song.IDIn(ids...)).
		WithArtist().
		WithAlbum().
		Order(ent.Asc(song.FieldID)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.applySongUserState(ctx, userID, mapSongs(items))
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].CoverVersion = coverVersion
	}
	return out, nil
}

func firstSong(items []*ent.Song) *ent.Song {
	for _, item := range items {
		if item != nil {
			return item
		}
	}
	return nil
}

func songArtistName(item *ent.Song) string {
	if item == nil || item.Edges.Artist == nil {
		return ""
	}
	return strings.TrimSpace(item.Edges.Artist.Name)
}

func songAlbumTitle(item *ent.Song) string {
	if item == nil || item.Edges.Album == nil {
		return ""
	}
	return strings.TrimSpace(item.Edges.Album.Title)
}

func songAlbumArtist(item *ent.Song) string {
	if item == nil || item.Edges.Album == nil {
		return ""
	}
	return strings.TrimSpace(item.Edges.Album.AlbumArtist)
}

func firstSongYear(items []*ent.Song) int {
	for _, item := range items {
		if item != nil && item.Year > 0 {
			return item.Year
		}
	}
	return 0
}

type metadataWritebackFileGroup struct {
	Path          string
	Songs         []*ent.Song
	CUETrackCount int
}

func metadataWritebackFileGroups(items []*ent.Song) []metadataWritebackFileGroup {
	byPath := map[string]*metadataWritebackFileGroup{}
	order := []string{}
	for _, item := range items {
		if item == nil {
			continue
		}
		segment := ResolveAudioSegment(item.Path)
		path, err := filepath.Abs(segment.Path)
		if err != nil {
			path = segment.Path
		}
		group := byPath[path]
		if group == nil {
			group = &metadataWritebackFileGroup{Path: path}
			byPath[path] = group
			order = append(order, path)
		}
		group.Songs = append(group.Songs, item)
		if segment.IsCUETrack {
			group.CUETrackCount++
		}
	}
	out := make([]metadataWritebackFileGroup, 0, len(order))
	for _, path := range order {
		out = append(out, *byPath[path])
	}
	return out
}

func addMetadataWritebackItem(result *models.MetadataWritebackResult, item models.MetadataWritebackItem) {
	result.Items = append(result.Items, item)
	switch item.Status {
	case "updated":
		result.Updated++
	case "skipped":
		result.Skipped++
	case "failed":
		result.Failed++
	}
}

func newMetadataWritebackResult() models.MetadataWritebackResult {
	return models.MetadataWritebackResult{Items: []models.MetadataWritebackItem{}}
}
