package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"lark/backend/internal/plugin"

	"github.com/gorilla/websocket"
	echo "github.com/labstack/echo/v5"
)

func (s *Server) registerPluginRoutes() {
	if s.pluginManager == nil {
		return
	}
	admin := s.requireAdmin
	if s.pluginRegistry != nil {
		s.echo.GET("/api/plugin-registries", s.handlePluginRegistries, admin)
		s.echo.PUT("/api/plugin-registries", s.handleSavePluginRegistries, admin)
		s.echo.GET("/api/plugin-marketplace", s.handlePluginMarketplace, admin)
		s.echo.POST("/api/plugin-marketplace/install", s.handleInstallMarketplacePlugin, admin)
	}
	for _, prefix := range []string{"/api/plugins", "/api/v1/jsplugins"} {
		s.echo.GET(prefix, s.handlePluginList, admin)
		s.echo.GET(prefix+"/capabilities", s.handlePluginCapabilities, admin)
		s.echo.POST(prefix+"/upload", s.handlePluginUpload, admin)
		s.echo.POST(prefix+"/:id/enable", s.handlePluginEnable, admin)
		s.echo.POST(prefix+"/:id/disable", s.handlePluginDisable, admin)
		s.echo.POST(prefix+"/:id/reload", s.handlePluginReload, admin)
		s.echo.DELETE(prefix+"/:id", s.handlePluginDelete, admin)
	}
	s.echo.GET("/api/v1/jsplugin-assets/*", handlePluginAsset)
	// Runtime requests deliberately use a handler-level auth check so a
	// manifest publicPaths entry can expose a read-only endpoint without a
	// session while all management endpoints remain admin-only.
	s.echo.Any("/api/v1/jsplugin/:entryPath", s.handlePluginRequest)
	s.echo.Any("/api/v1/jsplugin/:entryPath/*", s.handlePluginRequest)
}

func (s *Server) handlePluginList(c *echo.Context) error {
	items, err := s.pluginManager.List(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	if items == nil {
		items = []plugin.Plugin{}
	}
	return c.JSON(http.StatusOK, map[string]any{"plugins": items})
}

func (s *Server) handlePluginCapabilities(c *echo.Context) error {
	return c.JSON(http.StatusOK, map[string]any{"capabilities": s.pluginManager.Capabilities()})
}

func (s *Server) handlePluginUpload(c *echo.Context) error {
	const maxUpload = 50 << 20
	data, err := io.ReadAll(http.MaxBytesReader(c.Response(), c.Request().Body, maxUpload))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	item, err := s.pluginManager.Install(c.Request().Context(), data)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, plugin.ErrPackageTooLarge) {
			status = http.StatusRequestEntityTooLarge
		}
		return echo.NewHTTPError(status, err.Error())
	}
	return c.JSON(http.StatusCreated, item)
}

func (s *Server) handlePluginEnable(c *echo.Context) error {
	id, err := pluginIDParam(c)
	if err != nil {
		return err
	}
	if err := s.pluginManager.Enable(c.Request().Context(), id); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handlePluginDisable(c *echo.Context) error {
	id, err := pluginIDParam(c)
	if err != nil {
		return err
	}
	if err := s.pluginManager.Disable(c.Request().Context(), id); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *Server) handlePluginReload(c *echo.Context) error {
	item, err := s.pluginManager.List(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	id, err := pluginIDParam(c)
	if err != nil {
		return err
	}
	for _, value := range item {
		if value.ID == id {
			if err := s.pluginManager.Reload(c.Request().Context(), value.EntryPath); err != nil {
				return echo.NewHTTPError(http.StatusBadRequest, err.Error())
			}
			return c.NoContent(http.StatusNoContent)
		}
	}
	return echo.NewHTTPError(http.StatusNotFound, "plugin not found")
}

func (s *Server) handlePluginDelete(c *echo.Context) error {
	id, err := pluginIDParam(c)
	if err != nil {
		return err
	}
	if err := s.pluginManager.Delete(c.Request().Context(), id); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.NoContent(http.StatusNoContent)
}

func pluginIDParam(c *echo.Context) (int, error) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return 0, echo.NewHTTPError(http.StatusBadRequest, "invalid plugin id")
	}
	return id, nil
}

func (s *Server) handlePluginRegistries(c *echo.Context) error {
	registries, err := s.pluginRegistry.LoadRegistries(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]any{"registries": registries})
}

func (s *Server) handleSavePluginRegistries(c *echo.Context) error {
	var request struct {
		Registries []plugin.RegistryConfig `json:"registries"`
	}
	if err := decodePluginJSON(c, &request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if request.Registries == nil {
		request.Registries = []plugin.RegistryConfig{}
	}
	if err := s.pluginRegistry.SaveRegistries(c.Request().Context(), request.Registries); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]any{"registries": request.Registries})
}

func (s *Server) handlePluginMarketplace(c *echo.Context) error {
	registries, err := s.pluginRegistry.LoadRegistries(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	entries, warnings, err := s.pluginRegistry.FetchAndMergeMulti(c.Request().Context(), registries)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, err.Error())
	}
	return c.JSON(http.StatusOK, map[string]any{"plugins": entries, "warnings": warnings})
}

func (s *Server) handleInstallMarketplacePlugin(c *echo.Context) error {
	var requested plugin.RegistryEntry
	if err := decodePluginJSON(c, &requested); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if requested.EntryPath == "" || requested.Version == "" || requested.DownloadURL == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "entryPath, version and downloadURL are required")
	}
	registries, err := s.pluginRegistry.LoadRegistries(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	entries, _, err := s.pluginRegistry.FetchAndMergeMulti(c.Request().Context(), registries)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, err.Error())
	}
	var verified plugin.RegistryEntry
	for _, entry := range entries {
		if entry.EntryPath == requested.EntryPath && entry.Version == requested.Version && entry.DownloadURL == requested.DownloadURL && entry.Author == requested.Author {
			verified = entry
			break
		}
	}
	if verified.EntryPath == "" {
		return echo.NewHTTPError(http.StatusConflict, "marketplace entry changed; refresh and try again")
	}
	item, err := s.pluginManager.Update(c.Request().Context(), verified)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, err.Error())
	}
	return c.JSON(http.StatusCreated, item)
}

func (s *Server) handlePluginRequest(c *echo.Context) error {
	entryPath := c.Param("entryPath")
	items, err := s.pluginManager.List(c.Request().Context())
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	var item plugin.Plugin
	for _, value := range items {
		if value.EntryPath == entryPath {
			item = value
			break
		}
	}
	if item.EntryPath == "" {
		return echo.NewHTTPError(http.StatusNotFound, "plugin not found")
	}
	subPath := c.Param("*")
	if subPath == "" {
		subPath = "/"
	}
	if !strings.HasPrefix(subPath, "/") {
		subPath = "/" + subPath
	}
	public := false
	for _, allowed := range item.PublicPaths {
		allowed = path.Clean("/" + allowed)
		if allowed == "/" || subPath == allowed || strings.HasPrefix(subPath, strings.TrimRight(allowed, "/")+"/") {
			public = true
			break
		}
	}
	if !public {
		u, authErr := s.lib.UserBySession(c.Request().Context(), s.sessionToken(c))
		if authErr != nil {
			return echo.NewHTTPError(http.StatusUnauthorized, "authentication required")
		}
		c.Set("user", u)
	}
	if item.Status != plugin.StatusActive {
		return echo.NewHTTPError(http.StatusForbidden, "plugin is disabled")
	}
	if websocket.IsWebSocketUpgrade(c.Request()) {
		request := plugin.HTTPRequest{
			Method: c.Request().Method, Path: subPath, Headers: pluginRequestHeaders(c.Request()),
			Query: c.Request().URL.RawQuery, RemoteAddr: c.Request().RemoteAddr,
		}
		if err := s.pluginManager.ServeWebSocket(c.Request().Context(), c.Response(), c.Request(), entryPath, request); err != nil {
			return echo.NewHTTPError(http.StatusBadGateway, "plugin WebSocket failed").Wrap(err)
		}
		return nil
	}
	if strings.HasPrefix(subPath, "/files/") {
		if c.Request().Method != http.MethodGet && c.Request().Method != http.MethodHead {
			return echo.NewHTTPError(http.StatusMethodNotAllowed, "plugin files are read-only")
		}
		name, decodeErr := url.PathUnescape(strings.TrimPrefix(subPath, "/files/"))
		if decodeErr != nil || name == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid plugin file path")
		}
		filePath, fileErr := s.pluginManager.FilePath(c.Request().Context(), entryPath, name)
		if fileErr != nil {
			return echo.NewHTTPError(http.StatusNotFound, "plugin file not found")
		}
		c.Response().Header().Set("Cache-Control", "private, max-age=86400")
		c.Response().Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeFile(c.Response(), c.Request(), filePath)
		return nil
	}
	if (c.Request().Method == http.MethodGet || c.Request().Method == http.MethodHead) && (subPath == "/" || subPath == "/static" || strings.HasPrefix(subPath, "/static/")) {
		relative := strings.TrimPrefix(subPath, "/static")
		if relative == "" || relative == "/" {
			relative = "/index.html"
		}
		filePath, fileErr := s.pluginManager.StaticFilePath(entryPath, relative)
		if fileErr == nil {
			c.Response().Header().Set("X-Content-Type-Options", "nosniff")
			c.Response().Header().Set("Content-Security-Policy", "frame-ancestors 'self'")
			if strings.EqualFold(path.Ext(filePath), ".html") {
				return servePluginHTML(c, filePath, entryPath)
			}
			c.Response().Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			return servePluginStaticFile(c, filePath)
		}
		if relative != "/index.html" {
			if indexPath, indexErr := s.pluginManager.StaticFilePath(entryPath, "/index.html"); indexErr == nil {
				return servePluginHTML(c, indexPath, entryPath)
			}
		}
		return echo.NewHTTPError(http.StatusNotFound, "plugin static file not found")
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Response(), c.Request().Body, 10<<20))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	request := plugin.HTTPRequest{Method: c.Request().Method, Path: subPath, Headers: pluginRequestHeaders(c.Request()), Body: string(body), Query: c.Request().URL.RawQuery, RemoteAddr: c.Request().RemoteAddr}
	response, err := s.pluginManager.InvokeHTTP(c.Request().Context(), entryPath, request)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, err.Error())
	}
	for key, value := range response.Headers {
		c.Response().Header().Set(key, value)
	}
	return c.String(response.StatusCode, response.Body)
}

func pluginRequestHeaders(request *http.Request) map[string]string {
	headers := make(map[string]string, len(request.Header))
	for key, values := range request.Header {
		canonical := textproto.CanonicalMIMEHeaderKey(key)
		if len(values) > 0 && !isSensitivePluginRequestHeader(canonical) {
			headers[canonical] = values[0]
		}
	}
	return headers
}

const maxPluginJSONBody = 1 << 20

func decodePluginJSON(c *echo.Context, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(c.Response(), c.Request().Body, maxPluginJSONBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON value")
		}
		return err
	}
	return nil
}

func isSensitivePluginRequestHeader(name string) bool {
	switch name {
	case "Authorization", "Cookie", "Proxy-Authorization", "X-Api-Key":
		return true
	default:
		return false
	}
}

func servePluginStaticFile(c *echo.Context, filePath string) error {
	return c.FileFS(filepath.Base(filePath), os.DirFS(filepath.Dir(filePath)))
}

var emptyPluginSrcAttr = regexp.MustCompile(`\s+src\s*=\s*(""|'')`)

// injectPluginHTML installs Songloft's complete browser page contract before
// any plugin-owned relative resource. The ordering matches Songloft:
// base, theme, components, WebF CSS fallback, common bridge, WebF JS fallback.
func injectPluginHTML(document []byte, entryPath string) []byte {
	document = emptyPluginSrcAttr.ReplaceAll(document, nil)
	payload := []byte(
		`<base href="/api/v1/jsplugin/` + entryPath + `/">` +
			`<link rel="stylesheet" href="` + pluginAssetURL("theme.css") + `">` +
			`<link rel="stylesheet" href="` + pluginAssetURL("components.css") + `">` +
			`<link rel="stylesheet" href="` + pluginAssetURL("webf-shims.css") + `">` +
			`<script src="` + pluginAssetURL("common.js") + `"></script>` +
			`<script src="` + pluginAssetURL("webf-shims.js") + `"></script>`,
	)
	head := bytes.Index(document, []byte("<head>"))
	if head >= 0 {
		head += len("<head>")
		return slicesInsert(document, head, payload)
	}
	if head = bytes.Index(document, []byte("<head ")); head >= 0 {
		if closeIndex := bytes.IndexByte(document[head:], '>'); closeIndex >= 0 {
			return slicesInsert(document, head+closeIndex+1, payload)
		}
	}
	return append(payload, document...)
}

func slicesInsert(value []byte, index int, inserted []byte) []byte {
	result := make([]byte, 0, len(value)+len(inserted))
	result = append(result, value[:index]...)
	result = append(result, inserted...)
	return append(result, value[index:]...)
}

func servePluginHTML(c *echo.Context, filePath, entryPath string) error {
	document, err := os.ReadFile(filePath)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "plugin static file not found")
	}
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Content-Type", "text/html; charset=utf-8")
	if c.Request().Method == http.MethodHead {
		return c.NoContent(http.StatusOK)
	}
	return c.HTMLBlob(http.StatusOK, injectPluginHTML(document, entryPath))
}
