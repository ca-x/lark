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

const sessionCookieName = "lark_session"

type authRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type profileRequest struct {
	Nickname      string `json:"nickname"`
	AvatarDataURL string `json:"avatar_data_url"`
}

type playbackProgressRequest struct {
	ProgressSeconds float64 `json:"progress_seconds"`
	DurationSeconds float64 `json:"duration_seconds"`
	Completed       bool    `json:"completed"`
}

type lyricSelectRequest struct {
	Source string `json:"source"`
	ID     string `json:"id"`
}

type settingsRequest struct {
	Language            string `json:"language"`
	Theme               string `json:"theme"`
	SleepTimerMins      int    `json:"sleep_timer_mins"`
	NeteaseFallback     bool   `json:"netease_fallback"`
	RegistrationEnabled bool   `json:"registration_enabled"`
}

func New(client *ent.Client, lib *library.Service, frontendOrigin string) *Server {
	e := echo.New()
	e.Use(middleware.Recover())
	e.Use(middleware.RequestID())
	cors := middleware.CORSConfig{AllowOrigins: []string{frontendOrigin}, AllowHeaders: []string{"Content-Type", "Range"}, AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions}}
	if frontendOrigin != "*" {
		cors.AllowCredentials = true
	}
	e.Use(middleware.CORSWithConfig(cors))
	s := &Server{echo: e, client: client, lib: lib}

	auth := s.requireAuth
	admin := s.requireAdmin

	e.GET("/api/health", s.handleHealth)
	e.GET("/api/auth/status", s.handleAuthStatus)
	e.POST("/api/auth/setup", s.handleSetupAdmin)
	e.POST("/api/auth/login", s.handleLogin)
	e.POST("/api/auth/register", s.handleRegister)
	e.POST("/api/auth/logout", s.handleLogout)
	e.PUT("/api/me", s.handleUpdateProfile, auth)
	e.GET("/api/users", s.handleUsers, admin)

	e.GET("/api/songs", s.handleSongs, auth)
	e.GET("/api/songs/:id", s.handleSong, auth)
	e.POST("/api/songs/:id/favorite", s.handleToggleSongFavorite, auth)
	e.POST("/api/songs/:id/played", s.handleMarkPlayed, auth)
	e.PUT("/api/songs/:id/progress", s.handleSavePlaybackProgress, auth)
	e.GET("/api/songs/:id/stream", s.handleStream, auth)
	e.GET("/api/songs/:id/cover", s.handleCover, auth)
	e.GET("/api/songs/:id/lyrics/candidates", s.handleLyricCandidates, auth)
	e.POST("/api/songs/:id/lyrics/select", s.handleSelectLyrics, auth)
	e.GET("/api/songs/:id/lyrics", s.handleLyrics, auth)

	e.POST("/api/library/scan", s.handleScan, admin)
	e.GET("/api/library/scan/status", s.handleScanStatus, admin)
	e.POST("/api/library/upload", s.handleUpload, admin)

	e.GET("/api/albums", s.handleAlbums, auth)
	e.GET("/api/albums/:id/cover", s.handleAlbumCover, auth)
	e.GET("/api/albums/:id/songs", s.handleAlbumSongs, auth)
	e.GET("/api/artists", s.handleArtists, auth)
	e.GET("/api/artists/:id/cover", s.handleArtistCover, auth)
	e.GET("/api/artists/:id/songs", s.handleArtistSongs, auth)
	e.POST("/api/albums/:id/favorite", s.handleToggleAlbumFavorite, auth)

	e.GET("/api/playlists", s.handlePlaylists, auth)
	e.POST("/api/playlists", s.handleCreatePlaylist, auth)
	e.GET("/api/playlists/:id/songs", s.handlePlaylistSongs, auth)
	e.POST("/api/playlists/:id/songs/:song", s.handleAddSongToPlaylist, auth)
	e.DELETE("/api/playlists/:id/songs/:song", s.handleRemoveSongFromPlaylist, auth)

	e.GET("/api/settings", s.handleGetSettings, auth)
	e.PUT("/api/settings", s.handleSaveSettings, admin)
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
		"full_version":      version.GetFullVersion(),
		"commit":            version.GitCommit,
		"build_time":        version.BuildTime,
		"go_version":        runtime.Version(),
		"library":           s.lib.LibraryDir(),
		"audio_backend":     "pure-go-http-range",
		"metadata_backend":  "dhowden/tag+ffprobe-optional",
		"transcode_backend": "ffmpeg-cli-optional",
	})
}

func (s *Server) handleAuthStatus(c *echo.Context) error {
	status, err := s.lib.AuthStatus(c.Request().Context(), s.sessionToken(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleSetupAdmin(c *echo.Context) error {
	var req authRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	user, token, err := s.lib.SetupAdmin(c.Request().Context(), req.Username, req.Password)
	if err != nil {
		return mapError(err)
	}
	s.setSessionCookie(c, token, sessionTTLSeconds())
	return c.JSON(http.StatusCreated, map[string]any{"user": user})
}

func (s *Server) handleLogin(c *echo.Context) error {
	var req authRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	user, token, err := s.lib.Login(c.Request().Context(), req.Username, req.Password)
	if err != nil {
		return mapError(err)
	}
	s.setSessionCookie(c, token, sessionTTLSeconds())
	return c.JSON(http.StatusOK, map[string]any{"user": user})
}

func (s *Server) handleRegister(c *echo.Context) error {
	var req authRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	user, token, err := s.lib.Register(c.Request().Context(), req.Username, req.Password)
	if err != nil {
		return mapError(err)
	}
	s.setSessionCookie(c, token, sessionTTLSeconds())
	return c.JSON(http.StatusCreated, map[string]any{"user": user})
}

func (s *Server) handleLogout(c *echo.Context) error {
	if err := s.lib.Logout(c.Request().Context(), s.sessionToken(c)); err != nil {
		return mapError(err)
	}
	s.setSessionCookie(c, "", -1)
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handleUpdateProfile(c *echo.Context) error {
	var req profileRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	user, err := s.lib.UpdateProfile(c.Request().Context(), currentUserID(c), req.Nickname, req.AvatarDataURL)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, user)
}

func (s *Server) handleUsers(c *echo.Context) error {
	users, err := s.lib.Users(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, users)
}

func (s *Server) requireAuth(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c *echo.Context) error {
		u, err := s.lib.UserBySession(c.Request().Context(), s.sessionToken(c))
		if err != nil {
			return mapError(library.ErrUnauthenticated)
		}
		c.Set("user", u)
		return next(c)
	}
}

func (s *Server) requireAdmin(next echo.HandlerFunc) echo.HandlerFunc {
	return s.requireAuth(func(c *echo.Context) error {
		u := currentUser(c)
		if u == nil || u.Role != "admin" {
			return mapError(library.ErrForbidden)
		}
		return next(c)
	})
}

func currentUser(c *echo.Context) *ent.User {
	if u, ok := c.Get("user").(*ent.User); ok {
		return u
	}
	return nil
}

func currentUserID(c *echo.Context) int {
	if u := currentUser(c); u != nil {
		return u.ID
	}
	return 0
}

func (s *Server) sessionToken(c *echo.Context) string {
	cookie, err := c.Cookie(sessionCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func (s *Server) setSessionCookie(c *echo.Context, value string, maxAge int) {
	c.SetCookie(&http.Cookie{
		Name:     sessionCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func sessionTTLSeconds() int { return int((30 * 24 * time.Hour).Seconds()) }

func (s *Server) handleSongs(c *echo.Context) error {
	limit := queryInt(c, "limit", 0)
	favorites := c.QueryParam("favorites") == "true"
	items, err := s.lib.Songs(c.Request().Context(), currentUserID(c), c.QueryParam("q"), favorites, limit)
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
	item, err := s.lib.Song(c.Request().Context(), currentUserID(c), id)
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
	item, err := s.lib.ToggleSongFavorite(c.Request().Context(), currentUserID(c), id)
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
	if err := s.lib.MarkPlayed(c.Request().Context(), currentUserID(c), id); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handleSavePlaybackProgress(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	var req playbackProgressRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if err := s.lib.SavePlaybackProgress(c.Request().Context(), currentUserID(c), id, req.ProgressSeconds, req.DurationSeconds, req.Completed); err != nil {
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
	c.Response().Header().Set("Cache-Control", "public, max-age=86400")
	return c.Blob(http.StatusOK, mimeType, data)
}

func (s *Server) handleAlbumCover(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	data, mimeType, err := s.lib.AlbumCover(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	if len(data) == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "cover not found")
	}
	c.Response().Header().Set("Cache-Control", "public, max-age=86400")
	return c.Blob(http.StatusOK, mimeType, data)
}

func (s *Server) handleArtistCover(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	data, mimeType, err := s.lib.ArtistCover(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	if len(data) == 0 {
		return echo.NewHTTPError(http.StatusNotFound, "cover not found")
	}
	c.Response().Header().Set("Cache-Control", "public, max-age=86400")
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

func (s *Server) handleLyricCandidates(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	candidates, err := s.lib.LyricCandidates(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, candidates)
}

func (s *Server) handleSelectLyrics(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	var req lyricSelectRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	lyrics, err := s.lib.SelectLyrics(c.Request().Context(), id, req.Source, req.ID)
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

func (s *Server) handleScanStatus(c *echo.Context) error {
	return c.JSON(http.StatusOK, s.lib.ScanStatus())
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
	item, err := s.lib.Songs(c.Request().Context(), currentUserID(c), filepath.Base(dstPath), false, 1)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusCreated, item)
}

func (s *Server) handleAlbums(c *echo.Context) error {
	items, err := s.lib.Albums(c.Request().Context(), currentUserID(c))
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
	items, err := s.lib.AlbumSongs(c.Request().Context(), currentUserID(c), id)
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
	item, err := s.lib.ToggleAlbumFavorite(c.Request().Context(), currentUserID(c), id)
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
	items, err := s.lib.ArtistSongs(c.Request().Context(), currentUserID(c), id)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handlePlaylists(c *echo.Context) error {
	items, err := s.lib.Playlists(c.Request().Context(), currentUserID(c))
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
	item, err := s.lib.CreatePlaylist(c.Request().Context(), currentUserID(c), req.Name, req.Description, req.CoverTheme)
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
	items, err := s.lib.PlaylistSongs(c.Request().Context(), currentUserID(c), id)
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
	if err := s.lib.AddSongToPlaylist(c.Request().Context(), currentUserID(c), pid, sid); err != nil {
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
	if err := s.lib.RemoveSongFromPlaylist(c.Request().Context(), currentUserID(c), pid, sid); err != nil {
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
	settings, err := s.lib.SaveSettings(c.Request().Context(), models.Settings{Language: req.Language, Theme: req.Theme, SleepTimerMins: req.SleepTimerMins, LibraryPath: s.lib.LibraryDir(), NeteaseFallback: req.NeteaseFallback, RegistrationEnabled: req.RegistrationEnabled})
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
	if errors.Is(err, library.ErrUnauthenticated) {
		return echo.NewHTTPError(http.StatusUnauthorized, "unauthenticated")
	}
	if errors.Is(err, library.ErrForbidden) {
		return echo.NewHTTPError(http.StatusForbidden, "forbidden")
	}
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
