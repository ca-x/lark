package larkhost

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"lark/backend/ent/playlist"
	"lark/backend/ent/song"
	"lark/backend/ent/user"
	"lark/backend/ent/usersongfavorite"
	pluginhost "lark/backend/internal/plugin/host"
)

const PlaylistIDOffset = 1_000_000_000
const maxSafePlaylistID = 9_007_199_254_740_991

var ErrInvalidPlaylistID = errors.New("invalid or legacy Songloft playlist ID; reload the plugin playlist list and select it again")

func NativePlaylistID(id int) (int, error) {
	if id <= PlaylistIDOffset || id > maxSafePlaylistID {
		return 0, ErrInvalidPlaylistID
	}
	return id - PlaylistIDOffset, nil
}

type compatibilityPlaylists struct {
	host *Host
	raw  *playlistHost
}

func (h *compatibilityPlaylists) nativeID(ctx context.Context, id int) (int, error) {
	nativeID, err := NativePlaylistID(id)
	if err != nil {
		return 0, err
	}
	ambiguous, err := h.host.client.Playlist.Query().Where(playlist.IDEQ(id)).Exist(ctx)
	if err != nil {
		return 0, err
	}
	if ambiguous {
		return 0, ErrInvalidPlaylistID
	}
	return nativeID, nil
}

func builtinFavorites() pluginhost.Playlist {
	return pluginhost.Playlist{ID: 1, Type: "normal", Name: "收藏", Labels: []string{"built_in"}}
}

func compatibilityPlaylist(item pluginhost.Playlist) (pluginhost.Playlist, error) {
	if item.ID <= 0 || item.ID > maxSafePlaylistID-PlaylistIDOffset {
		return pluginhost.Playlist{}, ErrInvalidPlaylistID
	}
	item.ID += PlaylistIDOffset
	return item, nil
}

func (h *compatibilityPlaylists) List(ctx context.Context) ([]pluginhost.Playlist, error) {
	items, err := h.raw.List(ctx)
	if err != nil {
		return nil, err
	}
	result := []pluginhost.Playlist{builtinFavorites()}
	for _, item := range items {
		mapped, err := compatibilityPlaylist(item)
		if err != nil {
			return nil, err
		}
		result = append(result, mapped)
	}
	return result, nil
}

func (h *compatibilityPlaylists) Get(ctx context.Context, id int) (pluginhost.Playlist, error) {
	if id == 1 {
		if _, err := h.host.userID(ctx); err != nil {
			return pluginhost.Playlist{}, err
		}
		return builtinFavorites(), nil
	}
	nativeID, err := h.nativeID(ctx, id)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	item, err := h.raw.Get(ctx, nativeID)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	return compatibilityPlaylist(item)
}

func (h *compatibilityPlaylists) Songs(ctx context.Context, id int, query pluginhost.PlaylistSongQuery) ([]pluginhost.Song, error) {
	if id != 1 {
		nativeID, err := h.nativeID(ctx, id)
		if err != nil {
			return nil, err
		}
		return h.raw.Songs(ctx, nativeID, query)
	}
	userID, err := h.host.userID(ctx)
	if err != nil {
		return nil, err
	}
	favorites := h.host.client.Song.Query().Where(song.HasUserFavoritesWith(usersongfavorite.HasUserWith(user.ID(userID)))).WithArtist().WithAlbum().Order(song.ByID()).Offset(max(query.Offset, 0))
	if query.Limit > 0 {
		favorites.Limit(query.Limit)
	}
	items, err := favorites.All(ctx)
	if err != nil {
		return nil, err
	}
	return mapEntSongs(items), nil
}

func (h *compatibilityPlaylists) Search(ctx context.Context, term string, page pluginhost.Page) ([]pluginhost.Playlist, error) {
	items, err := h.List(ctx)
	if err != nil {
		return nil, err
	}
	term = strings.ToLower(strings.TrimSpace(term))
	filtered := make([]pluginhost.Playlist, 0, len(items))
	for _, item := range items {
		if strings.Contains(strings.ToLower(item.Name), term) || strings.Contains(strings.ToLower(item.Description), term) {
			filtered = append(filtered, item)
		}
	}
	start := min(max(page.Offset, 0), len(filtered))
	end := len(filtered)
	if page.Limit > 0 {
		end = min(end, start+page.Limit)
	}
	return filtered[start:end], nil
}

func (h *compatibilityPlaylists) Create(ctx context.Context, input pluginhost.PlaylistCreate) (pluginhost.Playlist, error) {
	item, err := h.raw.Create(ctx, input)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	return compatibilityPlaylist(item)
}

func (h *compatibilityPlaylists) Update(ctx context.Context, id int, input pluginhost.PlaylistUpdate) (pluginhost.Playlist, error) {
	if id == 1 {
		return pluginhost.Playlist{}, pluginhost.CapabilityUnavailable("rename built-in favorites")
	}
	nativeID, err := h.nativeID(ctx, id)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	item, err := h.raw.Update(ctx, nativeID, input)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	return compatibilityPlaylist(item)
}

func (h *compatibilityPlaylists) Delete(ctx context.Context, id int) error {
	if id == 1 {
		return pluginhost.CapabilityUnavailable("delete built-in favorites")
	}
	nativeID, err := h.nativeID(ctx, id)
	if err != nil {
		return err
	}
	return h.raw.Delete(ctx, nativeID)
}

func (h *compatibilityPlaylists) AddSongs(ctx context.Context, id int, songIDs []int) (pluginhost.AddSongsResult, error) {
	if id != 1 {
		nativeID, err := h.nativeID(ctx, id)
		if err != nil {
			return pluginhost.AddSongsResult{}, err
		}
		return h.raw.AddSongs(ctx, nativeID, songIDs)
	}
	return h.setFavorites(ctx, songIDs, true)
}

func (h *compatibilityPlaylists) RemoveSongs(ctx context.Context, id int, songIDs []int) error {
	if id == 1 {
		_, err := h.setFavorites(ctx, songIDs, false)
		return err
	}
	nativeID, err := h.nativeID(ctx, id)
	if err != nil {
		return err
	}
	return h.raw.RemoveSongs(ctx, nativeID, songIDs)
}

func (h *compatibilityPlaylists) Reorder(ctx context.Context, id int, songIDs []int) error {
	if id == 1 {
		return pluginhost.CapabilityUnavailable("reorder built-in favorites")
	}
	nativeID, err := h.nativeID(ctx, id)
	if err != nil {
		return err
	}
	return h.raw.Reorder(ctx, nativeID, songIDs)
}

func (h *compatibilityPlaylists) setFavorites(ctx context.Context, songIDs []int, enabled bool) (pluginhost.AddSongsResult, error) {
	userID, err := h.host.userID(ctx)
	if err != nil {
		return pluginhost.AddSongsResult{}, err
	}
	for _, songID := range songIDs {
		if songID <= 0 {
			return pluginhost.AddSongsResult{}, fmt.Errorf("song ID must be positive")
		}
		if _, err := h.host.client.Song.Get(ctx, songID); err != nil {
			return pluginhost.AddSongsResult{}, err
		}
	}
	result := pluginhost.AddSongsResult{}
	for _, songID := range songIDs {
		current, err := h.host.library.Song(ctx, userID, songID)
		if err != nil {
			return result, err
		}
		if current.Favorite == enabled {
			result.Skipped++
			continue
		}
		if _, err := h.host.library.SetSongFavorite(ctx, userID, songID, enabled); err != nil {
			return result, err
		}
		result.Added++
	}
	return result, nil
}
