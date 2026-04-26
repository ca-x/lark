package api

import (
	"io/fs"
	"net/http"
	"strings"

	"lark/backend/web"

	echo "github.com/labstack/echo/v5"
)

func (s *Server) registerFrontendRoutes() {
	dist, err := fs.Sub(web.DistFS, "dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(dist))
	s.echo.GET("/*", func(c *echo.Context) error {
		if strings.HasPrefix(c.Request().URL.Path, "/api/") {
			return echo.NewHTTPError(http.StatusNotFound, "not found")
		}
		trimmed := strings.TrimPrefix(c.Request().URL.Path, "/")
		if trimmed == "" {
			return c.FileFS("index.html", dist)
		}
		if _, err := fs.Stat(dist, trimmed); err == nil {
			fileServer.ServeHTTP(c.Response(), c.Request())
			return nil
		}
		return c.FileFS("index.html", dist)
	})
}
