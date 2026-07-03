package dlna

import (
	"context"
	"errors"
	"time"

	"lark/backend/ent"
	"lark/backend/internal/models"
)

type MediaPurpose string

const (
	PurposeAudio     MediaPurpose = "audio"
	PurposeCover     MediaPurpose = "cover"
	PurposeTranscode MediaPurpose = "transcode"
)

type DeviceState string

const (
	DeviceAvailable   DeviceState = "available"
	DeviceConnecting  DeviceState = "connecting"
	DevicePlaying     DeviceState = "playing"
	DeviceUnavailable DeviceState = "unavailable"
)

type Device struct {
	ID           string      `json:"id"`
	Name         string      `json:"name"`
	Protocol     string      `json:"protocol"`
	State        DeviceState `json:"state"`
	Manufacturer string      `json:"manufacturer,omitempty"`
	Model        string      `json:"model,omitempty"`
	LastSeenAt   time.Time   `json:"last_seen_at"`
}

type Status struct {
	CastEnabled    bool   `json:"cast_enabled"`
	LibraryEnabled bool   `json:"library_enabled"`
	Output         string `json:"output"`
	DeviceID       string `json:"device_id,omitempty"`
	DeviceName     string `json:"device_name,omitempty"`
	State          string `json:"state"`
}

type MediaResource struct {
	AudioURL string
	CoverURL string
	Mime     string
	Size     int64
	BitRate  int
	Duration time.Duration
}

type Container struct {
	ID         string
	ParentID   string
	Title      string
	Class      string
	ChildCount int
}

type BrowseResult struct {
	Result         string
	NumberReturned int
	TotalMatches   int
	UpdateID       int
}

type Library interface {
	GetSettings(ctx context.Context) (models.Settings, error)
	RawSong(ctx context.Context, id int) (*ent.Song, error)
	Song(ctx context.Context, userID, id int) (models.Song, error)
	SongCover(ctx context.Context, id int) ([]byte, string, error)
	SongsPage(ctx context.Context, userID int, q string, favorites bool, limit, offset int) (models.SongPage, error)
	AlbumsPage(ctx context.Context, userID, limit, offset, artistID int) (models.AlbumPage, error)
	AlbumSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error)
	Artists(ctx context.Context, userID, limit int) ([]models.Artist, error)
	ArtistSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error)
	Playlists(ctx context.Context, userID, limit int) ([]models.Playlist, error)
	PlaylistSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error)
	Folders(ctx context.Context, userID, limit int) ([]models.Folder, error)
	FolderSongs(ctx context.Context, userID int, relPath string, limit int) ([]models.Song, error)
	FFmpegBin() string
}

var (
	ErrDisabled          = errors.New("dlna is disabled")
	ErrInvalidToken      = errors.New("invalid dlna media token")
	ErrDeviceUnavailable = errors.New("dlna device unavailable")
	ErrDeviceNotFound    = errors.New("dlna device not found")
	ErrUnsupportedAction = errors.New("unsupported dlna action")
)
