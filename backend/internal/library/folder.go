package library

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"lark/backend/ent"
	"lark/backend/ent/predicate"
	"lark/backend/ent/song"
	"lark/backend/internal/models"
)

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
		Select(browseSongColumns...).
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
