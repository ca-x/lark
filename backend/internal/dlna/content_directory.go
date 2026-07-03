package dlna

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"lark/backend/internal/models"
)

const dlnaLibraryUserID = 0

func (s *Service) Browse(ctx context.Context, objectID string, flag string, start, count int, host string) (BrowseResult, error) {
	if !s.options.LibraryEnabled {
		return BrowseResult{}, ErrDisabled
	}
	objectID = strings.TrimSpace(objectID)
	if objectID == "" {
		objectID = "0"
	}
	flag = strings.TrimSpace(flag)
	if flag == "" {
		flag = "BrowseDirectChildren"
	}
	if count <= 0 {
		count = 100
	}
	if count > 500 {
		count = 500
	}
	if start < 0 {
		start = 0
	}
	base := baseURLFromHost(host)
	if flag == "BrowseMetadata" {
		return s.browseMetadata(ctx, objectID, base)
	}
	switch objectID {
	case "0":
		return containersResult(rootContainers()), nil
	case "songs":
		page, err := s.lib.SongsPage(ctx, dlnaLibraryUserID, "", false, count, start)
		if err != nil {
			return BrowseResult{}, err
		}
		return s.songItemsResult(page.Items, page.Total, base)
	case "albums":
		page, err := s.lib.AlbumsPage(ctx, dlnaLibraryUserID, count, start, 0)
		if err != nil {
			return BrowseResult{}, err
		}
		items := make([]Container, 0, len(page.Items))
		for _, album := range page.Items {
			items = append(items, Container{ID: fmt.Sprintf("album:%d", album.ID), ParentID: "albums", Title: album.Title, Class: "object.container.album.musicAlbum", ChildCount: album.SongCount})
		}
		result := containersResult(items)
		result.TotalMatches = page.Total
		return result, nil
	case "artists":
		artists, err := s.lib.Artists(ctx, dlnaLibraryUserID, count)
		if err != nil {
			return BrowseResult{}, err
		}
		items := make([]Container, 0, len(artists))
		for _, artist := range artists {
			items = append(items, Container{ID: fmt.Sprintf("artist:%d", artist.ID), ParentID: "artists", Title: artist.Name, Class: "object.container.person.musicArtist", ChildCount: artist.SongCount})
		}
		return containersResult(items), nil
	case "playlists":
		playlists, err := s.lib.Playlists(ctx, dlnaLibraryUserID, count)
		if err != nil {
			return BrowseResult{}, err
		}
		items := make([]Container, 0, len(playlists))
		for _, playlist := range playlists {
			items = append(items, Container{ID: fmt.Sprintf("playlist:%d", playlist.ID), ParentID: "playlists", Title: playlist.Name, Class: "object.container.playlistContainer", ChildCount: playlist.SongCount})
		}
		return containersResult(items), nil
	case "folders":
		folders, err := s.lib.Folders(ctx, dlnaLibraryUserID, count)
		if err != nil {
			return BrowseResult{}, err
		}
		items := make([]Container, 0, len(folders))
		for _, folder := range folders {
			items = append(items, Container{ID: "folder:" + url.QueryEscape(folder.Path), ParentID: "folders", Title: folder.Name, Class: "object.container.storageFolder", ChildCount: folder.SongCount})
		}
		return containersResult(items), nil
	default:
		return s.browseObjectChildren(ctx, objectID, count, base)
	}
}

func (s *Service) browseMetadata(ctx context.Context, objectID string, base string) (BrowseResult, error) {
	switch {
	case objectID == "0":
		return containersResult([]Container{{ID: "0", ParentID: "-1", Title: defaultString(s.options.ServerName, "Lark"), Class: "object.container.storageFolder", ChildCount: len(rootContainers())}}), nil
	case objectID == "songs" || objectID == "albums" || objectID == "artists" || objectID == "playlists" || objectID == "folders":
		for _, item := range rootContainers() {
			if item.ID == objectID {
				return containersResult([]Container{item}), nil
			}
		}
	case strings.HasPrefix(objectID, "song:"):
		id, err := strconv.Atoi(strings.TrimPrefix(objectID, "song:"))
		if err != nil {
			return BrowseResult{}, err
		}
		song, err := s.lib.Song(ctx, dlnaLibraryUserID, id)
		if err != nil {
			return BrowseResult{}, err
		}
		return s.songItemsResult([]models.Song{song}, 1, base)
	}
	return BrowseResult{}, fmt.Errorf("object not found")
}

func (s *Service) browseObjectChildren(ctx context.Context, objectID string, count int, base string) (BrowseResult, error) {
	switch {
	case strings.HasPrefix(objectID, "album:"):
		id, err := strconv.Atoi(strings.TrimPrefix(objectID, "album:"))
		if err != nil {
			return BrowseResult{}, err
		}
		songs, err := s.lib.AlbumSongs(ctx, dlnaLibraryUserID, id, count)
		if err != nil {
			return BrowseResult{}, err
		}
		return s.songItemsResult(songs, len(songs), base)
	case strings.HasPrefix(objectID, "artist:"):
		id, err := strconv.Atoi(strings.TrimPrefix(objectID, "artist:"))
		if err != nil {
			return BrowseResult{}, err
		}
		songs, err := s.lib.ArtistSongs(ctx, dlnaLibraryUserID, id, count)
		if err != nil {
			return BrowseResult{}, err
		}
		return s.songItemsResult(songs, len(songs), base)
	case strings.HasPrefix(objectID, "playlist:"):
		id, err := strconv.Atoi(strings.TrimPrefix(objectID, "playlist:"))
		if err != nil {
			return BrowseResult{}, err
		}
		songs, err := s.lib.PlaylistSongs(ctx, dlnaLibraryUserID, id, count)
		if err != nil {
			return BrowseResult{}, err
		}
		return s.songItemsResult(songs, len(songs), base)
	case strings.HasPrefix(objectID, "folder:"):
		rel, err := url.QueryUnescape(strings.TrimPrefix(objectID, "folder:"))
		if err != nil {
			return BrowseResult{}, err
		}
		songs, err := s.lib.FolderSongs(ctx, dlnaLibraryUserID, rel, count)
		if err != nil {
			return BrowseResult{}, err
		}
		return s.songItemsResult(songs, len(songs), base)
	default:
		return BrowseResult{}, fmt.Errorf("object not found")
	}
}

func (s *Service) songItemsResult(items []models.Song, total int, base string) (BrowseResult, error) {
	didl, err := SongsDIDL(items, func(item models.Song) MediaResource {
		audioURL, _ := s.AudioURL(base, dlnaLibraryUserID, item.ID, libraryMediaTokenTTL)
		coverURL, _ := s.CoverURL(base, dlnaLibraryUserID, item.ID, libraryMediaTokenTTL)
		return MediaResource{
			AudioURL: audioURL,
			CoverURL: coverURL,
			Mime:     firstNonEmpty(item.Mime, mimeFromFormat(item.Format)),
			Size:     item.SizeBytes,
			BitRate:  item.BitRate,
			Duration: time.Duration(item.DurationSeconds * float64(time.Second)),
		}
	})
	if err != nil {
		return BrowseResult{}, err
	}
	return BrowseResult{Result: didl, NumberReturned: len(items), TotalMatches: total, UpdateID: 0}, nil
}

func containersResult(items []Container) BrowseResult {
	didl, err := BuildContainerDIDL(items)
	if err != nil {
		return BrowseResult{Result: ""}
	}
	return BrowseResult{Result: didl, NumberReturned: len(items), TotalMatches: len(items), UpdateID: 0}
}

func rootContainers() []Container {
	return []Container{
		{ID: "songs", ParentID: "0", Title: "All Songs", Class: "object.container.storageFolder"},
		{ID: "albums", ParentID: "0", Title: "Albums", Class: "object.container.storageFolder"},
		{ID: "artists", ParentID: "0", Title: "Artists", Class: "object.container.storageFolder"},
		{ID: "playlists", ParentID: "0", Title: "Playlists", Class: "object.container.storageFolder"},
		{ID: "folders", ParentID: "0", Title: "Folders", Class: "object.container.storageFolder"},
	}
}

func baseURLFromHost(host string) string {
	host = strings.TrimRight(strings.TrimSpace(host), "/")
	if host == "" {
		return ""
	}
	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		return host
	}
	return "http://" + host
}
