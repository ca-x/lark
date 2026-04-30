package api

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	httppprof "net/http/pprof"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"lark/backend/ent"
	"lark/backend/internal/library"
	"lark/backend/internal/models"
	"lark/backend/pkg/version"

	echo "github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

type Server struct {
	echo                   *echo.Echo
	client                 *ent.Client
	lib                    *library.Service
	mcp                    http.Handler
	ctx                    context.Context
	cancel                 context.CancelFunc
	transcodeCacheLocksMu  sync.Mutex
	transcodeCacheLocks    map[string]*transcodeCacheLock
	transcodeCacheWarmers  sync.Map
	transcodeWarmersMu     sync.Mutex
	transcodeWarmersWG     sync.WaitGroup
	transcodeWarmersActive int
	transcodeWarmTTL       time.Duration
	transcodeWarmLimit     int
	diagnosticsEnabled     atomic.Bool
}

type transcodeCacheLock struct {
	mu   sync.Mutex
	refs int
}

const (
	defaultTranscodeWarmTTL   = 2 * time.Minute
	defaultTranscodeWarmLimit = 2
)

type Option func(*Server)

func WithTranscodeWarmTTL(ttl time.Duration) Option {
	return func(s *Server) {
		s.transcodeWarmTTL = ttl
	}
}

func WithTranscodeWarmLimit(limit int) Option {
	return func(s *Server) {
		s.transcodeWarmLimit = limit
	}
}

type playlistRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	CoverTheme  string `json:"cover_theme"`
}

const sessionCookieName = "lark_session"

const transcodeChunkSize = 512 * 1024

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

type playbackSourceRequest struct {
	Type     string `json:"type"`
	SourceID int    `json:"source_id"`
}

type lyricSelectRequest struct {
	Source string `json:"source"`
	ID     string `json:"id"`
}

type radioSourceRequest struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type libraryDirectoryRequest struct {
	Path string `json:"path"`
	Note string `json:"note"`
}

type libraryDirectoryUpdateRequest struct {
	WatchEnabled bool `json:"watch_enabled"`
}

type networkSourceRequest struct {
	ID       string `json:"id"`
	Provider string `json:"provider"`
	Name     string `json:"name"`
	BaseURL  string `json:"base_url"`
	Username string `json:"username"`
	Password string `json:"password"`
	Token    string `json:"token"`
}

type settingsRequest struct {
	Language               string `json:"language"`
	Theme                  string `json:"theme"`
	SleepTimerMins         int    `json:"sleep_timer_mins"`
	NeteaseFallback        bool   `json:"netease_fallback"`
	RegistrationEnabled    bool   `json:"registration_enabled"`
	DiagnosticsEnabled     bool   `json:"diagnostics_enabled"`
	PlaybackSourceTTLHours int    `json:"playback_source_ttl_hours"`
	WebFontFamily          string `json:"web_font_family"`
	WebFontURL             string `json:"web_font_url"`
	MetadataGrouping       bool   `json:"metadata_grouping"`
	SmartPlaylistsEnabled  bool   `json:"smart_playlists_enabled"`
	SharingEnabled         bool   `json:"sharing_enabled"`
	SubsonicServerEnabled  bool   `json:"subsonic_server_enabled"`
	TranscodePolicy        string `json:"transcode_policy"`
	TranscodeQualityKbps   int    `json:"transcode_quality_kbps"`
}

type shareRequest struct {
	Type      string     `json:"type"`
	ID        int        `json:"id"`
	ExpiresAt *time.Time `json:"expires_at"`
}

type subsonicCredentialRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type authUserResponse struct {
	User models.User `json:"user"`
}

type healthResponse struct {
	Status           string `json:"status"`
	Version          string `json:"version"`
	FullVersion      string `json:"full_version"`
	Commit           string `json:"commit"`
	BuildTime        string `json:"build_time"`
	GoVersion        string `json:"go_version"`
	Library          string `json:"library"`
	AudioBackend     string `json:"audio_backend"`
	MetadataBackend  string `json:"metadata_backend"`
	TranscodeBackend string `json:"transcode_backend"`
}

type scrobblingSettingsRequest struct {
	Enabled     bool   `json:"enabled"`
	Provider    string `json:"provider"`
	Token       string `json:"token"`
	SubmitNow   bool   `json:"submit_now"`
	MinSeconds  int    `json:"min_seconds"`
	PercentGate int    `json:"percent_gate"`
}

func New(client *ent.Client, lib *library.Service, frontendOrigin string, opts ...Option) *Server {
	e := echo.New()
	e.Use(middleware.Recover())
	e.Use(middleware.RequestID())
	cors := middleware.CORSConfig{AllowOrigins: []string{frontendOrigin}, AllowHeaders: []string{"Content-Type", "Range", "Authorization"}, AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions}}
	if frontendOrigin != "*" {
		cors.AllowCredentials = true
	}
	e.Use(middleware.CORSWithConfig(cors))
	s := &Server{echo: e, client: client, lib: lib, transcodeWarmTTL: defaultTranscodeWarmTTL, transcodeWarmLimit: defaultTranscodeWarmLimit}
	for _, opt := range opts {
		if opt != nil {
			opt(s)
		}
	}
	if settings, err := lib.GetSettings(context.Background()); err == nil {
		s.diagnosticsEnabled.Store(settings.DiagnosticsEnabled)
	}
	s.mcp = s.newMCPHandler()

	auth := s.requireAuth
	admin := s.requireAdmin

	e.GET("/api/health", s.handleHealth)
	e.GET("/api/fonts/:name", s.handleWebFont)
	e.GET("/api/auth/status", s.handleAuthStatus)
	e.POST("/api/auth/setup", s.handleSetupAdmin)
	e.POST("/api/auth/login", s.handleLogin)
	e.POST("/api/auth/register", s.handleRegister)
	e.POST("/api/auth/logout", s.handleLogout)
	e.GET("/api/public/shares/:token", s.handlePublicShare)
	e.GET("/api/public/shares/:token/stream/:id", s.handlePublicShareStream)
	e.GET("/api/public/shares/:token/cover/:id", s.handlePublicShareCover)
	e.GET("/rest/:endpoint", s.handleSubsonic)
	e.POST("/rest/:endpoint", s.handleSubsonic)
	e.PUT("/api/me", s.handleUpdateProfile, auth)
	e.GET("/api/me/scrobbling", s.handleGetScrobblingSettings, auth)
	e.PUT("/api/me/scrobbling", s.handleSaveScrobblingSettings, auth)
	e.GET("/api/me/subsonic", s.handleGetSubsonicCredential, auth)
	e.PUT("/api/me/subsonic", s.handleSaveSubsonicCredential, auth)
	e.DELETE("/api/me/subsonic", s.handleDeleteSubsonicCredential, auth)
	e.GET("/api/users", s.handleUsers, admin)
	e.GET("/api/mcp/token", s.handleGetMCPToken, auth)
	e.PUT("/api/mcp/token", s.handleSetMCPToken, auth)
	e.POST("/api/mcp/token/generate", s.handleGenerateMCPToken, auth)
	e.DELETE("/api/mcp/token", s.handleDeleteMCPToken, auth)
	e.GET("/api/mcp/sse", s.handleMCP)
	e.POST("/api/mcp/sse", s.handleMCP)

	e.GET("/api/songs", s.handleSongs, auth)
	e.GET("/api/songs/page", s.handleSongsPage, auth)
	e.GET("/api/songs/recent-played", s.handleRecentPlayedSongs, auth)
	e.GET("/api/songs/recent-added", s.handleRecentAddedSongs, auth)
	e.GET("/api/daily-mix", s.handleDailyMix, auth)
	e.GET("/api/smart-playlists", s.handleSmartPlaylists, auth)
	e.GET("/api/smart-playlists/:id/songs", s.handleSmartPlaylistSongs, auth)
	e.GET("/api/songs/:id", s.handleSong, auth)
	e.POST("/api/songs/:id/favorite", s.handleToggleSongFavorite, auth)
	e.POST("/api/songs/:id/played", s.handleMarkPlayed, auth)
	e.PUT("/api/songs/:id/progress", s.handleSavePlaybackProgress, auth)
	e.GET("/api/playback/source", s.handleGetPlaybackSource, auth)
	e.PUT("/api/playback/source", s.handleSavePlaybackSource, auth)
	e.DELETE("/api/playback/source", s.handleClearPlaybackSource, auth)
	e.GET("/api/shares", s.handleListShares, auth)
	e.POST("/api/shares", s.handleCreateShare, auth)
	e.PATCH("/api/shares/:token", s.handleUpdateShare, auth)
	e.DELETE("/api/shares/:token", s.handleDeleteShare, auth)
	e.GET("/api/songs/:id/stream", s.handleStream, auth)
	e.GET("/api/songs/:id/cover", s.handleCover, auth)
	e.GET("/api/songs/:id/lyrics/candidates", s.handleLyricCandidates, auth)
	e.POST("/api/songs/:id/lyrics/select", s.handleSelectLyrics, auth)
	e.GET("/api/songs/:id/lyrics", s.handleLyrics, auth)

	e.POST("/api/library/scan", s.handleScan, admin)
	e.POST("/api/library/scan/cancel", s.handleCancelScan, admin)
	e.GET("/api/library/scan/status", s.handleScanStatus, admin)
	e.GET("/api/library/stats", s.handleLibraryStats, auth)
	e.GET("/api/library/sources", s.handleLibrarySources, auth)
	e.GET("/api/library/directories", s.handleLibraryDirectories, auth)
	e.POST("/api/library/directories/check", s.handleCheckLibraryDirectories, auth)
	e.POST("/api/library/directories", s.handleAddLibraryDirectory, auth)
	e.PATCH("/api/library/directories/:id", s.handleUpdateLibraryDirectory, auth)
	e.DELETE("/api/library/directories/:id", s.handleDeleteLibraryDirectory, auth)
	e.GET("/api/network/sources", s.handleNetworkSources, auth)
	e.POST("/api/network/sources", s.handleUpsertNetworkSource, admin)
	e.DELETE("/api/network/sources/:id", s.handleDeleteNetworkSource, admin)
	e.POST("/api/network/sources/:id/test", s.handleTestNetworkSource, admin)
	e.GET("/api/network/sources/:id/search", s.handleSearchNetworkTracks, auth)
	e.GET("/api/network/sources/:id/tracks/:track/stream", s.handleNetworkTrackStream, auth)
	e.GET("/api/radio/sources", s.handleRadioSources, auth)
	e.POST("/api/radio/sources", s.handleAddRadioSource, admin)
	e.DELETE("/api/radio/sources/:id", s.handleDeleteRadioSource, admin)
	e.GET("/api/radio/favorites", s.handleRadioFavorites, auth)
	e.POST("/api/radio/favorite", s.handleToggleRadioFavorite, auth)
	e.GET("/api/radio/sources/:id/stream", s.handleRadioSourceStream, auth)
	e.GET("/api/radio/stream", s.handleRadioStream, auth)
	e.GET("/api/radio/top", s.handleTopRadioStations, auth)
	e.GET("/api/radio/search", s.handleSearchRadioStations, auth)
	e.POST("/api/library/upload", s.handleUpload, admin)
	e.GET("/api/folders", s.handleFolders, auth)
	e.GET("/api/folders/tree", s.handleFolderDirectory, auth)
	e.GET("/api/folders/songs", s.handleFolderSongs, auth)
	e.GET("/api/fonts", s.handleWebFonts, admin)
	e.POST("/api/fonts", s.handleUploadWebFont, admin)
	e.DELETE("/api/fonts/:name", s.handleDeleteWebFont, admin)

	e.GET("/api/albums", s.handleAlbums, auth)
	e.GET("/api/albums/page", s.handleAlbumsPage, auth)
	e.GET("/api/albums/favorites", s.handleFavoriteAlbums, auth)
	e.GET("/api/albums/:id", s.handleAlbum, auth)
	e.GET("/api/albums/:id/cover", s.handleAlbumCover, auth)
	e.GET("/api/albums/:id/songs", s.handleAlbumSongs, auth)
	e.GET("/api/artists", s.handleArtists, auth)
	e.GET("/api/artists/favorites", s.handleFavoriteArtists, auth)
	e.GET("/api/artists/page", s.handleArtistsPage, auth)
	e.GET("/api/artists/search", s.handleSearchArtists, auth)
	e.GET("/api/artists/:id/cover", s.handleArtistCover, auth)
	e.GET("/api/artists/:id/songs", s.handleArtistSongs, auth)
	e.POST("/api/albums/:id/favorite", s.handleToggleAlbumFavorite, auth)
	e.POST("/api/artists/:id/favorite", s.handleToggleArtistFavorite, auth)

	e.GET("/api/playlists", s.handlePlaylists, auth)
	e.GET("/api/playlists/page", s.handlePlaylistsPage, auth)
	e.POST("/api/playlists", s.handleCreatePlaylist, auth)
	e.GET("/api/playlists/:id/songs", s.handlePlaylistSongs, auth)
	e.POST("/api/playlists/:id/songs/:song", s.handleAddSongToPlaylist, auth)
	e.DELETE("/api/playlists/:id/songs/:song", s.handleRemoveSongFromPlaylist, auth)

	e.GET("/api/settings", s.handleGetSettings, auth)
	e.PUT("/api/settings", s.handleSaveSettings, admin)
	e.GET("/api/debug/pprof", s.handlePprof, admin)
	e.GET("/api/debug/pprof/*", s.handlePprof, admin)
	e.POST("/api/debug/pprof/symbol", s.handlePprof, admin)
	s.registerFrontendRoutes()
	return s
}

func (s *Server) Start(addr string) error {
	ctx, cancel := context.WithCancel(context.Background())
	s.ctx = ctx
	s.cancel = cancel
	if err := s.lib.StartLibraryWatchers(ctx); err != nil {
		cancel()
		return err
	}
	return echo.StartConfig{Address: addr, HideBanner: true, GracefulTimeout: 10}.Start(ctx, s.echo)
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.cancel != nil {
		s.cancel()
	}
	s.lib.StopLibraryWatchers(ctx)
	s.transcodeWarmersMu.Lock()
	s.transcodeWarmersMu.Unlock()
	done := make(chan struct{})
	go func() {
		s.transcodeWarmersWG.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Server) handleHealth(c *echo.Context) error {
	return c.JSON(http.StatusOK, healthResponse{
		Status:           "ok",
		Version:          version.GetVersion(),
		FullVersion:      version.GetFullVersion(),
		Commit:           version.GitCommit,
		BuildTime:        version.BuildTime,
		GoVersion:        runtime.Version(),
		Library:          s.lib.LibraryDir(),
		AudioBackend:     "pure-go-http-range",
		MetadataBackend:  "dhowden/tag+ffprobe-optional",
		TranscodeBackend: "ffmpeg-cli-optional",
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
	return c.JSON(http.StatusCreated, authUserResponse{User: user})
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
	return c.JSON(http.StatusOK, authUserResponse{User: user})
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
	return c.JSON(http.StatusCreated, authUserResponse{User: user})
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

func (s *Server) handleGetScrobblingSettings(c *echo.Context) error {
	settings, err := s.lib.GetScrobblingSettings(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, settings)
}

func (s *Server) handleSaveScrobblingSettings(c *echo.Context) error {
	var req scrobblingSettingsRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	settings, err := s.lib.SaveScrobblingSettings(c.Request().Context(), currentUserID(c), models.ScrobblingSettings{
		Enabled:     req.Enabled,
		Provider:    req.Provider,
		SubmitNow:   req.SubmitNow,
		MinSeconds:  req.MinSeconds,
		PercentGate: req.PercentGate,
	}, req.Token)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, settings)
}

func (s *Server) handleGetSubsonicCredential(c *echo.Context) error {
	status, err := s.lib.GetSubsonicCredentialStatus(c.Request().Context(), currentUserID(c), requestBaseURL(c)+"/rest")
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleSaveSubsonicCredential(c *echo.Context) error {
	var req subsonicCredentialRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	status, err := s.lib.SaveSubsonicCredential(c.Request().Context(), currentUserID(c), req.Username, req.Password, requestBaseURL(c)+"/rest")
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleDeleteSubsonicCredential(c *echo.Context) error {
	status, err := s.lib.DeleteSubsonicCredential(c.Request().Context(), currentUserID(c), requestBaseURL(c)+"/rest")
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, status)
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

func (s *Server) handleSongsPage(c *echo.Context) error {
	limit := queryInt(c, "limit", 100)
	favorites := c.QueryParam("favorites") == "true"
	items, err := s.lib.SongsPage(c.Request().Context(), currentUserID(c), c.QueryParam("q"), favorites, limit, pageOffset(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleRecentPlayedSongs(c *echo.Context) error {
	items, err := s.lib.RecentPlayedSongs(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 12))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleRecentAddedSongs(c *echo.Context) error {
	items, err := s.lib.RecentAddedSongs(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 12))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleDailyMix(c *echo.Context) error {
	items, err := s.lib.DailyMix(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 24))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleSmartPlaylists(c *echo.Context) error {
	items, err := s.lib.SmartPlaylists(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleSmartPlaylistSongs(c *echo.Context) error {
	items, err := s.lib.SmartPlaylistSongs(c.Request().Context(), currentUserID(c), c.Param("id"), queryInt(c, "limit", 50))
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

func (s *Server) handleLibraryStats(c *echo.Context) error {
	stats, err := s.lib.LibraryStats(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, stats)
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

func (s *Server) handleCreateShare(c *echo.Context) error {
	var req shareRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	share, err := s.lib.CreateShare(c.Request().Context(), currentUserID(c), req.Type, req.ID, req.ExpiresAt, requestBaseURL(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusCreated, share)
}

func (s *Server) handleListShares(c *echo.Context) error {
	shares, err := s.lib.ListShares(c.Request().Context(), currentUserID(c), requestBaseURL(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, shares)
}

func (s *Server) handleDeleteShare(c *echo.Context) error {
	if err := s.lib.DeleteShare(c.Request().Context(), currentUserID(c), c.Param("token")); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handleUpdateShare(c *echo.Context) error {
	var req shareRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	share, err := s.lib.UpdateShare(c.Request().Context(), currentUserID(c), c.Param("token"), req.ExpiresAt, requestBaseURL(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, share)
}

func (s *Server) handlePublicShare(c *echo.Context) error {
	share, err := s.lib.PublicShare(c.Request().Context(), c.Param("token"), requestBaseURL(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, share)
}

func (s *Server) handlePublicShareStream(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	if err := s.lib.ShareAllowsSong(c.Request().Context(), c.Param("token"), id); err != nil {
		return mapError(err)
	}
	return s.streamSong(c, id)
}

func (s *Server) handlePublicShareCover(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	if err := s.lib.ShareAllowsSong(c.Request().Context(), c.Param("token"), id); err != nil {
		return mapError(err)
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

func (s *Server) handleGetPlaybackSource(c *echo.Context) error {
	source, err := s.lib.PlaybackSource(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, models.PlaybackSourceStatus{Source: source})
}

func (s *Server) handleSavePlaybackSource(c *echo.Context) error {
	var req playbackSourceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	sourceType := strings.ToLower(strings.TrimSpace(req.Type))
	if req.SourceID <= 0 || (sourceType != "album" && sourceType != "artist") {
		return echo.NewHTTPError(http.StatusBadRequest, "playback source must be album or artist")
	}
	source, err := s.lib.SavePlaybackSource(c.Request().Context(), currentUserID(c), sourceType, req.SourceID)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, models.PlaybackSourceStatus{Source: &source})
}

func (s *Server) handleClearPlaybackSource(c *echo.Context) error {
	if err := s.lib.ClearPlaybackSource(c.Request().Context(), currentUserID(c)); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handleStream(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	return s.streamSong(c, id)
}

func (s *Server) streamSong(c *echo.Context, id int) error {
	item, err := s.lib.RawSong(c.Request().Context(), id)
	if err != nil {
		return mapError(err)
	}
	mode := strings.ToLower(strings.TrimSpace(c.QueryParam("mode")))
	if mode == "" {
		mode = "auto"
	}
	if c.QueryParam("quality") == "" {
		if settings, err := s.lib.GetSettings(c.Request().Context()); err == nil {
			q := c.Request().URL.Query()
			q.Set("quality", strconv.Itoa(settings.TranscodeQualityKbps))
			c.Request().URL.RawQuery = q.Encode()
		}
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
	quality, err := transcodeQuality(c.QueryParam("quality"))
	if err != nil {
		return err
	}
	start := queryFloat(c, "start", 0)
	if queryBool(c, "cache") {
		cachePath, err := s.transcodeCachePath(sourcePath, quality)
		if err != nil {
			return mapError(err)
		}
		if start == 0 && validCachedFile(cachePath) {
			c.Response().Header().Set("Accept-Ranges", "bytes")
			c.Response().Header().Set("Cache-Control", "private, max-age=86400")
			c.Response().Header().Set("Content-Type", "audio/mpeg")
			c.Response().Header().Set("X-Lark-Transcoded", fmt.Sprintf("ffmpeg-mp3-%dk-cache", quality))
			http.ServeFile(c.Response(), c.Request(), cachePath)
			return nil
		}
		s.startTranscodeCacheWarm(ffmpeg, sourcePath, quality)
	}
	return s.pipeTranscodedAudio(c, ffmpeg, sourcePath, quality, start)
}

func transcodeQuality(raw string) (int, error) {
	quality := 320
	if requested := strings.TrimSpace(raw); requested != "" {
		parsed, err := strconv.Atoi(requested)
		if err != nil {
			return 0, echo.NewHTTPError(http.StatusBadRequest, "quality must be a bitrate in kbps")
		}
		switch {
		case parsed < 96:
			quality = 96
		case parsed > 320:
			quality = 320
		default:
			quality = parsed
		}
	}
	return quality, nil
}

func prepareExternalCommand(cmd *exec.Cmd) {
	prepareExternalProcessGroup(cmd)
	cmd.Cancel = func() error {
		terminateExternalCommand(cmd)
		return nil
	}
	cmd.WaitDelay = 5 * time.Second
}

func terminateExternalCommand(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		return
	}
	if terminateExternalProcessGroup(cmd) {
		return
	}
	_ = cmd.Process.Kill()
}

func (s *Server) pipeTranscodedAudio(c *echo.Context, ffmpeg, sourcePath string, quality int, start float64) error {
	ctx, cancel := context.WithCancel(c.Request().Context())
	defer cancel()
	args := []string{"-hide_banner", "-loglevel", "error"}
	if start > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", start))
	}
	args = append(args,
		"-i", sourcePath,
		"-vn",
		"-map", "0:a:0",
		"-acodec", "libmp3lame",
		"-b:a", fmt.Sprintf("%dk", quality),
		"-flush_packets", "1",
		"-f", "mp3",
		"pipe:1",
	)
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	prepareExternalCommand(cmd)
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
		terminateExternalCommand(cmd)
		_ = cmd.Wait()
	}()
	c.Response().Header().Set("Content-Type", "audio/mpeg")
	c.Response().Header().Set("Cache-Control", "no-store")
	c.Response().Header().Set("X-Lark-Transcoded", fmt.Sprintf("ffmpeg-mp3-%dk", quality))
	c.Response().WriteHeader(http.StatusOK)
	_, copyErr := io.Copy(c.Response(), stdout)
	return copyErr
}

func (s *Server) startTranscodeCacheWarm(ffmpeg, sourcePath string, quality int) {
	ttl := s.transcodeWarmTTL
	if ttl <= 0 || s.transcodeWarmLimit <= 0 {
		return
	}
	parent := s.ctx
	if parent == nil {
		parent = context.Background()
	}
	select {
	case <-parent.Done():
		return
	default:
	}
	cachePath, err := s.transcodeCachePath(sourcePath, quality)
	if err != nil {
		return
	}
	select {
	case <-parent.Done():
		return
	default:
	}
	if !s.reserveTranscodeWarmer(cachePath) {
		return
	}
	acquired, err := s.lib.TryAcquireTranscodeWarmLease(parent, cachePath, ttl)
	if err != nil || !acquired {
		s.releaseTranscodeWarmer(cachePath)
		return
	}
	s.transcodeWarmersWG.Add(1)
	go func() {
		defer s.transcodeWarmersWG.Done()
		defer s.releaseTranscodeWarmer(cachePath)
		ctx, cancel := context.WithTimeout(parent, ttl)
		defer cancel()
		_, _ = s.ensureTranscodeCache(ctx, ffmpeg, sourcePath, quality)
	}()
}

func (s *Server) reserveTranscodeWarmer(cachePath string) bool {
	s.transcodeWarmersMu.Lock()
	defer s.transcodeWarmersMu.Unlock()
	if _, loaded := s.transcodeCacheWarmers.Load(cachePath); loaded {
		return false
	}
	if s.transcodeWarmersActive >= s.transcodeWarmLimit {
		return false
	}
	s.transcodeCacheWarmers.Store(cachePath, struct{}{})
	s.transcodeWarmersActive++
	return true
}

func (s *Server) releaseTranscodeWarmer(cachePath string) {
	s.transcodeWarmersMu.Lock()
	defer s.transcodeWarmersMu.Unlock()
	if _, loaded := s.transcodeCacheWarmers.LoadAndDelete(cachePath); loaded && s.transcodeWarmersActive > 0 {
		s.transcodeWarmersActive--
	}
}

func (s *Server) ensureTranscodeCache(ctx context.Context, ffmpeg, sourcePath string, quality int) (string, error) {
	cachePath, err := s.transcodeCachePath(sourcePath, quality)
	if err != nil {
		return "", mapError(err)
	}
	lock := s.acquireTranscodeCacheLock(cachePath)
	defer s.releaseTranscodeCacheLock(cachePath, lock)
	if validCachedFile(cachePath) {
		return cachePath, nil
	}
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		return "", mapError(err)
	}
	tmpPath := fmt.Sprintf("%s.%d.tmp", cachePath, time.Now().UnixNano())
	defer os.Remove(tmpPath)
	cmd := exec.CommandContext(ctx, ffmpeg,
		"-hide_banner", "-loglevel", "error",
		"-i", sourcePath,
		"-vn",
		"-map", "0:a:0",
		"-map_metadata", "0",
		"-acodec", "libmp3lame",
		"-b:a", fmt.Sprintf("%dk", quality),
		"-write_xing", "0",
		"-f", "mp3",
		tmpPath,
	)
	prepareExternalCommand(cmd)
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return "", echo.NewHTTPError(http.StatusUnsupportedMediaType, "unable to build playback cache: "+err.Error())
	}
	if !validCachedFile(tmpPath) {
		return "", echo.NewHTTPError(http.StatusUnsupportedMediaType, "transcoded playback cache is empty")
	}
	if err := os.Rename(tmpPath, cachePath); err != nil {
		return "", mapError(err)
	}
	return cachePath, nil
}

func (s *Server) acquireTranscodeCacheLock(cachePath string) *transcodeCacheLock {
	s.transcodeCacheLocksMu.Lock()
	if s.transcodeCacheLocks == nil {
		s.transcodeCacheLocks = make(map[string]*transcodeCacheLock)
	}
	lock := s.transcodeCacheLocks[cachePath]
	if lock == nil {
		lock = &transcodeCacheLock{}
		s.transcodeCacheLocks[cachePath] = lock
	}
	lock.refs++
	s.transcodeCacheLocksMu.Unlock()

	lock.mu.Lock()
	return lock
}

func (s *Server) releaseTranscodeCacheLock(cachePath string, lock *transcodeCacheLock) {
	lock.mu.Unlock()

	s.transcodeCacheLocksMu.Lock()
	defer s.transcodeCacheLocksMu.Unlock()
	lock.refs--
	if lock.refs == 0 && s.transcodeCacheLocks[cachePath] == lock {
		delete(s.transcodeCacheLocks, cachePath)
	}
}

func (s *Server) transcodeCachePath(sourcePath string, quality int) (string, error) {
	info, err := os.Stat(sourcePath)
	if err != nil {
		return "", err
	}
	abs, err := filepath.Abs(sourcePath)
	if err != nil {
		return "", err
	}
	seed := fmt.Sprintf("%s:%d:%d:%d", abs, info.Size(), info.ModTime().UnixNano(), quality)
	sum := sha1.Sum([]byte(seed))
	name := hex.EncodeToString(sum[:]) + fmt.Sprintf("-%dk.mp3", quality)
	return filepath.Join(s.lib.DataDir(), "transcodes", name), nil
}

func validCachedFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Size() >= transcodeChunkSize/4
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
	result, err := s.lib.Scan(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, result)
}

func (s *Server) handleScanStatus(c *echo.Context) error {
	return c.JSON(http.StatusOK, s.lib.ScanStatus())
}

func (s *Server) handleCancelScan(c *echo.Context) error {
	return c.JSON(http.StatusOK, map[string]bool{"canceled": s.lib.CancelScan()})
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

func (s *Server) handleFolders(c *echo.Context) error {
	items, err := s.lib.Folders(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 12))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleFolderDirectory(c *echo.Context) error {
	item, err := s.lib.FolderDirectory(c.Request().Context(), currentUserID(c), c.QueryParam("path"))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleFolderSongs(c *echo.Context) error {
	items, err := s.lib.FolderSongs(c.Request().Context(), currentUserID(c), c.QueryParam("path"), queryInt(c, "limit", 0))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleAlbums(c *echo.Context) error {
	items, err := s.lib.Albums(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 0))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleAlbumsPage(c *echo.Context) error {
	items, err := s.lib.AlbumsPage(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 100), pageOffset(c), queryInt(c, "artist_id", 0))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleFavoriteAlbums(c *echo.Context) error {
	items, err := s.lib.FavoriteAlbums(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 500))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleAlbum(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	item, err := s.lib.Album(c.Request().Context(), currentUserID(c), id)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleAlbumSongs(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	items, err := s.lib.AlbumSongs(c.Request().Context(), currentUserID(c), id, queryInt(c, "limit", 0))
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
	items, err := s.lib.Artists(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 0))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleFavoriteArtists(c *echo.Context) error {
	items, err := s.lib.FavoriteArtists(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 500))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleArtistsPage(c *echo.Context) error {
	items, err := s.lib.ArtistsPage(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 100), pageOffset(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleSearchArtists(c *echo.Context) error {
	items, err := s.lib.SearchArtists(c.Request().Context(), currentUserID(c), c.QueryParam("q"), queryInt(c, "limit", 20))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleToggleArtistFavorite(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	item, err := s.lib.ToggleArtistFavorite(c.Request().Context(), currentUserID(c), id)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleArtistSongs(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	items, err := s.lib.ArtistSongs(c.Request().Context(), currentUserID(c), id, queryInt(c, "limit", 0))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handlePlaylists(c *echo.Context) error {
	items, err := s.lib.Playlists(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 0))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handlePlaylistsPage(c *echo.Context) error {
	items, err := s.lib.PlaylistsPage(c.Request().Context(), currentUserID(c), queryInt(c, "limit", 100), pageOffset(c))
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
	items, err := s.lib.PlaylistSongs(c.Request().Context(), currentUserID(c), id, queryInt(c, "limit", 0))
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

func (s *Server) handleWebFonts(c *echo.Context) error {
	fonts, err := s.lib.ListWebFonts(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, fonts)
}

func (s *Server) handleUploadWebFont(c *echo.Context) error {
	file, err := c.FormFile("font")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "font file is required")
	}
	settings, err := s.lib.UploadWebFont(c.Request().Context(), file)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, settings)
}

func (s *Server) handleDeleteWebFont(c *echo.Context) error {
	settings, err := s.lib.DeleteWebFont(c.Request().Context(), c.Param("name"))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, settings)
}

func (s *Server) handleWebFont(c *echo.Context) error {
	data, contentType, err := s.lib.LoadWebFont(c.Request().Context(), c.Param("name"))
	if err != nil {
		return mapError(err)
	}
	c.Response().Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	return c.Blob(http.StatusOK, contentType, data)
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
	settings, err := s.lib.SaveSettings(c.Request().Context(), models.Settings{
		Language:               req.Language,
		Theme:                  req.Theme,
		SleepTimerMins:         req.SleepTimerMins,
		LibraryPath:            s.lib.LibraryDir(),
		NeteaseFallback:        req.NeteaseFallback,
		RegistrationEnabled:    req.RegistrationEnabled,
		DiagnosticsEnabled:     req.DiagnosticsEnabled,
		PlaybackSourceTTLHours: req.PlaybackSourceTTLHours,
		WebFontFamily:          req.WebFontFamily,
		WebFontURL:             req.WebFontURL,
		MetadataGrouping:       req.MetadataGrouping,
		SmartPlaylistsEnabled:  req.SmartPlaylistsEnabled,
		SharingEnabled:         req.SharingEnabled,
		SubsonicServerEnabled:  req.SubsonicServerEnabled,
		TranscodePolicy:        req.TranscodePolicy,
		TranscodeQualityKbps:   req.TranscodeQualityKbps,
	})
	if err != nil {
		return mapError(err)
	}
	s.diagnosticsEnabled.Store(settings.DiagnosticsEnabled)
	return c.JSON(http.StatusOK, settings)
}

func (s *Server) handlePprof(c *echo.Context) error {
	if !s.diagnosticsEnabled.Load() {
		return echo.NewHTTPError(http.StatusForbidden, "diagnostics are disabled")
	}
	suffix := strings.TrimPrefix(c.Request().URL.Path, "/api/debug/pprof")
	switch suffix {
	case "", "/":
		httppprof.Index(c.Response(), c.Request())
	case "/cmdline":
		httppprof.Cmdline(c.Response(), c.Request())
	case "/profile":
		httppprof.Profile(c.Response(), c.Request())
	case "/symbol":
		httppprof.Symbol(c.Response(), c.Request())
	case "/trace":
		httppprof.Trace(c.Response(), c.Request())
	default:
		httppprof.Handler(strings.TrimPrefix(suffix, "/")).ServeHTTP(c.Response(), c.Request())
	}
	return nil
}

func paramInt(c *echo.Context, name string) (int, error) {
	id, err := strconv.Atoi(c.Param(name))
	if err != nil {
		return 0, echo.NewHTTPError(http.StatusBadRequest, "invalid "+name)
	}
	return id, nil
}
func queryBool(c *echo.Context, name string) bool {
	switch strings.ToLower(strings.TrimSpace(c.QueryParam(name))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func queryFloat(c *echo.Context, name string, fallback float64) float64 {
	raw := strings.TrimSpace(c.QueryParam(name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil || n < 0 {
		return fallback
	}
	return n
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

func pageOffset(c *echo.Context) int {
	limit := queryInt(c, "limit", 100)
	page := queryInt(c, "page", 1)
	if page < 1 {
		page = 1
	}
	return queryInt(c, "offset", (page-1)*limit)
}

func requestBaseURL(c *echo.Context) string {
	req := c.Request()
	proto := strings.TrimSpace(req.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		proto = "http"
		if req.TLS != nil {
			proto = "https"
		}
	}
	host := strings.TrimSpace(req.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = req.Host
	}
	if host == "" {
		return ""
	}
	return proto + "://" + host
}

func mapError(err error) error {
	if errors.Is(err, library.ErrUnauthenticated) {
		return echo.NewHTTPError(http.StatusUnauthorized, "unauthenticated")
	}
	if errors.Is(err, library.ErrForbidden) {
		return echo.NewHTTPError(http.StatusForbidden, "forbidden")
	}
	if errors.Is(err, library.ErrScanRunning) {
		return echo.NewHTTPError(http.StatusConflict, "library scan already running")
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

func (s *Server) handleLibraryDirectories(c *echo.Context) error {
	items, err := s.lib.LibraryDirectories(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleCheckLibraryDirectories(c *echo.Context) error {
	items, err := s.lib.CheckLibraryDirectories(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleAddLibraryDirectory(c *echo.Context) error {
	var req libraryDirectoryRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	item, err := s.lib.AddLibraryDirectory(c.Request().Context(), currentUserID(c), req.Path, req.Note)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusCreated, item)
}

func (s *Server) handleUpdateLibraryDirectory(c *echo.Context) error {
	var req libraryDirectoryUpdateRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if c.Param("id") == "env" {
		u := currentUser(c)
		if u == nil || u.Role != "admin" {
			return mapError(library.ErrForbidden)
		}
	}
	item, err := s.lib.UpdateLibraryDirectory(c.Request().Context(), currentUserID(c), c.Param("id"), req.WatchEnabled)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleDeleteLibraryDirectory(c *echo.Context) error {
	id, err := paramInt(c, "id")
	if err != nil {
		return err
	}
	if err := s.lib.DeleteLibraryDirectory(c.Request().Context(), currentUserID(c), id); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handleLibrarySources(c *echo.Context) error {
	return c.JSON(http.StatusOK, s.lib.LibrarySources(c.Request().Context()))
}

func (s *Server) handleNetworkSources(c *echo.Context) error {
	items, err := s.lib.NetworkSources(c.Request().Context())
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleUpsertNetworkSource(c *echo.Context) error {
	var req networkSourceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	item, err := s.lib.UpsertNetworkSource(c.Request().Context(), models.NetworkSource{
		ID:       req.ID,
		Provider: req.Provider,
		Name:     req.Name,
		BaseURL:  req.BaseURL,
		Username: req.Username,
		Password: req.Password,
		Token:    req.Token,
	})
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusCreated, item)
}

func (s *Server) handleDeleteNetworkSource(c *echo.Context) error {
	if err := s.lib.DeleteNetworkSource(c.Request().Context(), c.Param("id")); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handleTestNetworkSource(c *echo.Context) error {
	item, err := s.lib.TestNetworkSource(c.Request().Context(), c.Param("id"))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleSearchNetworkTracks(c *echo.Context) error {
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	items, err := s.lib.SearchNetworkTracks(c.Request().Context(), c.Param("id"), c.QueryParam("q"), limit)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleNetworkTrackStream(c *echo.Context) error {
	streamURL, err := s.lib.NetworkTrackStreamURL(c.Request().Context(), c.Param("id"), c.Param("track"))
	if err != nil {
		return mapError(err)
	}
	return c.Redirect(http.StatusTemporaryRedirect, streamURL)
}

func (s *Server) handleRadioSources(c *echo.Context) error {
	items, err := s.lib.RadioSources(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleAddRadioSource(c *echo.Context) error {
	var req radioSourceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	item, err := s.lib.AddRadioSource(c.Request().Context(), req.Name, req.URL)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusCreated, item)
}

func (s *Server) handleDeleteRadioSource(c *echo.Context) error {
	if err := s.lib.DeleteRadioSource(c.Request().Context(), c.Param("id")); err != nil {
		return mapError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handleRadioFavorites(c *echo.Context) error {
	items, err := s.lib.RadioFavorites(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleToggleRadioFavorite(c *echo.Context) error {
	var req models.RadioStation
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	item, err := s.lib.ToggleRadioFavorite(c.Request().Context(), currentUserID(c), req)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, item)
}

func (s *Server) handleRadioStream(c *echo.Context) error {
	streamURL := strings.TrimSpace(c.QueryParam("url"))
	if !validRemoteStreamURL(streamURL) {
		return echo.NewHTTPError(http.StatusBadRequest, "valid radio stream url is required")
	}
	ffmpeg := strings.TrimSpace(s.lib.FFmpegBin())
	if ffmpeg == "" {
		return c.Redirect(http.StatusTemporaryRedirect, streamURL)
	}
	quality, err := transcodeQuality(c.QueryParam("quality"))
	if err != nil {
		return err
	}
	return s.pipeRemoteRadio(c, ffmpeg, streamURL, quality)
}

func validRemoteStreamURL(value string) bool {
	u, err := url.Parse(strings.TrimSpace(value))
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func (s *Server) handleRadioSourceStream(c *echo.Context) error {
	item, err := s.lib.RadioSource(c.Request().Context(), c.Param("id"))
	if err != nil {
		return mapError(err)
	}
	streamURL := strings.TrimSpace(item.URL)
	if streamURL == "" {
		return echo.NewHTTPError(http.StatusNotFound, "radio source stream not found")
	}
	ffmpeg := strings.TrimSpace(s.lib.FFmpegBin())
	if ffmpeg == "" {
		return c.Redirect(http.StatusTemporaryRedirect, streamURL)
	}
	quality, err := transcodeQuality(c.QueryParam("quality"))
	if err != nil {
		return err
	}
	return s.pipeRemoteRadio(c, ffmpeg, streamURL, quality)
}

func (s *Server) pipeRemoteRadio(c *echo.Context, ffmpeg, streamURL string, quality int) error {
	ctx, cancel := context.WithCancel(c.Request().Context())
	defer cancel()
	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-reconnect", "1",
		"-reconnect_streamed", "1",
		"-reconnect_delay_max", "5",
		"-user_agent", library.RadioUserAgent(),
		"-i", streamURL,
		"-vn",
		"-map", "0:a:0",
		"-acodec", "libmp3lame",
		"-b:a", fmt.Sprintf("%dk", quality),
		"-flush_packets", "1",
		"-f", "mp3",
		"pipe:1",
	}
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	prepareExternalCommand(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return mapError(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return c.Redirect(http.StatusTemporaryRedirect, streamURL)
	}
	defer func() {
		_ = stdout.Close()
		terminateExternalCommand(cmd)
		_ = cmd.Wait()
	}()
	c.Response().Header().Set("Content-Type", "audio/mpeg")
	c.Response().Header().Set("Cache-Control", "no-store")
	c.Response().Header().Set("X-Lark-Radio-Proxy", fmt.Sprintf("ffmpeg-mp3-%dk", quality))
	c.Response().WriteHeader(http.StatusOK)
	_, copyErr := io.Copy(c.Response(), stdout)
	return copyErr
}

func (s *Server) handleTopRadioStations(c *echo.Context) error {
	offset, _ := strconv.Atoi(c.QueryParam("offset"))
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	items, err := s.lib.TopRadioStations(c.Request().Context(), currentUserID(c), offset, limit)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}

func (s *Server) handleSearchRadioStations(c *echo.Context) error {
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	items, err := s.lib.SearchRadioStations(c.Request().Context(), currentUserID(c), c.QueryParam("q"), limit)
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, items)
}
