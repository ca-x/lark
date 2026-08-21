package larkhost

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/playlist"
	"lark/backend/ent/playlistsongposition"
	"lark/backend/ent/song"
	"lark/backend/ent/user"
	"lark/backend/internal/library"
	"lark/backend/internal/models"
	pluginhost "lark/backend/internal/plugin/host"
)

type Config struct {
	UserID   int
	DataDir  string
	MusicDir string
	HostURL  string
}

// Host maps the SongLoft plugin contract to the capabilities Lark actually
// exposes. Unsupported operations return host_capability_unavailable instead
// of pretending that a write succeeded.
type Host struct {
	client    *ent.Client
	library   *library.Service
	config    Config
	commandMu sync.Mutex
	processes map[string]*managedProcess
}

func New(client *ent.Client, service *library.Service, config Config) *Host {
	return &Host{client: client, library: service, config: config, processes: make(map[string]*managedProcess)}
}

func (h *Host) userID(ctx context.Context) (int, error) {
	if h.config.UserID > 0 {
		return h.config.UserID, nil
	}
	id, err := h.client.User.Query().Where(user.RoleEQ("admin")).Order(ent.Asc(user.FieldID)).FirstID(ctx)
	if ent.IsNotFound(err) {
		return 0, pluginhost.CapabilityUnavailable("plugin user context")
	}
	return id, err
}

func (h *Host) Songs() pluginhost.SongHost         { return (*songHost)(h) }
func (h *Host) Playlists() pluginhost.PlaylistHost { return (*playlistHost)(h) }
func (h *Host) Storage() pluginhost.StorageHost    { return nil }
func (h *Host) Files() pluginhost.FileHost         { return (*fileHost)(h) }
func (h *Host) Commands() pluginhost.CommandHost   { return (*commandHost)(h) }
func (h *Host) Network() pluginhost.NetworkHost    { return (*networkHost)(h) }
func (h *Host) Auth() pluginhost.AuthHost          { return (*authHost)(h) }
func (h *Host) Events() pluginhost.EventHost       { return nil }

type songHost Host

func (h *songHost) List(ctx context.Context, query pluginhost.SongQuery) ([]pluginhost.Song, error) {
	return h.list(ctx, query)
}

func (h *songHost) Search(ctx context.Context, query pluginhost.SongQuery) ([]pluginhost.Song, error) {
	return h.list(ctx, query)
}

func (h *songHost) list(ctx context.Context, query pluginhost.SongQuery) ([]pluginhost.Song, error) {
	databaseQuery := h.client.Song.Query().WithArtist().WithAlbum()
	if term := strings.TrimSpace(query.Query); term != "" {
		databaseQuery.Where(song.Or(
			song.TitleContainsFold(term), song.SourceArtistContainsFold(term), song.SourceAlbumContainsFold(term),
		))
	}
	if query.PathPrefix != "" {
		databaseQuery.Where(song.PathHasPrefix(query.PathPrefix))
	}
	if query.Type != "" {
		databaseQuery.Where(song.SourceTypeEQ(query.Type))
	}
	descending := !strings.EqualFold(query.Order, "asc")
	field := song.FieldCreatedAt
	switch query.OrderBy {
	case "id":
		field = song.FieldID
	case "title":
		field = song.FieldTitle
	case "duration":
		field = song.FieldDurationSeconds
	case "updated_at", "updatedAt":
		field = song.FieldUpdatedAt
	case "added_at", "created_at", "createdAt", "":
		field = song.FieldCreatedAt
	}
	if descending {
		databaseQuery.Order(ent.Desc(field))
	} else {
		databaseQuery.Order(ent.Asc(field))
	}
	limit := query.Limit
	if limit <= 0 {
		limit = 20
	}
	databaseQuery.Limit(limit)
	if query.Offset > 0 {
		databaseQuery.Offset(query.Offset)
	}
	items, err := databaseQuery.All(ctx)
	if err != nil {
		return nil, err
	}
	return mapEntSongs(items), nil
}

func (h *songHost) Get(ctx context.Context, id int) (pluginhost.Song, error) {
	userID, err := (*Host)(h).userID(ctx)
	if err != nil {
		return pluginhost.Song{}, err
	}
	item, err := h.library.Song(ctx, userID, id)
	if err != nil {
		return pluginhost.Song{}, err
	}
	return mapSong(item), nil
}

func (h *songHost) Create(ctx context.Context, entryPath string, inputs []pluginhost.SongCreate) ([]pluginhost.Song, error) {
	result := make([]pluginhost.Song, 0, len(inputs))
	for _, input := range inputs {
		created, err := h.upsertRemote(ctx, entryPath, input)
		if err != nil {
			return nil, err
		}
		result = append(result, created)
	}
	userID, _ := (*Host)(h).userID(ctx)
	h.library.PluginCatalogChanged(ctx, userID)
	return result, nil
}

func (h *songHost) Update(ctx context.Context, id int, input pluginhost.SongUpdate) (pluginhost.Song, error) {
	update := h.client.Song.UpdateOneID(id)
	if input.Title != nil {
		update.SetTitle(strings.TrimSpace(*input.Title)).SetFileName(strings.TrimSpace(*input.Title))
	}
	if input.Artist != nil {
		update.SetSourceArtist(strings.TrimSpace(*input.Artist))
	}
	if input.Album != nil {
		update.SetSourceAlbum(strings.TrimSpace(*input.Album))
	}
	if input.URL != nil {
		update.SetURL(strings.TrimSpace(*input.URL))
	}
	if input.CoverURL != nil {
		update.SetCoverURL(strings.TrimSpace(*input.CoverURL))
	}
	if input.Duration != nil {
		update.SetDurationSeconds(*input.Duration)
	}
	if _, err := update.Save(ctx); err != nil {
		return pluginhost.Song{}, err
	}
	item, err := h.client.Song.Query().Where(song.ID(id)).WithArtist().WithAlbum().Only(ctx)
	if err != nil {
		return pluginhost.Song{}, err
	}
	userID, _ := (*Host)(h).userID(ctx)
	h.library.PluginCatalogChanged(ctx, userID)
	return mapEntSong(item), nil
}

func (h *songHost) Delete(ctx context.Context, id int) error {
	if err := h.client.Song.DeleteOneID(id).Exec(ctx); err != nil {
		return err
	}
	userID, _ := (*Host)(h).userID(ctx)
	h.library.PluginCatalogChanged(ctx, userID)
	return nil
}

func (h *songHost) Download(context.Context, int, pluginhost.DownloadOptions) (pluginhost.DownloadResult, error) {
	return pluginhost.DownloadResult{}, pluginhost.CapabilityUnavailable("songs.download")
}

func (h *songHost) SetAutoDownload(context.Context, json.RawMessage) error {
	return pluginhost.CapabilityUnavailable("songs.setAutoDownload")
}

func (h *songHost) OrganizePreview(context.Context, []pluginhost.OrganizeItem) ([]pluginhost.OrganizeResult, error) {
	return nil, pluginhost.CapabilityUnavailable("songs.organizePreview")
}

func (h *songHost) Organize(context.Context, []pluginhost.OrganizeItem) ([]pluginhost.OrganizeResult, error) {
	return nil, pluginhost.CapabilityUnavailable("songs.organize")
}

func (h *songHost) upsertRemote(ctx context.Context, entryPath string, input pluginhost.SongCreate) (pluginhost.Song, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.URL = strings.TrimSpace(input.URL)
	input.SourceData = strings.TrimSpace(input.SourceData)
	if input.Title == "" || (input.URL == "" && input.SourceData == "") {
		return pluginhost.Song{}, fmt.Errorf("remote song requires title and url or sourceData")
	}
	if input.DedupKey != "" {
		existing, err := h.client.Song.Query().Where(
			song.PluginEntryPath(entryPath), song.DedupKey(input.DedupKey),
		).WithArtist().WithAlbum().Only(ctx)
		if err == nil {
			if existing.SourceType == "local" {
				return mapEntSong(existing), nil
			}
			updated, updateErr := existing.Update().
				SetTitle(input.Title).SetFileName(input.Title).
				SetSourceArtist(strings.TrimSpace(input.Artist)).SetSourceAlbum(strings.TrimSpace(input.Album)).
				SetURL(input.URL).SetCoverURL(strings.TrimSpace(input.CoverURL)).
				SetSourceData(input.SourceData).SetDurationSeconds(input.Duration).
				SetLyricsEmbedded(input.Lyric).SetLyricsSource(input.LyricSource).
				SetLyricsRemoteURL(input.LyricRemoteURL).SetHasLyrics(input.Lyric != "" || input.LyricRemoteURL != "").
				SetIsVideo(input.IsVideo).Save(ctx)
			if updateErr != nil {
				return pluginhost.Song{}, updateErr
			}
			updatedWithEdges, loadErr := h.client.Song.Query().Where(song.ID(updated.ID)).WithArtist().WithAlbum().Only(ctx)
			if loadErr != nil {
				return pluginhost.Song{}, loadErr
			}
			return mapEntSong(updatedWithEdges), nil
		}
		if !ent.IsNotFound(err) {
			return pluginhost.Song{}, err
		}
	}
	format := ""
	if parsed, err := url.Parse(input.URL); err == nil {
		format = strings.TrimPrefix(strings.ToLower(path.Ext(parsed.Path)), ".")
	}
	created, err := h.client.Song.Create().
		SetTitle(input.Title).SetSourceType("remote").SetSourceArtist(strings.TrimSpace(input.Artist)).
		SetSourceAlbum(strings.TrimSpace(input.Album)).SetPath(remoteSongPath(entryPath, input.DedupKey)).
		SetFileName(input.Title).SetFormat(format).SetURL(input.URL).SetCoverURL(strings.TrimSpace(input.CoverURL)).
		SetPluginEntryPath(entryPath).SetSourceData(input.SourceData).SetDedupKey(input.DedupKey).
		SetDurationSeconds(input.Duration).SetLyricsEmbedded(input.Lyric).SetLyricsSource(input.LyricSource).
		SetLyricsRemoteURL(input.LyricRemoteURL).SetHasLyrics(input.Lyric != "" || input.LyricRemoteURL != "").
		SetIsVideo(input.IsVideo).Save(ctx)
	if err != nil {
		return pluginhost.Song{}, err
	}
	return mapEntSong(created), nil
}

func remoteSongPath(entryPath, dedupKey string) string {
	seed := []byte(entryPath + "\x00" + dedupKey)
	if dedupKey == "" {
		random := make([]byte, 16)
		if _, err := rand.Read(random); err == nil {
			seed = append(seed, random...)
		}
	}
	digest := sha256.Sum256(seed)
	return fmt.Sprintf("plugin://%s/%x", entryPath, digest[:16])
}

type playlistHost Host

func (h *playlistHost) List(ctx context.Context) ([]pluginhost.Playlist, error) {
	userID, err := (*Host)(h).userID(ctx)
	if err != nil {
		return nil, err
	}
	items, err := h.library.Playlists(ctx, userID, 500)
	if err != nil {
		return nil, err
	}
	return mapPlaylists(items), nil
}

func (h *playlistHost) Get(ctx context.Context, id int) (pluginhost.Playlist, error) {
	userID, err := (*Host)(h).userID(ctx)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	item, err := h.client.Playlist.Query().Where(
		playlist.ID(id),
		playlist.HasOwnerWith(user.ID(userID)),
	).Only(ctx)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	return mapEntPlaylist(item), nil
}

func (h *playlistHost) Songs(ctx context.Context, id int, query pluginhost.PlaylistSongQuery) ([]pluginhost.Song, error) {
	userID, err := (*Host)(h).userID(ctx)
	if err != nil {
		return nil, err
	}
	items, err := h.library.PlaylistSongs(ctx, userID, id, 0)
	if err != nil {
		return nil, err
	}
	positions, err := h.client.PlaylistSongPosition.Query().Where(playlistsongposition.PlaylistID(id)).All(ctx)
	if err != nil {
		return nil, err
	}
	positionBySong := make(map[int]int, len(positions))
	for _, position := range positions {
		positionBySong[position.SongID] = position.Position
	}
	sort.SliceStable(items, func(left, right int) bool {
		leftPosition, leftFound := positionBySong[items[left].ID]
		rightPosition, rightFound := positionBySong[items[right].ID]
		if leftFound != rightFound {
			return leftFound
		}
		if leftFound && leftPosition != rightPosition {
			return leftPosition < rightPosition
		}
		return items[left].ID < items[right].ID
	})
	start := min(max(query.Offset, 0), len(items))
	end := len(items)
	if query.Limit > 0 {
		end = min(start+query.Limit, end)
	}
	return mapSongs(items[start:end]), nil
}

func (h *playlistHost) Search(ctx context.Context, term string, page pluginhost.Page) ([]pluginhost.Playlist, error) {
	items, err := h.List(ctx)
	if err != nil {
		return nil, err
	}
	term = strings.ToLower(strings.TrimSpace(term))
	filtered := make([]pluginhost.Playlist, 0, len(items))
	for _, item := range items {
		if term == "" || strings.Contains(strings.ToLower(item.Name), term) || strings.Contains(strings.ToLower(item.Description), term) {
			filtered = append(filtered, item)
		}
	}
	start := min(max(page.Offset, 0), len(filtered))
	end := len(filtered)
	if page.Limit > 0 {
		end = min(start+page.Limit, end)
	}
	return filtered[start:end], nil
}

func (h *playlistHost) Create(ctx context.Context, input pluginhost.PlaylistCreate) (pluginhost.Playlist, error) {
	userID, err := (*Host)(h).userID(ctx)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	item, err := h.library.CreatePlaylist(ctx, userID, input.Name, input.Description, "deep-space")
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	if input.CoverURL != "" {
		updated, updateErr := h.client.Playlist.UpdateOneID(item.ID).SetCoverURL(strings.TrimSpace(input.CoverURL)).Save(ctx)
		if updateErr != nil {
			return pluginhost.Playlist{}, updateErr
		}
		return mapEntPlaylist(updated), nil
	}
	return mapPlaylist(item), nil
}

func (h *playlistHost) Update(ctx context.Context, id int, input pluginhost.PlaylistUpdate) (pluginhost.Playlist, error) {
	userID, err := (*Host)(h).userID(ctx)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	item, err := h.client.Playlist.Query().Where(playlist.ID(id), playlist.HasOwnerWith(user.ID(userID))).Only(ctx)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	update := item.Update()
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return pluginhost.Playlist{}, fmt.Errorf("playlist name is required")
		}
		update.SetName(name)
	}
	if input.Description != nil {
		update.SetDescription(*input.Description)
	}
	if input.CoverURL != nil {
		update.SetCoverURL(strings.TrimSpace(*input.CoverURL))
	}
	updated, err := update.Save(ctx)
	if err != nil {
		return pluginhost.Playlist{}, err
	}
	h.library.PluginCatalogChanged(ctx, userID)
	return mapEntPlaylist(updated), nil
}

func (h *playlistHost) Delete(ctx context.Context, id int) error {
	userID, err := (*Host)(h).userID(ctx)
	if err != nil {
		return err
	}
	item, err := h.client.Playlist.Query().Where(playlist.ID(id), playlist.HasOwnerWith(user.ID(userID))).Only(ctx)
	if err != nil {
		return err
	}
	transaction, err := h.client.Tx(ctx)
	if err != nil {
		return err
	}
	if _, err = transaction.PlaylistSongPosition.Delete().Where(playlistsongposition.PlaylistID(id)).Exec(ctx); err == nil {
		err = transaction.Playlist.DeleteOne(item).Exec(ctx)
	}
	if err != nil {
		_ = transaction.Rollback()
		return err
	}
	if err := transaction.Commit(); err != nil {
		return err
	}
	h.library.PluginCatalogChanged(ctx, userID)
	return nil
}

func (h *playlistHost) AddSongs(ctx context.Context, id int, songIDs []int) (pluginhost.AddSongsResult, error) {
	userID, err := (*Host)(h).userID(ctx)
	if err != nil {
		return pluginhost.AddSongsResult{}, err
	}
	existing, err := h.library.PlaylistSongs(ctx, userID, id, 0)
	if err != nil {
		return pluginhost.AddSongsResult{}, err
	}
	seen := make(map[int]bool, len(existing))
	for _, item := range existing {
		seen[item.ID] = true
	}
	result := pluginhost.AddSongsResult{}
	position := len(existing)
	for _, songID := range songIDs {
		if seen[songID] {
			result.Skipped++
			continue
		}
		if err := h.library.AddSongToPlaylist(ctx, userID, id, songID); err != nil {
			return result, err
		}
		seen[songID] = true
		result.Added++
		position++
		if err := h.setPlaylistSongPosition(ctx, id, songID, position); err != nil {
			return result, err
		}
	}
	return result, nil
}

func (h *playlistHost) RemoveSongs(ctx context.Context, id int, songIDs []int) error {
	userID, err := (*Host)(h).userID(ctx)
	if err != nil {
		return err
	}
	for _, songID := range songIDs {
		if err := h.library.RemoveSongFromPlaylist(ctx, userID, id, songID); err != nil {
			return err
		}
		if _, err := h.client.PlaylistSongPosition.Delete().Where(
			playlistsongposition.PlaylistID(id), playlistsongposition.SongID(songID),
		).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (h *playlistHost) Reorder(ctx context.Context, id int, songIDs []int) error {
	userID, err := (*Host)(h).userID(ctx)
	if err != nil {
		return err
	}
	existing, err := h.library.PlaylistSongs(ctx, userID, id, 0)
	if err != nil {
		return err
	}
	if len(existing) != len(songIDs) {
		return fmt.Errorf("song count mismatch")
	}
	want := make(map[int]bool, len(existing))
	for _, item := range existing {
		want[item.ID] = true
	}
	seen := make(map[int]bool, len(songIDs))
	for _, songID := range songIDs {
		if !want[songID] || seen[songID] {
			return fmt.Errorf("song %d is duplicated or not in playlist", songID)
		}
		seen[songID] = true
	}
	transaction, err := h.client.Tx(ctx)
	if err != nil {
		return err
	}
	if _, err = transaction.PlaylistSongPosition.Delete().Where(playlistsongposition.PlaylistID(id)).Exec(ctx); err == nil {
		builders := make([]*ent.PlaylistSongPositionCreate, len(songIDs))
		for index, songID := range songIDs {
			builders[index] = transaction.PlaylistSongPosition.Create().SetPlaylistID(id).SetSongID(songID).SetPosition(index + 1)
		}
		if len(builders) > 0 {
			_, err = transaction.PlaylistSongPosition.CreateBulk(builders...).Save(ctx)
		}
	}
	if err != nil {
		_ = transaction.Rollback()
		return err
	}
	return transaction.Commit()
}

func (h *playlistHost) setPlaylistSongPosition(ctx context.Context, playlistID, songID, position int) error {
	existing, err := h.client.PlaylistSongPosition.Query().Where(
		playlistsongposition.PlaylistID(playlistID), playlistsongposition.SongID(songID),
	).Only(ctx)
	if err == nil {
		return existing.Update().SetPosition(position).Exec(ctx)
	}
	if !ent.IsNotFound(err) {
		return err
	}
	return h.client.PlaylistSongPosition.Create().SetPlaylistID(playlistID).SetSongID(songID).SetPosition(position).Exec(ctx)
}

type authHost Host

func (h *authHost) PluginInfo(_ context.Context, entryPath string) (pluginhost.PluginInfo, error) {
	return pluginhost.PluginInfo{
		EntryPath: entryPath,
		HostURL:   strings.TrimRight(h.config.HostURL, "/"),
		DataDir:   filepath.Join(h.config.DataDir, entryPath),
		MusicDir:  h.config.MusicDir,
	}, nil
}

func (h *authHost) FileURL(_ context.Context, info pluginhost.PluginInfo, filePath string) (string, error) {
	if _, err := resolveFilePath(info, filePath); err != nil {
		return "", err
	}
	return "/api/v1/jsplugin/" + info.EntryPath + "/files/" + url.PathEscape(filePath), nil
}

func (h *authHost) NetworkAddresses(context.Context, pluginhost.PluginInfo) ([]string, error) {
	return []string{}, nil
}

func mapSongs(items []models.Song) []pluginhost.Song {
	out := make([]pluginhost.Song, len(items))
	for index, item := range items {
		out[index] = mapSong(item)
	}
	return out
}

func mapEntSongs(items []*ent.Song) []pluginhost.Song {
	result := make([]pluginhost.Song, len(items))
	for index, item := range items {
		result[index] = mapEntSong(item)
	}
	return result
}

func mapEntSong(item *ent.Song) pluginhost.Song {
	artistName, albumTitle := item.SourceArtist, item.SourceAlbum
	if item.Edges.Artist != nil {
		artistName = item.Edges.Artist.Name
	}
	if item.Edges.Album != nil {
		albumTitle = item.Edges.Album.Title
	}
	var fileModifiedAt *time.Time
	if item.ModTimeUnixNano > 0 {
		value := time.Unix(0, item.ModTimeUnixNano).UTC()
		fileModifiedAt = &value
	}
	return pluginhost.Song{
		ID: item.ID, Type: item.SourceType, Title: item.Title, Artist: artistName,
		Album: albumTitle, Year: item.Year, Genre: item.Genre, Language: item.Language,
		Style: item.Style, Track: item.Track, Duration: item.DurationSeconds, FilePath: item.Path,
		FileSize: item.SizeBytes, Format: item.Format, BitRate: item.BitRate, SampleRate: item.SampleRate,
		URL: item.URL, CoverURL: item.CoverURL, Lyric: item.LyricsEmbedded,
		LyricSource: item.LyricsSource, LyricRemoteURL: item.LyricsRemoteURL,
		PluginEntryPath: item.PluginEntryPath, SourceData: item.SourceData, DedupKey: item.DedupKey,
		IsLive: item.IsLive, IsVideo: item.IsVideo, AddedAt: item.CreatedAt,
		UpdatedAt: item.UpdatedAt, FileModifiedAt: fileModifiedAt,
	}
}

func mapSong(item models.Song) pluginhost.Song {
	sourceType := item.Type
	if sourceType == "" {
		sourceType = "local"
	}
	streamURL := item.URL
	if sourceType == "local" {
		streamURL = fmt.Sprintf("/api/songs/%d/stream", item.ID)
	}
	coverURL := item.CoverURL
	if coverURL == "" {
		coverURL = fmt.Sprintf("/api/songs/%d/cover", item.ID)
	}
	var fileModifiedAt *time.Time
	if item.ModTimeUnixNano > 0 {
		value := time.Unix(0, item.ModTimeUnixNano).UTC()
		fileModifiedAt = &value
	}
	return pluginhost.Song{
		ID: item.ID, Type: sourceType, Title: item.Title, Artist: item.Artist,
		Album: item.Album, Year: item.Year, Genre: item.Genre, Language: item.Language,
		Style: item.Style, Track: item.Track, Duration: item.DurationSeconds,
		FilePath: item.Path, FileSize: item.SizeBytes, Format: item.Format,
		BitRate: item.BitRate, SampleRate: item.SampleRate, LyricSource: item.LyricsSource,
		LyricRemoteURL:  item.LyricsRemoteURL,
		PluginEntryPath: item.PluginEntryPath, SourceData: item.SourceData, DedupKey: item.DedupKey,
		IsLive: item.IsLive, IsVideo: item.IsVideo, URL: streamURL, CoverURL: coverURL,
		AddedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt, FileModifiedAt: fileModifiedAt,
	}
}

func mapPlaylists(items []models.Playlist) []pluginhost.Playlist {
	out := make([]pluginhost.Playlist, len(items))
	for index, item := range items {
		out[index] = mapPlaylist(item)
	}
	return out
}

func mapEntPlaylist(item *ent.Playlist) pluginhost.Playlist {
	return pluginhost.Playlist{ID: item.ID, Type: "normal", Name: item.Name, Description: item.Description, CoverURL: item.CoverURL}
}

func mapPlaylist(item models.Playlist) pluginhost.Playlist {
	return pluginhost.Playlist{ID: item.ID, Type: "normal", Name: item.Name, Description: item.Description, CoverURL: item.CoverURL}
}

var _ pluginhost.Host = (*Host)(nil)
var _ pluginhost.SongHost = (*songHost)(nil)
var _ pluginhost.PlaylistHost = (*playlistHost)(nil)
var _ pluginhost.AuthHost = (*authHost)(nil)
