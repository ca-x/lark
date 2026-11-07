package mygo

import (
	"encoding/json/v2"
	"errors"
	"path"
	"regexp"
	"strings"
)

var validID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$`)
var ErrDisabled = errors.New("mygo plugins are disabled")
var ErrUnsupported = errors.New("unsupported: this capability is unavailable in Lark")

type Setting struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Help  string `json:"help,omitempty"`
	Link  string `json:"link,omitempty"`
}

type Navigation struct {
	Builtin string `json:"builtin,omitempty"`
	Title   string `json:"title,omitempty"`
	Page    string `json:"page,omitempty"`
	Icon    string `json:"icon,omitempty"`
}

type Permissions struct {
	Network []string `json:"network,omitempty"`
	Process any      `json:"process,omitempty"`
}

type HeaderRule struct {
	Hosts   []string          `json:"hosts"`
	Kinds   []string          `json:"kinds,omitempty"`
	Headers map[string]string `json:"headers"`
}

type Manifest struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	Version        string       `json:"version"`
	Main           string       `json:"main"`
	MinAppVersion  string       `json:"minAppVersion,omitempty"`
	Playback       string       `json:"playback"`
	Permissions    Permissions  `json:"permissions"`
	Settings       []Setting    `json:"settings,omitempty"`
	Navigation     []Navigation `json:"navigation,omitempty"`
	RequestHeaders []HeaderRule `json:"requestHeaders,omitempty"`
}

func parseManifest(data []byte) (Manifest, error) {
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return manifest, err
	}
	if !validID.MatchString(manifest.ID) || strings.TrimSpace(manifest.Name) == "" {
		return manifest, errors.New("invalid mygo plugin id or name")
	}
	if manifest.Main == "" {
		manifest.Main = "index.js"
	}
	if !safeName(manifest.Main) || (!strings.HasSuffix(manifest.Main, ".js") && !strings.HasSuffix(manifest.Main, ".ts") && !strings.HasSuffix(manifest.Main, ".mjs")) {
		return manifest, errors.New("mygo main must be a local JS/TS module")
	}
	if manifest.Playback == "" {
		manifest.Playback = "stream"
	}
	if manifest.Playback != "stream" {
		return manifest, errors.New("unsupported: native/remote playback is unavailable")
	}
	switch programs := manifest.Permissions.Process.(type) {
	case nil:
	case bool:
		if programs {
			return manifest, errors.New("unsupported: process permission is unavailable")
		}
	case []any:
		if len(programs) > 0 {
			return manifest, errors.New("unsupported: process permission is unavailable")
		}
	default:
		return manifest, errors.New("invalid process permission")
	}
	if len(manifest.Permissions.Network) > 100 || len(manifest.Settings) > 100 || len(manifest.RequestHeaders) > 100 {
		return manifest, errors.New("manifest exceeds limits")
	}
	seen := map[string]bool{}
	for _, setting := range manifest.Settings {
		if setting.Key == "" || seen[setting.Key] {
			return manifest, errors.New("invalid or duplicate setting")
		}
		seen[setting.Key] = true
	}
	return manifest, nil
}

func safeName(name string) bool {
	return name != "." && name != "" && !strings.ContainsAny(name, "\\\x00:") && !strings.HasPrefix(name, "/") && path.Clean(name) == name && name != ".." && !strings.HasPrefix(name, "../")
}
