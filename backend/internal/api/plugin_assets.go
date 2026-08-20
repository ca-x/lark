package api

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

import echo "github.com/labstack/echo/v5"

// pluginAssets mirrors Songloft's browser plugin runtime resources. Keeping
// them in the server binary guarantees that every installed plugin receives
// the same theme, component and host-bridge contract as the reference host.
//
//go:embed pluginassets/*
var pluginAssets embed.FS

var pluginAssetVersions = computePluginAssetVersions()

func computePluginAssetVersions() map[string]string {
	names := [...]string{
		"theme.css",
		"components.css",
		"webf-shims.css",
		"common.js",
		"webf-shims.js",
	}
	versions := make(map[string]string, len(names))
	for _, name := range names {
		data, err := pluginAssets.ReadFile("pluginassets/" + name)
		if err != nil {
			continue
		}
		sum := sha256.Sum256(data)
		versions[name] = fmt.Sprintf("%x", sum[:4])
	}
	return versions
}

func pluginAssetURL(name string) string {
	url := "/api/v1/jsplugin-assets/" + name
	if version := pluginAssetVersions[name]; version != "" {
		url += "?v=" + version
	}
	return url
}

func handlePluginAsset(c *echo.Context) error {
	subPath := strings.TrimPrefix(c.Param("*"), "/")
	cleanPath := path.Clean(subPath)
	if subPath == "" || cleanPath == "." || cleanPath != subPath || strings.HasPrefix(cleanPath, "../") {
		return echo.NewHTTPError(http.StatusNotFound, "plugin asset not found")
	}

	filePath := "pluginassets/" + cleanPath
	info, err := fs.Stat(pluginAssets, filePath)
	if err != nil || info.IsDir() {
		return echo.NewHTTPError(http.StatusNotFound, "plugin asset not found")
	}
	data, err := pluginAssets.ReadFile(filePath)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "plugin asset not found")
	}

	c.Response().Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	c.Response().Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(c.Response(), c.Request(), info.Name(), info.ModTime(), bytes.NewReader(data))
	return nil
}
