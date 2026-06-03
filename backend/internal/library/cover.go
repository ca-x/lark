package library

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/dhowden/tag"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/artist"
	"lark/backend/ent/song"
)

func (s *Service) SongCover(ctx context.Context, id int) ([]byte, string, error) {
	item, err := s.client.Song.Get(ctx, id)
	if err != nil {
		return nil, "", err
	}
	return s.cachedEmbeddedCover(item)
}
func (s *Service) AlbumCover(ctx context.Context, id int) ([]byte, string, error) {
	if data, mimeType, ok, err := s.readCollectionCoverCache("albums", strconv.Itoa(id)); err != nil || ok {
		return data, mimeType, err
	}
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
		if len(data) > 0 {
			_ = s.writeCollectionCoverCache("albums", strconv.Itoa(id), mimeType, data)
		}
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
		data, mimeType, err := s.cachedRemoteImage(ctx, "album", strconv.Itoa(id), info.Cover)
		if err != nil || len(data) > 0 {
			if len(data) > 0 {
				_ = s.writeCollectionCoverCache("albums", strconv.Itoa(id), mimeType, data)
			}
			return data, mimeType, err
		}
	}
	_ = s.writeCollectionCoverMiss("albums", strconv.Itoa(id))
	return nil, "", nil
}
func (s *Service) ArtistCover(ctx context.Context, id int) ([]byte, string, error) {
	if data, mimeType, ok, err := s.readCollectionCoverCache("artists", strconv.Itoa(id)); err != nil || ok {
		return data, mimeType, err
	}
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
		if len(data) > 0 {
			_ = s.writeCollectionCoverCache("artists", strconv.Itoa(id), mimeType, data)
		}
		return data, mimeType, err
	}
	a, err := s.client.Artist.Query().Where(artist.ID(id)).WithAlbums(func(q *ent.AlbumQuery) {
		// Cap to a few recent albums: the cold path does an online search PER album
		// (each up to 12s). Limiting to 3 + an overall deadline keeps a first artist
		// load bounded instead of stalling on up to 20 sequential remote searches.
		q.Where(album.HasSongs()).Order(ent.Desc(album.FieldUpdatedAt)).Limit(3)
	}).Only(ctx)
	if err != nil {
		return nil, "", err
	}
	searchCtx, cancelSearch := context.WithTimeout(ctx, 8*time.Second)
	defer cancelSearch()
	for _, candidate := range a.Edges.Albums {
		if searchCtx.Err() != nil {
			break
		}
		infoItems := s.searchRemoteAlbums(searchCtx, candidate.Title, firstString(candidate.AlbumArtist, a.Name))
		for _, info := range infoItems {
			if strings.TrimSpace(info.Cover) == "" {
				continue
			}
			data, mimeType, err := s.cachedRemoteImage(searchCtx, "artist", strconv.Itoa(id), info.Cover)
			if err != nil || len(data) > 0 {
				if len(data) > 0 {
					_ = s.writeCollectionCoverCache("artists", strconv.Itoa(id), mimeType, data)
				}
				return data, mimeType, err
			}
		}
	}
	_ = s.writeCollectionCoverMiss("artists", strconv.Itoa(id))
	return nil, "", nil
}
func (s *Service) readCollectionCoverCache(kind, key string) ([]byte, string, bool, error) {
	cacheDir := s.collectionCoverCacheDir(kind)
	safeKey := collectionCoverCacheKey(key)
	missPath := filepath.Join(cacheDir, safeKey+".miss")
	if info, err := os.Stat(missPath); err == nil {
		if time.Since(info.ModTime()) < collectionCoverMissTTL {
			return nil, "", true, nil
		}
		_ = os.Remove(missPath)
	}
	for _, ext := range []string{".jpg", ".png", ".webp", ".bin"} {
		path := filepath.Join(cacheDir, safeKey+ext)
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		if time.Since(info.ModTime()) > collectionCoverHitTTL {
			_ = os.Remove(path)
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, "", false, err
		}
		if len(data) > 0 {
			return data, coverMimeByExt(ext), true, nil
		}
	}
	return nil, "", false, nil
}
func (s *Service) writeCollectionCoverCache(kind, key, mimeType string, data []byte) error {
	if len(data) == 0 {
		return s.writeCollectionCoverMiss(kind, key)
	}
	cacheDir := s.collectionCoverCacheDir(kind)
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return err
	}
	safeKey := collectionCoverCacheKey(key)
	for _, ext := range []string{".jpg", ".png", ".webp", ".bin", ".miss"} {
		_ = os.Remove(filepath.Join(cacheDir, safeKey+ext))
	}
	return os.WriteFile(filepath.Join(cacheDir, safeKey+coverExtByMime(mimeType)), data, 0o644)
}
func (s *Service) writeCollectionCoverMiss(kind, key string) error {
	cacheDir := s.collectionCoverCacheDir(kind)
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return err
	}
	safeKey := collectionCoverCacheKey(key)
	for _, ext := range []string{".jpg", ".png", ".webp", ".bin"} {
		_ = os.Remove(filepath.Join(cacheDir, safeKey+ext))
	}
	return os.WriteFile(filepath.Join(cacheDir, safeKey+".miss"), []byte(time.Now().Format(time.RFC3339Nano)), 0o644)
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
