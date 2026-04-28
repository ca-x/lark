package library

import (
	"regexp"
	"strings"
)

var lyricNoisePattern = regexp.MustCompile(`(?i)(?:\[[^\]]*\]|\([^)]*\)|【[^】]*】|-?\s*(?:official|lyric|lyrics|audio|video|mv|karaoke|伴奏|纯享|现场|live\s+version).*)`)

// cleanLyricQuery trims common streaming/video-site decorations before asking
// online lyric providers. It deliberately keeps the original value as a
// fallback at call sites; this helper only produces a better first attempt.
func cleanLyricQuery(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	cleaned := lyricNoisePattern.ReplaceAllString(value, "")
	cleaned = strings.NewReplacer("—", "-", "–", "-", "｜", "|", "  ", " ").Replace(cleaned)
	return strings.TrimSpace(cleaned)
}

func cleanLyricArtistTitle(artist, title string) (string, string) {
	artist = cleanLyricQuery(artist)
	title = strings.TrimSpace(title)
	for _, sep := range []string{" - ", " – ", " — ", "｜", " | "} {
		if left, right, ok := strings.Cut(title, sep); ok {
			left = cleanLyricQuery(left)
			right = cleanLyricQuery(right)
			if left != "" && right != "" {
				return left, right
			}
		}
	}
	return artist, cleanLyricQuery(title)
}
