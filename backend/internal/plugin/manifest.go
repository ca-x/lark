package plugin

import (
	"encoding/json"
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// Manifest is the SongLoft plugin.json contract.
type Manifest struct {
	Schema         string   `json:"$schema,omitempty"`
	Name           string   `json:"name"`
	Version        string   `json:"version"`
	Description    string   `json:"description"`
	Author         string   `json:"author"`
	Homepage       string   `json:"homepage,omitempty"`
	License        string   `json:"license,omitempty"`
	EntryPath      string   `json:"entryPath"`
	Main           string   `json:"main"`
	MinHostVersion string   `json:"minHostVersion,omitempty"`
	Permissions    []string `json:"permissions"`
	PublicPaths    []string `json:"publicPaths,omitempty"`
	ExternalPaths  []string `json:"externalPaths,omitempty"`
	Icon           string   `json:"icon,omitempty"`
	UpdateURL      string   `json:"updateUrl,omitempty"`
	DownloadURL    string   `json:"download_url,omitempty"`
	EntryHash      string   `json:"entryHash"`
	ZipHash        string   `json:"zipHash"`
	RenderEngine   string   `json:"renderEngine,omitempty"`
}

// PluginManifest is retained as a compatibility name for SongLoft-derived code.
type PluginManifest = Manifest

const (
	RenderEngineWebView = "webview"
	RenderEngineWebF    = "webf"
)

var (
	entryPathRegexp = regexp.MustCompile("^[a-z][a-z0-9-]*$")
	semverRegexp    = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`)
)

func ParseManifest(data []byte) (*Manifest, error) {
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("parse plugin.json: %w", err)
	}
	return &manifest, nil
}

func ValidateManifest(manifest *Manifest) error {
	if manifest == nil {
		return fmt.Errorf("manifest is required")
	}
	if len(manifest.Name) < 2 || len(manifest.Name) > 50 {
		return fmt.Errorf("name must be 2-50 characters, got %d", len(manifest.Name))
	}
	if !semverRegexp.MatchString(manifest.Version) {
		return fmt.Errorf("version must be valid semver, got %q", manifest.Version)
	}
	if !entryPathRegexp.MatchString(manifest.EntryPath) {
		return fmt.Errorf("entryPath must match ^[a-z][a-z0-9-]*$, got %q", manifest.EntryPath)
	}
	if err := validateArchivePath(manifest.Main); err != nil {
		return fmt.Errorf("main: %w", err)
	}
	if !strings.HasSuffix(manifest.Main, ".js") && !strings.HasSuffix(manifest.Main, ".jsc") {
		return fmt.Errorf("main must end with .js or .jsc, got %q", manifest.Main)
	}
	if manifest.Permissions == nil {
		return fmt.Errorf("permissions is required (can be empty array)")
	}
	if err := ValidatePermissions(manifest.Permissions); err != nil {
		return err
	}
	if !IsValidRenderEngine(manifest.RenderEngine) {
		return fmt.Errorf("renderEngine must be %q or %q (or omitted), got %q", RenderEngineWebView, RenderEngineWebF, manifest.RenderEngine)
	}
	if err := ValidateHashField("entryHash", manifest.EntryHash); err != nil {
		return err
	}
	if err := ValidateHashField("zipHash", manifest.ZipHash); err != nil {
		return err
	}
	for index, externalPath := range manifest.ExternalPaths {
		if externalPath == "" || strings.IndexByte(externalPath, 0) >= 0 || !filepath.IsAbs(externalPath) || filepath.Clean(externalPath) != externalPath {
			return fmt.Errorf("externalPaths[%d] must be a canonical absolute path", index)
		}
	}
	return nil
}

func IsValidRenderEngine(value string) bool {
	return value == "" || value == RenderEngineWebView || value == RenderEngineWebF
}

func EntryPathFromZipName(name string) string {
	name = strings.TrimSuffix(name, ".zip")
	return strings.TrimSuffix(name, ".jsplugin")
}

func validateArchivePath(name string) error {
	if name == "" {
		return fmt.Errorf("path is empty")
	}
	if strings.ContainsRune(name, '\x00') || strings.Contains(name, "\\") {
		return fmt.Errorf("path %q contains an invalid character", name)
	}
	if strings.HasPrefix(name, "/") || path.IsAbs(name) {
		return fmt.Errorf("path %q is absolute", name)
	}
	cleaned := path.Clean(name)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || cleaned != strings.TrimSuffix(name, "/") {
		return fmt.Errorf("path %q is not canonical", name)
	}
	return nil
}
