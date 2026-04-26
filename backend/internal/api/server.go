package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/internal/library"
	"lark/backend/internal/models"
	"lark/backend/pkg/version"

	echo "github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

type Server struct {
	echo   *echo.Echo
	client *ent.Client
	lib    *library.Service
	cancel context.CancelFunc
}

type playlistRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	CoverTheme  string `json:"cover_theme"`
}

type settingsRequest struct {
	Language        string `json:"language"`
	Theme           string `json:"theme"`
	SleepTimerMins  int    `json:"sleep_timer_mins"`
	NeteaseFallback bool   `json:"netease_fallback"`
}

func New(client *ent.Client, lib *library.Service, frontendOrigin string) *Server {
	e := echo.New()
	e.Use(middleware.Recover())
	e.Use(middleware.RequestID())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{AllowOrigins: []string{frontendOrigin}, AllowHeaders: []string{"Content-Type", "Range"}, AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions}}))
	s := &Server{echo: e, client: client, lib: lib}

	e.GET("/api/health", s.handleHealth)

	e.GET("/api/songs", s.handleSongs)

	e.GET("/api/songs/:id", s.handleSong)

	e.POST("/api/songs/:id/favorite", s.handleToggleSongFavorite)

	e.POST("/api/songs/:id/played", s.handleMarkPlayed)

	e.GET("/api/songs/:id/stream", s.handleStream)
	e.GET("/api/songs/:id/cover", s.handleCover)

	e.GET("/api/songs/:id/lyrics", s.handleLyrics)

	e.POST("/api/library/scan", s.handleScan)

	e.POST("/api/library/upload", s.handleUpload)

	e.GET("/api/albums", s.handleAlbums)

	e.GET("/api/albums/:id/songs", s.handleAlbumSongs)

	e.GET("/api/artists", s.handleArtists)

	e.GET("/api/artists/:id/songs", s.handleArtistSongs)

	e.POST("/api/albums/:id/favorite", s.handleToggleAlbumFavorite)

	e.GET("/api/playlists", s.handlePlaylists)

	e.POST("/api/playlists", s.handleCreatePlaylist)

	e.GET("/api/playlists/:id/songs", s.handlePlaylistSongs)

	e.POST("/api/playlists/:id/songs/:song", s.handleAddSongToPlaylist)

	e.DELETE("/api/playlists/:id/songs/:song", s.handleRemoveSongFromPlaylist)

	e.GET("/api/settings", s.handleGetSettings)

	e.PUT("/api/settings", s.handleSaveSettings)
	s.registerFrontendRoutes()
	return s
}

func (s *Server) Start(addr string) error {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	return echo.StartConfig{Address: addr, HideBanner: true, GracefulTimeout: 10}.Start(ctx, s.echo)
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}

func (s *Server) handleHealth(c *echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{
		"status":            "ok",
		"version":           version.GetVersion(),
		"commit":            version.GitCommit,
		"build_time":        version.BuildTime,
		"go_version":        runtime.Version(),
		"library":           s.lib.LibraryDir(),
		"audio_backend":     "pure-go-http-range",
		"metadata_backend":  "dhowden/tag+ffprobe-optional",
		"transcode_backend": "ffmpeg-cli-optional",
	})
}

func (s *Server) handleSongs(c *echo.Context) error {
	limit := queryInt(c, "limit", 0)
	favorites := c.QueryParam("favorites") == "true"
	items, err := s.lib.Songs(c.Request().Context(), c.QueryParam("q"), favorites, limit)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleSong(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	item, err := s.lib.Song(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleToggleSongFavorite(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	item, err := s.lib.ToggleSongFavorite(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleMarkPlayed(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	if err := s.lib.MarkPlayed(c.Request().Context(), id); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handleStream(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	item, err := s.lib.RawSong(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	mode := strings.ToLower(strings.TrimSpace(c.QueryParam("mode")))
	if mode == "" {
		mode = "auto"
	}
	if mode == "raw" || (mode == "auto" && canBrowserPlayDirect(item.Format)) {
		c.Response().Header().Set("Accept-Ranges", "bytes")
		http.ServeFile(c.Response(), c.Request(), item.Path)
		return nil
	}
	if mode == "auto" || mode == "transcode" {
		return s.transcodeAudio(c, item.Path)
	}
	return echo.NewHTTPError(http.StatusBadRequest, "mode must be auto, raw or transcode")
}

func (s *Server) handleCover(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	data, mimeType, err := s.lib.SongCover(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	if len(data) == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "cover not found")
	}
	return c.Blob(http.StatusOK, mimeType, data)
}

func (s *Server) transcodeAudio(c *echo.Context, sourcePath string) error {
	ffmpeg := strings.TrimSpace(s.lib.FFmpegBin())
	if ffmpeg == "" {
		return echo.NewHTTPError(http.StatusUnsupportedMediaType, "ffmpeg is not configured for this audio format")
	}
	ctx, cancel := context.WithCancel(c.Request().Context())
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner", "-loglevel", "error",
		"-i", sourcePath,
		"-vn",
		"-map", "0:a:0",
		"-acodec", "libmp3lame",
		"-b:a", "320k",
		"-f", "mp3",
		"pipe:1",
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return mapError(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return echo.NewHTTPError(http.StatusUnsupportedMediaType, "unable to start ffmpeg transcoder: "+err.Error())
	}
	defer func() {
		_ = stdout.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	}()
	c.Response().Header().Set("Content-Type", "audio/mpeg")
	c.Response().Header().Set("Cache-Control", "no-store")
	c.Response().Header().Set("X-Lark-Transcoded", "ffmpeg-mp3-320k")
	c.Response().WriteHeader(http.StatusOK)
	_, copyErr := io.Copy(c.Response(), stdout)
	return copyErr
}

func (s *Server) handleLyrics(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	sourceID := c.QueryParam("source_id")
	if strings.TrimSpace(sourceID) == "" {
		sourceID = c.QueryParam("netease_id")
	}
	lyrics, err := s.lib.Lyrics(c.Request().Context(), id, sourceID)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, lyrics)
}

func (s *Server) handleScan(c *echo.Context) error {
	result, err := s.lib.Scan(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, result)
}

func (s *Server) handleUpload(c *echo.Context) error {
	file, err := c.FormFile("file")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "file is required")
	}
	if !library.IsSupported(file.Filename) {
		return echo.NewHTTPError(http.StatusBadRequest, "unsupported audio format")
	}
	src, err := file.Open()
	if err != nil {
		return mapError(err)
	}
	defer src.Close()
	name := safeFileName(file.Filename)
	dstPath := filepath.Join(s.lib.LibraryDir(), name)
	for i := 1; ; i++ {
		if _, err := os.Stat(dstPath); errors.Is(err, os.ErrNotExist) {
			break
		}
		ext := filepath.Ext(name)
		dstPath = filepath.Join(s.lib.LibraryDir(), fmt.Sprintf("%s-%d%s", strings.TrimSuffix(name, ext), i, ext))
	}
	dst, err := os.Create(dstPath)
	if err != nil {
		return mapError(err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		return mapError(err)
	}
	if err := dst.Close(); err != nil {
		return mapError(err)
	}
	_, err = s.lib.ImportFile(c.Request().Context(), dstPath)
	if err != nil {
		return mapError(err)
	}
	item, err := s.lib.Songs(c.Request().Context(), filepath.Base(dstPath), false, 1)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusCreated, item)
}

func (s *Server) handleAlbums(c *echo.Context) error {
	items, err := s.lib.Albums(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}
func (s *Server) handleAlbumSongs(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	items, err := s.lib.AlbumSongs(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}
func (s *Server) handleToggleAlbumFavorite(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	item, err := s.lib.ToggleAlbumFavorite(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleArtists(c *echo.Context) error {
	items, err := s.lib.Artists(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleArtistSongs(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	items, err := s.lib.ArtistSongs(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handlePlaylists(c *echo.Context) error {
	items, err := s.lib.Playlists(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleCreatePlaylist(c *echo.Context) error {
	var req playlistRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	item, err := s.lib.CreatePlaylist(c.Request().Context(), req.Name, req.Description, req.CoverTheme)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusCreated, item)
}
func (s *Server) handlePlaylistSongs(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	items, err := s.lib.PlaylistSongs(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}
func (s *Server) handleAddSongToPlaylist(c *echo.Context) error {
	pid, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	sid, err := paramInt(c, "song")
	if err != nil {
		return err
	}
	if err := s.lib.AddSongToPlaylist(c.Request().Context(), pid, sid); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}
func (s *Server) handleRemoveSongFromPlaylist(c *echo.Context) error {
	pid, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	sid, err := paramInt(c, "song")
	if err != nil {
		return err
	}
	if err := s.lib.RemoveSongFromPlaylist(c.Request().Context(), pid, sid); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}
func (s *Server) handleGetSettings(c *echo.Context) error {
	settings, err := s.lib.GetSettings(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, settings)
}

func (s *Server) handleSaveSettings(c *echo.Context) error {
	var req settingsRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	settings, err := s.lib.SaveSettings(c.Request().Context(), models.Settings{Language: req.Language, Theme: req.Theme, SleepTimerMins: req.SleepTimerMins, LibraryPath: s.lib.LibraryDir(), NeteaseFallback: req.NeteaseFallback})
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, settings)
}

func paramInt(c *echo.Context, name string) (int, error) {
	id, err := strconv.Atoi(c.Param(name))
	if err != nil {
		return 0, echo.NewHTTPError(http.StatusBadRequest, "invalid "+name)
	}
	return id, nil
}
func queryInt(c *echo.Context, name string, fallback int) int {
	raw := strings.TrimSpace(c.QueryParam(name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}
func mapError(err error) error {
	if ent.IsNotFound(err) {
		return echo.NewHTTPError(http.StatusNotFound, "not found")
	}
	return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
}
func safeFileName(name string) string {
	name = filepath.Base(name)
	name = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == 0 {
			return '-'
		}
		return r
	}, name)
	if strings.TrimSpace(name) == "" {
		return fmt.Sprintf("upload-%d", time.Now().UnixNano())
	}
	return name
}

func canBrowserPlayDirect(format string) bool {
	switch strings.ToLower(strings.TrimPrefix(format, ".")) {
	case "mp3", "flac", "wav", "m4a", "aac", "ogg", "oga", "opus":
		return true
	default:
		return false
	}
}
