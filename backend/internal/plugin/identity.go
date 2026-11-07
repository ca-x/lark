package plugin

import (
	"net/url"
	"regexp"
	"strings"
)

var authorNoise = regexp.MustCompile(`<[^>]*>|\([^)]*\)|（[^）]*）`)

func PluginIdentity(author, updateURL string) string {
	identity := strings.ToLower(strings.Join(strings.Fields(authorNoise.ReplaceAllString(author, " ")), " "))
	if identity != "" {
		return identity
	}
	parsed, err := url.Parse(updateURL)
	if err != nil {
		return ""
	}
	switch strings.ToLower(parsed.Hostname()) {
	case "github.com", "raw.githubusercontent.com", "objects.githubusercontent.com":
	default:
		return ""
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return ""
	}
	return "repo:" + strings.ToLower(parts[0]+"/"+strings.TrimSuffix(parts[1], ".git"))
}
