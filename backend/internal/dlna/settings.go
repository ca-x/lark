package dlna

import (
	"net"
	"strings"

	"lark/backend/internal/models"
)

type Options struct {
	CastEnabled    bool
	LibraryEnabled bool
	ServerName     string
	MediaBaseURL   string
	AllowedIPs     []string
	Interfaces     []string
}

func OptionsFromSettings(settings models.Settings) Options {
	return Options{
		CastEnabled:    settings.DLNACastEnabled,
		LibraryEnabled: settings.DLNALibraryEnabled,
		ServerName:     defaultString(strings.TrimSpace(settings.DLNAServerName), "Lark"),
		MediaBaseURL:   strings.TrimRight(strings.TrimSpace(settings.DLNAMediaBaseURL), "/"),
		AllowedIPs:     splitCSV(settings.DLNAAllowedIPs),
		Interfaces:     splitCSV(settings.DLNAInterfaces),
	}
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || seen[part] {
			continue
		}
		seen[part] = true
		out = append(out, part)
	}
	return out
}

func (o Options) AllowsIP(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	if err == nil {
		remote = host
	}
	remote = strings.TrimSpace(remote)
	if remote == "" {
		return false
	}
	if len(o.AllowedIPs) == 0 {
		return true
	}
	ip := net.ParseIP(remote)
	for _, allowed := range o.AllowedIPs {
		if allowed == "*" || allowed == remote {
			return true
		}
		if _, network, err := net.ParseCIDR(allowed); err == nil && ip != nil && network.Contains(ip) {
			return true
		}
	}
	return false
}
