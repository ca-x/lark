package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"lark/backend/internal/mygo"
	"lark/backend/internal/pluginapp"
	"lark/backend/internal/pluginruntime"

	echo "github.com/labstack/echo/v5"
)

func WithPluginPlatform(platform *pluginapp.Service, service *mygo.Service, catalog *mygo.Catalog) Option {
	return func(server *Server) {
		server.pluginPlatform = platform
		server.mygo = service
		server.mygoCatalog = catalog
	}
}

func (s *Server) registerPluginPlatformRoutes() {
	if s.pluginPlatform == nil || s.mygo == nil {
		return
	}
	s.echo.GET("/api/plugin-platform", func(c *echo.Context) error { return c.JSON(http.StatusOK, s.pluginPlatform.Status()) }, s.requireAuth)
	s.echo.PATCH("/api/plugin-platform", func(c *echo.Context) error {
		var patch pluginapp.Patch
		if err := decodePluginJSON(c, &patch); err != nil || (patch.Songloft == nil && patch.MyGo == nil) {
			return echo.NewHTTPError(http.StatusBadRequest, "ecosystem switch required")
		}
		if err := s.pluginPlatform.Patch(c.Request().Context(), patch); err != nil {
			return mygoHTTPError(err)
		}
		return c.JSON(http.StatusOK, s.pluginPlatform.Status())
	}, s.requireAdmin)
	s.echo.PUT("/api/plugin-platform", func(c *echo.Context) error {
		var state struct {
			Songloft *bool `json:"songloft"`
			MyGo     *bool `json:"mygo"`
		}
		if err := decodePluginJSON(c, &state); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid platform state")
		}
		if state.Songloft == nil || state.MyGo == nil {
			return echo.NewHTTPError(http.StatusBadRequest, "both ecosystem switches are required")
		}
		if err := s.pluginPlatform.Set(c.Request().Context(), pluginapp.State{Songloft: *state.Songloft, MyGo: *state.MyGo}); err != nil {
			return mygoHTTPError(err)
		}
		return c.JSON(http.StatusOK, s.pluginPlatform.State())
	}, s.requireAdmin)
	s.echo.GET("/api/mygo/plugins", func(c *echo.Context) error { return c.JSON(http.StatusOK, map[string]any{"plugins": s.mygo.List()}) }, s.requireAuth)
	s.echo.GET("/api/mygo/queue", func(c *echo.Context) error {
		contents, err := s.mygo.Queue(c.Request().Context(), currentUserID(c))
		if err != nil {
			return mygoHTTPError(err)
		}
		return c.Blob(http.StatusOK, "application/json", contents)
	}, s.requireAuth)
	s.echo.PUT("/api/mygo/queue", func(c *echo.Context) error {
		contents, err := io.ReadAll(http.MaxBytesReader(c.Response(), c.Request().Body, 1<<20))
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "queue exceeds limit")
		}
		if err := s.mygo.SaveQueue(c.Request().Context(), currentUserID(c), contents); err != nil {
			return mygoHTTPError(err)
		}
		return c.NoContent(http.StatusNoContent)
	}, s.requireAuth)
	s.echo.GET("/api/mygo/marketplace", func(c *echo.Context) error {
		items, err := s.mygoCatalog.Search(c.Request().Context())
		if err != nil {
			return mygoHTTPError(err)
		}
		return c.JSON(http.StatusOK, map[string]any{"plugins": items, "cache": s.mygoCatalog.Status()})
	}, s.requireAdmin)
	s.echo.POST("/api/mygo/preview", s.handleMygoRepositoryPreview, s.requireAdmin)
	s.echo.POST("/api/mygo/upload-preview", func(c *echo.Context) error {
		contents, err := io.ReadAll(http.MaxBytesReader(c.Response(), c.Request().Body, 50<<20))
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "package exceeds upload limit")
		}
		preview, err := s.mygo.Preview(c.Request().Context(), contents, "uploaded ZIP")
		if err != nil {
			return mygoHTTPError(err)
		}
		return c.JSON(http.StatusOK, preview)
	}, s.requireAdmin)
	s.echo.POST("/api/mygo/install", func(c *echo.Context) error {
		var request struct {
			Token string `json:"token"`
		}
		if err := decodePluginJSON(c, &request); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid install confirmation")
		}
		item, err := s.mygo.Install(c.Request().Context(), request.Token)
		if err != nil {
			return mygoHTTPError(err)
		}
		return c.JSON(http.StatusCreated, item)
	}, s.requireAdmin)
	s.echo.PUT("/api/mygo/plugins/:id/enabled", func(c *echo.Context) error {
		var request struct {
			Enabled bool `json:"enabled"`
		}
		if err := decodePluginJSON(c, &request); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid plugin state")
		}
		if err := s.mygo.SetEnabled(c.Request().Context(), c.Param("id"), request.Enabled); err != nil {
			return mygoHTTPError(err)
		}
		return c.NoContent(http.StatusNoContent)
	}, s.requireAdmin)
	s.echo.DELETE("/api/mygo/plugins/:id", func(c *echo.Context) error {
		if err := s.mygo.Delete(c.Request().Context(), c.Param("id")); err != nil {
			return mygoHTTPError(err)
		}
		return c.NoContent(http.StatusNoContent)
	}, s.requireAdmin)
	s.echo.GET("/api/mygo/plugins/:id/settings", func(c *echo.Context) error {
		settings, err := s.mygo.SettingsFrom(c.Request().Context(), currentUserID(c), c.Param("id"), c.QueryParam("identity"))
		if err != nil {
			return mygoHTTPError(err)
		}
		return c.JSON(http.StatusOK, settings)
	}, s.requireAuth)
	s.echo.PUT("/api/mygo/plugins/:id/settings", func(c *echo.Context) error {
		var settings map[string]string
		if err := decodePluginJSON(c, &settings); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid user settings")
		}
		if err := s.mygo.SaveSettingsFrom(c.Request().Context(), currentUserID(c), c.Param("id"), c.QueryParam("identity"), settings); err != nil {
			return mygoHTTPError(err)
		}
		return c.NoContent(http.StatusNoContent)
	}, s.requireAuth)
	s.echo.GET("/api/mygo/plugins/:id/prompt", func(c *echo.Context) error {
		prompt, err := s.mygo.PromptFrom(c.Request().Context(), currentUserID(c), c.Param("id"), c.QueryParam("identity"))
		if err != nil {
			return mygoHTTPError(err)
		}
		if len(prompt) == 0 {
			prompt = []byte("null")
		}
		return c.Blob(http.StatusOK, "application/json", prompt)
	}, s.requireAuth)
	s.echo.POST("/api/mygo/plugins/:id/call/:method", func(c *echo.Context) error {
		contents, err := io.ReadAll(http.MaxBytesReader(c.Response(), c.Request().Body, 2<<20))
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "request exceeds limit")
		}
		result, err := s.mygo.CallFrom(c.Request().Context(), currentUserID(c), c.Param("id"), c.QueryParam("identity"), c.Param("method"), contents)
		if err != nil {
			return mygoHTTPError(err)
		}
		return c.Blob(http.StatusOK, "application/json", result)
	}, s.requireAuth)
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		s.echo.Add(method, "/api/mygo/plugins/:id/stream", s.handleMygoStream, s.requireAuth)
	}
	s.echo.GET("/api/mygo/plugins/:id/image", s.handleMygoImage, s.requireAuth)
}

func mygoHTTPError(err error) error {
	status := http.StatusBadRequest
	if errors.Is(err, mygo.ErrDisabled) {
		status = http.StatusServiceUnavailable
	}
	if errors.Is(err, mygo.ErrUnsupported) {
		status = http.StatusNotImplemented
	}
	return echo.NewHTTPError(status, err.Error())
}

func (s *Server) handleMygoRepositoryPreview(c *echo.Context) error {
	var request struct {
		Repository string `json:"repository"`
	}
	if err := decodePluginJSON(c, &request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid repository")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), 90*time.Second)
	defer cancel()
	archive, origin, err := s.mygoCatalog.Download(ctx, request.Repository)
	if err != nil {
		return mygoHTTPError(err)
	}
	preview, err := s.mygo.Preview(ctx, archive, origin)
	if err != nil {
		return mygoHTTPError(err)
	}
	return c.JSON(http.StatusOK, preview)
}

func (s *Server) handleMygoStream(c *echo.Context) error {
	media, err := s.mygo.StreamFrom(c.Request().Context(), currentUserID(c), c.Param("id"), c.QueryParam("identity"), c.QueryParam("id"), c.QueryParam("quality"))
	if err != nil {
		return mygoHTTPError(err)
	}
	defer media.Release()
	ctx, cancel := context.WithCancel(c.Request().Context())
	defer cancel()
	stop := context.AfterFunc(media.Context, cancel)
	defer stop()
	stopWrite := context.AfterFunc(ctx, func() { _ = http.NewResponseController(c.Response()).SetWriteDeadline(time.Now()) })
	defer stopWrite()
	c.Response().Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	c.Response().Header().Set("Cache-Control", "private, no-store")
	c.Response().Header().Set("X-Content-Type-Options", "nosniff")
	if media.URL == "" {
		contentType := map[string]string{".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg"}[strings.ToLower(filepath.Ext(media.Name))]
		if contentType == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "unsupported package media type")
		}
		c.Response().Header().Set("Content-Type", contentType)
		http.ServeContent(c.Response(), c.Request().WithContext(ctx), media.Name, time.Time{}, &mygoMediaReader{ctx: ctx, Reader: bytes.NewReader(media.Data)})
		return nil
	}
	headers := map[string]string{}
	for name, values := range media.Headers {
		headers[name] = strings.Join(values, ", ")
	}
	client := newMygoMediaClient(media)
	defer client.CloseIdleConnections()
	if err := proxyPluginMedia(ctx, c.Response(), c.Request(), media.URL, headers, client); err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, "mygo audio unavailable").Wrap(err)
	}
	return nil
}

func (s *Server) handleMygoImage(c *echo.Context) error {
	token, err := s.mygo.NewMediaFrom(c.Request().Context(), currentUserID(c), c.Param("id"), c.QueryParam("identity"), c.QueryParam("url"), "image")
	if err != nil {
		return mygoHTTPError(err)
	}
	defer s.mygo.ForgetMedia(token)
	media, err := s.mygo.Media(c.Request().Context(), currentUserID(c), token)
	if err != nil {
		return mygoHTTPError(err)
	}
	defer media.Release()
	contents := media.Data
	if media.URL != "" {
		ctx, cancel := context.WithTimeout(c.Request().Context(), 15*time.Second)
		defer cancel()
		stop := context.AfterFunc(media.Context, cancel)
		defer stop()
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, media.URL, nil)
		if err != nil {
			return mygoHTTPError(err)
		}
		request.Header = media.Headers
		client := newMygoMediaClient(media)
		defer client.CloseIdleConnections()
		response, err := client.Do(request)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadGateway, "image unavailable")
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return echo.NewHTTPError(http.StatusBadGateway, "image unavailable")
		}
		contents, err = io.ReadAll(io.LimitReader(response.Body, (5<<20)+1))
		if err != nil {
			return mygoHTTPError(err)
		}
	}
	if len(contents) > 5<<20 {
		return echo.NewHTTPError(http.StatusBadRequest, "image exceeds limit")
	}
	contentType := http.DetectContentType(contents)
	if contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/gif" && contentType != "image/webp" {
		return echo.NewHTTPError(http.StatusBadRequest, "unsupported image type")
	}
	c.Response().Header().Set("Cache-Control", "private, no-store")
	c.Response().Header().Set("X-Content-Type-Options", "nosniff")
	return c.Blob(http.StatusOK, contentType, contents)
}

func newMygoMediaClient(media mygo.Media) *http.Client {
	client := pluginruntime.NewHTTPClient()
	client.Timeout = 0
	client.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		requestedRange := request.Header.Get("Range")
		if err := pluginruntime.CheckRedirect(request, via); err != nil {
			return err
		}
		headers, err := media.HeadersFor(request.URL)
		if err != nil {
			return err
		}
		raw := map[string]string{}
		for name, values := range headers {
			raw[name] = strings.Join(values, ", ")
		}
		request.Header = make(http.Header)
		if err := applyPluginMediaRequestHeaders(request.Header, raw); err != nil {
			return err
		}
		if requestedRange != "" {
			request.Header.Set("Range", requestedRange)
		}
		return nil
	}
	return client
}

type mygoMediaReader struct {
	ctx    context.Context
	Reader *bytes.Reader
}

func (reader *mygoMediaReader) Read(data []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	return reader.Reader.Read(data)
}

func (reader *mygoMediaReader) Seek(offset int64, whence int) (int64, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	return reader.Reader.Seek(offset, whence)
}
