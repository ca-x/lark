package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/playlist"
	"lark/backend/ent/song"
	"lark/backend/ent/user"
	"lark/backend/internal/library"
	"lark/backend/internal/plugin"
	pluginhost "lark/backend/internal/plugin/host"
	"lark/backend/pkg/version"

	echo "github.com/labstack/echo/v5"
)

const songLoftMaxLibraryPage = 100_000

const songLoftPluginContextKey = "songloft_plugin"

type songLoftSong struct {
	ID              int        `json:"id"`
	Type            string     `json:"type"`
	Title           string     `json:"title"`
	Artist          string     `json:"artist"`
	Album           string     `json:"album"`
	Year            int        `json:"year"`
	Genre           string     `json:"genre"`
	Language        string     `json:"language,omitempty"`
	Style           string     `json:"style,omitempty"`
	Duration        float64    `json:"duration"`
	FilePath        string     `json:"file_path"`
	URL             string     `json:"url"`
	CoverURL        string     `json:"cover_url"`
	LyricRemoteURL  string     `json:"lyric_remote_url,omitempty"`
	LyricURL        string     `json:"lyric_url,omitempty"`
	FileSize        int64      `json:"file_size"`
	Format          string     `json:"format"`
	BitRate         int        `json:"bit_rate"`
	SampleRate      int        `json:"sample_rate"`
	IsLive          bool       `json:"is_live"`
	IsVideo         bool       `json:"is_video"`
	PluginEntryPath string     `json:"plugin_entry_path,omitempty"`
	SourceData      string     `json:"source_data,omitempty"`
	DedupKey        string     `json:"dedup_key,omitempty"`
	Track           string     `json:"track,omitempty"`
	AddedAt         time.Time  `json:"added_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	FileModifiedAt  *time.Time `json:"file_modified_at,omitempty"`
}

func (s *Server) registerSongLoftLibraryRoutes() {
	readSongs := s.requireSongLoftCapability(plugin.PermSongsRead)
	writeSongs := s.requireSongLoftCapability(plugin.PermSongsWrite)
	readPlaylists := s.requireSongLoftCapability(plugin.PermPlaylistsRead)
	writePlaylists := s.requireSongLoftCapability(plugin.PermPlaylistsWrite)

	s.echo.GET("/api/v1/version", s.handleSongLoftVersion, readSongs)
	s.echo.GET("/api/v1/settings/music-path", s.handleSongLoftMusicPath, readSongs)
	s.echo.GET("/api/v1/songs", s.handleSongLoftSongs, readSongs)
	s.echo.GET("/api/v1/songs/ids", s.handleSongLoftSongIDs, readSongs)
	s.echo.GET("/api/v1/songs/random", s.handleSongLoftSongs, readSongs)
	s.echo.GET("/api/v1/songs/facets", s.handleSongLoftFacets, readSongs)
	s.echo.GET("/api/v1/songs/stats", s.handleSongLoftStats, readSongs)
	s.echo.GET("/api/v1/songs/:id", s.handleSongLoftSong, readSongs)
	s.echo.PUT("/api/v1/songs/:id", s.handleSongLoftUpdateSong, writeSongs)
	s.echo.DELETE("/api/v1/songs/:id", s.handleSongLoftDeleteSong, writeSongs)
	s.echo.PUT("/api/v1/songs/:id/tags", s.handleSongLoftUpdateTags, writeSongs)
	s.echo.PUT("/api/v1/songs/:id/lyrics", s.handleSongLoftUpdateLyrics, writeSongs)
	s.echo.POST("/api/v1/songs/remote", s.handleSongLoftRemoteSongs, writeSongs)
	s.echo.POST("/api/v1/playlists", s.handleSongLoftCreatePlaylist, writePlaylists)
	s.echo.GET("/api/v1/playlists", s.handleSongLoftPlaylists, readPlaylists)
	s.echo.GET("/api/v1/playlists/:id", s.handleSongLoftPlaylist, readPlaylists)
	s.echo.PUT("/api/v1/playlists/:id", s.handleSongLoftUpdatePlaylist, writePlaylists)
	s.echo.DELETE("/api/v1/playlists/:id", s.handleSongLoftDeletePlaylist, writePlaylists)
	s.echo.GET("/api/v1/songs/:id/cover", s.handleCover, readSongs)
	s.echo.GET("/api/v1/songs/:id/lyric", s.handleLyrics, readSongs)
	s.echo.GET("/api/v1/playlists/:id/songs", s.handleSongloftPlaylistSongs, readPlaylists)
	s.echo.POST("/api/v1/playlists/:id/songs", s.handleSongloftAddPlaylistSongs, writePlaylists)
	s.echo.DELETE("/api/v1/playlists/:id/songs/:song", s.handleRemoveSongFromPlaylist, writePlaylists)
}

func (s *Server) handleSongLoftSongIDs(c *echo.Context) error {
	query := s.client.Song.Query()
	if kind := strings.TrimSpace(c.QueryParam("type")); kind != "" {
		query.Where(song.SourceTypeEQ(kind))
	}
	if keyword := strings.TrimSpace(c.QueryParam("keyword")); keyword != "" {
		query.Where(song.Or(song.TitleContainsFold(keyword), song.SourceArtistContainsFold(keyword), song.SourceAlbumContainsFold(keyword)))
	}
	items, err := query.Select(song.FieldID).All(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	return c.JSON(http.StatusOK, map[string]any{"ids": ids, "total": len(ids)})
}

func (s *Server) handleSongLoftFacets(c *echo.Context) error {
	field := strings.TrimSpace(c.QueryParam("field"))
	values := []map[string]any{}
	if field == "language" || field == "style" || field == "genre" {
		column := song.FieldLanguage
		if field == "style" {
			column = song.FieldStyle
		}
		if field == "genre" {
			column = song.FieldGenre
		}
		rows, err := s.client.Song.Query().GroupBy(column).Strings(c.Request().Context())
		if err != nil {
			return mapError(err)
		}
		for _, value := range rows {
			if strings.TrimSpace(value) != "" {
				values = append(values, map[string]any{"value": value})
			}
		}
	}
	return c.JSON(http.StatusOK, map[string]any{"field": field, "items": values})
}

func (s *Server) handleSongLoftStats(c *echo.Context) error {
	count, err := s.client.Song.Query().Count(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"songs": count})
}

func (s *Server) handleSongLoftDeleteSong(c *echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid song id")
	}
	if err := s.client.Song.DeleteOneID(id).Exec(c.Request().Context()); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handleSongLoftUpdateTags(c *echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid song id")
	}
	var req struct {
		Title, Artist, Album, CoverURL, Genre, Language, Style, Track string
		Year                                                          int
		Lyrics                                                        string `json:"lyrics"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}
	result, err := s.lib.UpdateSongMetadata(c.Request().Context(), currentUserID(c), id, library.MetadataWritebackInput{Title: req.Title, Artist: req.Artist, Album: req.Album, CoverURL: req.CoverURL, Year: req.Year, Genre: req.Genre, Language: req.Language, Style: req.Style, Track: req.Track, Lyrics: req.Lyrics, ConfirmWriteback: true})
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"song": result.Song, "file_write": result.Items})
}

func (s *Server) handleSongLoftUpdateLyrics(c *echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid song id")
	}
	var req struct {
		LyricSource    string `json:"lyric_source"`
		LyricRemoteURL string `json:"lyric_remote_url"`
		Lyric          string `json:"lyric"`
		Tlyric         string `json:"tlyric"`
		Rlyric         string `json:"rlyric"`
		Lxlyric        string `json:"lxlyric"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}
	item, err := s.client.Song.Query().Where(song.ID(id)).Only(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	update := item.Update()
	if req.LyricSource == "url" {
		update.SetLyricsEmbedded("").SetLyricsRemoteURL(req.LyricRemoteURL).SetLyricsSource(req.LyricSource).SetHasLyrics(req.LyricRemoteURL != "")
	} else {
		lyric := strings.TrimSpace(req.Lyric)
		update.SetLyricsEmbedded(lyric).SetLyricsRemoteURL("").SetLyricsSource(req.LyricSource).SetHasLyrics(lyric != "")
	}
	if _, err := update.Save(c.Request().Context()); err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "歌词已更新"})
}

func (s *Server) handleSongLoftRemoteSongs(c *echo.Context) error {
	var reqs []struct {
		URL             string  `json:"url"`
		Title           string  `json:"title"`
		Artist          string  `json:"artist"`
		Album           string  `json:"album"`
		CoverURL        string  `json:"cover_url"`
		SourceData      string  `json:"source_data"`
		DedupKey        string  `json:"dedup_key"`
		Lyric           string  `json:"lyric"`
		LyricSource     string  `json:"lyric_source"`
		LyricRemoteURL  string  `json:"lyric_remote_url"`
		Duration        float64 `json:"duration"`
		PluginEntryPath string  `json:"plugin_entry_path"`
		IsVideo         bool    `json:"is_video"`
	}
	if err := c.Bind(&reqs); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}
	if s.pluginManager == nil || s.pluginManager.SongsHost() == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "host capability unavailable")
	}
	entry := ""
	if item, ok := c.Get(songLoftPluginContextKey).(plugin.Plugin); ok {
		entry = item.EntryPath
	}
	inputs := make([]pluginhost.SongCreate, len(reqs))
	for i, req := range reqs {
		inputs[i] = pluginhost.SongCreate{URL: req.URL, Title: req.Title, Artist: req.Artist, Album: req.Album, CoverURL: req.CoverURL, Duration: req.Duration, SourceData: req.SourceData, DedupKey: req.DedupKey, Lyric: req.Lyric, LyricSource: req.LyricSource, LyricRemoteURL: req.LyricRemoteURL, IsVideo: req.IsVideo}
	}
	created, err := s.pluginManager.SongsHost().Create(c.Request().Context(), entry, inputs)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusCreated, map[string]any{"songs": created, "count": len(created)})
}

func (s *Server) handleSongLoftCreatePlaylist(c *echo.Context) error {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Type        string `json:"type"`
		CoverURL    string `json:"cover_url"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}
	userID := currentUserID(c)
	item, err := s.lib.CreatePlaylist(c.Request().Context(), userID, req.Name, req.Description, "deep-space")
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusCreated, item)
}

func (s *Server) handleSongLoftPlaylists(c *echo.Context) error {
	items, err := s.lib.Playlists(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 0))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"items": items, "playlists": items, "total": len(items)})
}

func (s *Server) handleSongLoftPlaylist(c *echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid playlist id")
	}
	item, err := s.client.Playlist.Query().Where(playlist.ID(id), playlist.HasOwnerWith(user.ID(currentUserID(c)))).Only(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleSongLoftUpdatePlaylist(c *echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid playlist id")
	}
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
		CoverTheme  *string `json:"cover_theme"`
		CoverURL    *string `json:"cover_url"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}
	update := s.client.Playlist.Update().Where(playlist.ID(id), playlist.HasOwnerWith(user.ID(currentUserID(c))))
	if req.Name != nil {
		update.SetName(*req.Name)
	}
	if req.Description != nil {
		update.SetDescription(*req.Description)
	}
	if req.CoverTheme != nil {
		update.SetCoverTheme(*req.CoverTheme)
	}
	if req.CoverURL != nil {
		update.SetCoverURL(*req.CoverURL)
	}
	if _, err := update.Save(c.Request().Context()); err != nil {
		return mapError(err)
	}
	item, err := s.client.Playlist.Query().Where(playlist.ID(id), playlist.HasOwnerWith(user.ID(currentUserID(c)))).Only(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleSongLoftDeletePlaylist(c *echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid playlist id")
	}
	if _, err := s.client.Playlist.Delete().Where(playlist.ID(id), playlist.HasOwnerWith(user.ID(currentUserID(c)))).Exec(c.Request().Context()); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) requireSongLoftCapability(permission string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			authorization := strings.TrimSpace(c.Request().Header.Get("Authorization"))
			if token, found := strings.CutPrefix(authorization, "Bearer "); found && token != "" {
				if s.pluginManager == nil {
					return echo.NewHTTPError(http.StatusUnauthorized, "invalid plugin token")
				}
				item, err := s.pluginManager.AuthenticateHostToken(c.Request().Context(), token, permission)
				if errors.Is(err, plugin.ErrHostTokenPermissionDenied) {
					return echo.NewHTTPError(http.StatusForbidden, "plugin permission denied")
				}
				if err != nil {
					return echo.NewHTTPError(http.StatusUnauthorized, "invalid plugin token")
				}
				admin, err := s.client.User.Query().Where(user.RoleEQ("admin")).Order(ent.Asc(user.FieldID)).First(c.Request().Context())
				if err != nil {
					return echo.NewHTTPError(http.StatusUnauthorized, "plugin user is unavailable")
				}
				c.Set("user", admin)
				c.Set(songLoftPluginContextKey, item)
				return next(c)
			}
			return s.requireAuth(next)(c)
		}
	}
}

func (s *Server) handleSongLoftVersion(c *echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"version": version.GetVersion()})
}

func (s *Server) handleSongLoftMusicPath(c *echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"path": s.lib.LibraryDir()})
}

func (s *Server) handleSongLoftSongs(c *echo.Context) error {
	limit := min(max(queryInt(c, "limit", 20), 1), songLoftMaxLibraryPage)
	offset := max(queryInt(c, "offset", 0), 0)
	query := s.client.Song.Query().WithArtist().WithAlbum()
	if kind := strings.TrimSpace(c.QueryParam("type")); kind != "" {
		query.Where(song.SourceTypeEQ(kind))
	}
	if keyword := strings.TrimSpace(c.QueryParam("keyword")); keyword != "" {
		query.Where(song.Or(song.TitleContainsFold(keyword), song.SourceArtistContainsFold(keyword), song.SourceAlbumContainsFold(keyword)))
	}
	if prefix := strings.TrimSpace(c.QueryParam("path_prefix")); prefix != "" {
		query.Where(song.PathHasPrefix(prefix))
	}
	total, err := query.Clone().Count(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	items, err := query.Order(ent.Desc(song.FieldCreatedAt)).Limit(limit).Offset(offset).All(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{
		"songs": mapSongLoftSongs(items), "total": total, "limit": limit, "offset": offset,
	})
}

func (s *Server) handleSongLoftSong(c *echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid song id")
	}
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().WithAlbum().Only(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, mapSongLoftSong(item))
}

func (s *Server) handleSongLoftUpdateSong(c *echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid song id")
	}
	var request struct {
		Title    string `json:"title"`
		Artist   string `json:"artist"`
		Album    string `json:"album"`
		URL      string `json:"url"`
		CoverURL string `json:"cover_url"`
		IsLive   *bool  `json:"is_live"`
		IsVideo  *bool  `json:"is_video"`
	}
	if err := c.Bind(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}
	if strings.TrimSpace(request.Title) == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "title is required")
	}
	update := s.client.Song.UpdateOneID(id).
		SetTitle(strings.TrimSpace(request.Title)).
		SetSourceArtist(strings.TrimSpace(request.Artist)).
		SetSourceAlbum(strings.TrimSpace(request.Album)).
		SetCoverURL(strings.TrimSpace(request.CoverURL))
	if request.URL != "" {
		update.SetURL(strings.TrimSpace(request.URL))
	}
	if request.IsLive != nil {
		update.SetIsLive(*request.IsLive)
	}
	if request.IsVideo != nil {
		update.SetIsVideo(*request.IsVideo)
	}
	if _, err := update.Save(c.Request().Context()); err != nil {
		return mapError(err)
	}
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().WithAlbum().Only(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, mapSongLoftSong(item))
}

func mapSongLoftSongs(items []*ent.Song) []songLoftSong {
	result := make([]songLoftSong, len(items))
	for index, item := range items {
		result[index] = mapSongLoftSong(item)
	}
	return result
}

func mapSongLoftSong(item *ent.Song) songLoftSong {
	artist, album := item.SourceArtist, item.SourceAlbum
	if item.Edges.Artist != nil {
		artist = item.Edges.Artist.Name
	}
	if item.Edges.Album != nil {
		album = item.Edges.Album.Title
	}
	coverURL := item.CoverURL
	if coverURL == "" {
		coverURL = fmt.Sprintf("/api/v1/songs/%d/cover", item.ID)
	}
	lyricURL := ""
	if item.HasLyrics || item.LyricsSource != "" || item.LyricsRemoteURL != "" {
		lyricURL = fmt.Sprintf("/api/v1/songs/%d/lyric", item.ID)
	}
	var modifiedAt *time.Time
	if item.ModTimeUnixNano > 0 {
		value := time.Unix(0, item.ModTimeUnixNano).UTC()
		modifiedAt = &value
	}
	return songLoftSong{
		ID: item.ID, Type: item.SourceType, Title: item.Title, Artist: artist, Album: album,
		Year: item.Year, Genre: item.Genre, Language: item.Language, Style: item.Style,
		Track: item.Track, Duration: item.DurationSeconds, FilePath: item.Path, URL: item.URL,
		CoverURL: coverURL, LyricRemoteURL: item.LyricsRemoteURL, LyricURL: lyricURL,
		FileSize: item.SizeBytes, Format: item.Format, BitRate: item.BitRate, SampleRate: item.SampleRate,
		IsLive: item.IsLive, IsVideo: item.IsVideo, PluginEntryPath: item.PluginEntryPath,
		SourceData: item.SourceData, DedupKey: item.DedupKey, AddedAt: item.CreatedAt,
		UpdatedAt: item.UpdatedAt, FileModifiedAt: modifiedAt,
	}
}
