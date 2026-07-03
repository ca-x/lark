package dlna

import (
	"strings"
	"testing"

	"lark/backend/internal/models"
)

func TestBuildSongDIDLIncludesMusicTrackMetadata(t *testing.T) {
	xmlText, err := BuildSongDIDL(models.Song{
		ID:              12,
		Title:           "Clouds & Rain",
		Artist:          "The <Band>",
		Album:           "Weather",
		Mime:            "audio/mpeg",
		SizeBytes:       12345,
		DurationSeconds: 65,
		BitRate:         192000,
	}, MediaResource{
		AudioURL: "http://host/dlna/audio/token/12",
		CoverURL: "http://host/dlna/cover/token/12",
		Mime:     "audio/mpeg",
		Size:     12345,
	})
	if err != nil {
		t.Fatalf("BuildSongDIDL: %v", err)
	}
	for _, want := range []string{
		`object.item.audioItem.musicTrack`,
		`Clouds &amp; Rain`,
		`The &lt;Band&gt;`,
		`http://host/dlna/audio/token/12`,
		`http-get:*:audio/mpeg:`,
		`0:01:05`,
	} {
		if !strings.Contains(xmlText, want) {
			t.Fatalf("DIDL missing %q:\n%s", want, xmlText)
		}
	}
}
