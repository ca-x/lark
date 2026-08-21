package host

import (
	"encoding/json"
	"time"
)

type Page struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

type SongQuery struct {
	Page
	Query      string `json:"query,omitempty"`
	PathPrefix string `json:"pathPrefix,omitempty"`
	Type       string `json:"type,omitempty"`
	OrderBy    string `json:"orderBy,omitempty"`
	Order      string `json:"order,omitempty"`
}

// Song mirrors the public SongLoft plugin DTO. Filesystem-only internal fields
// must be filtered by the Lark adapter before this value reaches JavaScript.
type Song struct {
	ID              int        `json:"id"`
	Type            string     `json:"type"`
	Title           string     `json:"title"`
	Artist          string     `json:"artist"`
	Album           string     `json:"album"`
	Year            int        `json:"year"`
	Genre           string     `json:"genre"`
	Language        string     `json:"language,omitempty"`
	Style           string     `json:"style,omitempty"`
	Duration        float64    `json:"duration"`
	FilePath        string     `json:"file_path"`
	FileSize        int64      `json:"file_size"`
	Format          string     `json:"format"`
	BitRate         int        `json:"bit_rate"`
	SampleRate      int        `json:"sample_rate"`
	URL             string     `json:"url,omitempty"`
	CoverURL        string     `json:"cover_url,omitempty"`
	Lyric           string     `json:"lyric,omitempty"`
	LyricSource     string     `json:"lyric_source,omitempty"`
	LyricRemoteURL  string     `json:"lyric_remote_url,omitempty"`
	LyricURL        string     `json:"lyric_url,omitempty"`
	PluginEntryPath string     `json:"plugin_entry_path,omitempty"`
	SourceData      string     `json:"source_data,omitempty"`
	DedupKey        string     `json:"dedup_key,omitempty"`
	Track           string     `json:"track,omitempty"`
	IsLive          bool       `json:"is_live"`
	IsVideo         bool       `json:"is_video"`
	AddedAt         time.Time  `json:"added_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	FileModifiedAt  *time.Time `json:"file_modified_at,omitempty"`
}

type SongCreate struct {
	URL            string  `json:"url"`
	Title          string  `json:"title"`
	Artist         string  `json:"artist"`
	Album          string  `json:"album"`
	CoverURL       string  `json:"coverUrl"`
	Duration       float64 `json:"duration"`
	SourceData     string  `json:"sourceData"`
	DedupKey       string  `json:"dedupKey"`
	Lyric          string  `json:"lyric"`
	LyricSource    string  `json:"lyricSource"`
	LyricRemoteURL string  `json:"lyricRemoteUrl"`
	IsVideo        bool    `json:"isVideo"`
}

type SongUpdate struct {
	Title    *string  `json:"title,omitempty"`
	Artist   *string  `json:"artist,omitempty"`
	Album    *string  `json:"album,omitempty"`
	URL      *string  `json:"url,omitempty"`
	CoverURL *string  `json:"coverUrl,omitempty"`
	Duration *float64 `json:"duration,omitempty"`
}

type DownloadOptions struct {
	TargetDir     string `json:"target_dir"`
	PathTemplate  string `json:"path_template"`
	EmbedMetadata *bool  `json:"embed_metadata,omitempty"`
	Format        string `json:"format"`
	Quality       string `json:"quality"`
}

type DownloadResult struct {
	Path string `json:"path"`
}

type OrganizeItem struct {
	SongID       int    `json:"song_id"`
	PathTemplate string `json:"path_template"`
}

type OrganizeResult struct {
	SongID int    `json:"song_id"`
	Path   string `json:"path,omitempty"`
	Error  string `json:"error,omitempty"`
}

type Playlist struct {
	ID          int    `json:"id"`
	Type        string `json:"type"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CoverURL    string `json:"cover_url,omitempty"`
}

type PlaylistCreate struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	CoverURL    string `json:"coverUrl"`
}

type PlaylistUpdate struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	CoverURL    *string `json:"coverUrl,omitempty"`
}

type PlaylistSongQuery struct {
	Page
	Brief bool   `json:"brief"`
	Sort  string `json:"sort"`
	Order string `json:"order"`
}

type AddSongsResult struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"`
}

type FileStat struct {
	Size    int64 `json:"size"`
	ModTime int64 `json:"modTime"`
	IsDir   bool  `json:"isDir"`
}

type FileEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
}

type CommandOptions struct {
	Timeout int               `json:"timeout"`
	Stdin   string            `json:"stdin"`
	Env     map[string]string `json:"env"`
}

type CommandResult struct {
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
}

type CommandStartResult struct {
	PID int `json:"pid"`
}

type CommandDownloadOptions struct {
	Extract       string `json:"extract"`
	ExtractTarget string `json:"extractTarget"`
}

type PluginInfo struct {
	EntryPath string   `json:"entry_path"`
	Token     string   `json:"-"`
	HostURL   string   `json:"host_url"`
	DataDir   string   `json:"-"`
	MusicDir  string   `json:"-"`
	External  []string `json:"-"`
}

type EventRegistration struct {
	EntryPath string `json:"entry_path"`
	Kind      string `json:"kind"`
}

type Message struct {
	From    string          `json:"from"`
	To      string          `json:"to"`
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload"`
}
