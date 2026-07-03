package dlna

import (
	"encoding/xml"
	"fmt"
	"strings"
	"time"

	"lark/backend/internal/models"
)

const didlNamespace = `urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/`

func BuildSongDIDL(item models.Song, resource MediaResource) (string, error) {
	didl := didlLite{
		XMLNS: didlNamespace,
		DC:    "http://purl.org/dc/elements/1.1/",
		UPNP:  "urn:schemas-upnp-org:metadata-1-0/upnp/",
		DLNA:  "urn:schemas-dlna-org:metadata-1-0/",
		Items: []didlItem{buildSongDIDLItem(item, resource)},
	}
	return marshalDIDL(didl)
}

func buildSongDIDLItem(item models.Song, resource MediaResource) didlItem {
	title := strings.TrimSpace(item.Title)
	if title == "" {
		title = strings.TrimSpace(item.FileName)
	}
	if title == "" {
		title = fmt.Sprintf("Song %d", item.ID)
	}
	mimeType := firstNonEmpty(resource.Mime, item.Mime, mimeFromFormat(item.Format))
	duration := resource.Duration
	if duration <= 0 && item.DurationSeconds > 0 {
		duration = time.Duration(item.DurationSeconds * float64(time.Second))
	}
	size := resource.Size
	if size <= 0 {
		size = item.SizeBytes
	}
	bitRate := resource.BitRate
	if bitRate <= 0 {
		bitRate = item.BitRate
	}
	res := didlResource{
		ProtocolInfo: "http-get:*:" + mimeType + ":*",
		Duration:     formatDuration(duration),
		Size:         size,
		Bitrate:      bitRate,
		Value:        resource.AudioURL,
	}
	return didlItem{
		ID:         fmt.Sprintf("song:%d", item.ID),
		ParentID:   parentSongContainer(item),
		Restricted: "1",
		Title:      title,
		Creator:    item.Artist,
		Class:      "object.item.audioItem.musicTrack",
		Album:      item.Album,
		Artist:     item.Artist,
		AlbumArtURI: didlAlbumArtURI{
			DLNAProfileID: "JPEG_TN",
			Value:         resource.CoverURL,
		},
		Resources: []didlResource{res},
	}
}

func BuildContainerDIDL(items []Container) (string, error) {
	containers := make([]didlContainer, 0, len(items))
	for _, item := range items {
		class := strings.TrimSpace(item.Class)
		if class == "" {
			class = "object.container.storageFolder"
		}
		parentID := strings.TrimSpace(item.ParentID)
		if parentID == "" {
			parentID = "0"
		}
		containers = append(containers, didlContainer{
			ID:         item.ID,
			ParentID:   parentID,
			Restricted: "1",
			Searchable: "0",
			ChildCount: item.ChildCount,
			Title:      item.Title,
			Class:      class,
		})
	}
	return marshalDIDL(didlLite{
		XMLNS:      didlNamespace,
		DC:         "http://purl.org/dc/elements/1.1/",
		UPNP:       "urn:schemas-upnp-org:metadata-1-0/upnp/",
		DLNA:       "urn:schemas-dlna-org:metadata-1-0/",
		Containers: containers,
	})
}

func SongsDIDL(items []models.Song, resource func(models.Song) MediaResource) (string, error) {
	out := didlLite{
		XMLNS: didlNamespace,
		DC:    "http://purl.org/dc/elements/1.1/",
		UPNP:  "urn:schemas-upnp-org:metadata-1-0/upnp/",
		DLNA:  "urn:schemas-dlna-org:metadata-1-0/",
	}
	for _, item := range items {
		out.Items = append(out.Items, buildSongDIDLItem(item, resource(item)))
	}
	return marshalDIDL(out)
}

func marshalDIDL(didl didlLite) (string, error) {
	data, err := xml.Marshal(didl)
	if err != nil {
		return "", err
	}
	return xml.Header + string(data), nil
}

func parentSongContainer(item models.Song) string {
	if item.AlbumID > 0 {
		return fmt.Sprintf("album:%d", item.AlbumID)
	}
	return "songs"
}

func mimeFromFormat(format string) string {
	switch strings.ToLower(strings.TrimPrefix(strings.TrimSpace(format), ".")) {
	case "mp3":
		return "audio/mpeg"
	case "flac":
		return "audio/flac"
	case "wav", "wave":
		return "audio/wav"
	case "m4a", "mp4", "aac", "alac":
		return "audio/mp4"
	case "ogg", "oga":
		return "audio/ogg"
	case "opus":
		return "audio/opus"
	case "aiff", "aif":
		return "audio/aiff"
	case "ape":
		return "audio/x-ape"
	case "wma":
		return "audio/x-ms-wma"
	default:
		return "audio/mpeg"
	}
}

func formatDuration(duration time.Duration) string {
	if duration <= 0 {
		return ""
	}
	total := int(duration.Seconds() + 0.5)
	hours := total / 3600
	minutes := (total % 3600) / 60
	seconds := total % 60
	return fmt.Sprintf("%d:%02d:%02d", hours, minutes, seconds)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

type didlLite struct {
	XMLName    xml.Name        `xml:"DIDL-Lite"`
	XMLNS      string          `xml:"xmlns,attr"`
	DC         string          `xml:"xmlns:dc,attr"`
	UPNP       string          `xml:"xmlns:upnp,attr"`
	DLNA       string          `xml:"xmlns:dlna,attr,omitempty"`
	Items      []didlItem      `xml:"item,omitempty"`
	Containers []didlContainer `xml:"container,omitempty"`
}

type didlItem struct {
	ID          string          `xml:"id,attr"`
	ParentID    string          `xml:"parentID,attr"`
	Restricted  string          `xml:"restricted,attr"`
	Title       string          `xml:"dc:title"`
	Creator     string          `xml:"dc:creator,omitempty"`
	Class       string          `xml:"upnp:class"`
	Album       string          `xml:"upnp:album,omitempty"`
	Artist      string          `xml:"upnp:artist,omitempty"`
	AlbumArtURI didlAlbumArtURI `xml:"upnp:albumArtURI,omitempty"`
	Resources   []didlResource  `xml:"res"`
}

type didlAlbumArtURI struct {
	DLNAProfileID string `xml:"dlna:profileID,attr,omitempty"`
	Value         string `xml:",chardata"`
}

type didlResource struct {
	ProtocolInfo string `xml:"protocolInfo,attr"`
	Duration     string `xml:"duration,attr,omitempty"`
	Size         int64  `xml:"size,attr,omitempty"`
	Bitrate      int    `xml:"bitrate,attr,omitempty"`
	Value        string `xml:",chardata"`
}

type didlContainer struct {
	ID         string `xml:"id,attr"`
	ParentID   string `xml:"parentID,attr"`
	Restricted string `xml:"restricted,attr"`
	Searchable string `xml:"searchable,attr"`
	ChildCount int    `xml:"childCount,attr,omitempty"`
	Title      string `xml:"dc:title"`
	Class      string `xml:"upnp:class"`
}
