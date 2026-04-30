package models

import "time"

type Song struct {
	ID              int        `json:"id"`
	Title           string     `json:"title"`
	ArtistID        int        `json:"artist_id"`
	Artist          string     `json:"artist"`
	AlbumID         int        `json:"album_id"`
	Album           string     `json:"album"`
	Path            string     `json:"path"`
	FileName        string     `json:"file_name"`
	Format          string     `json:"format"`
	Mime            string     `json:"mime"`
	SizeBytes       int64      `json:"size_bytes"`
	DurationSeconds float64    `json:"duration_seconds"`
	SampleRate      int        `json:"sample_rate"`
	BitRate         int        `json:"bit_rate"`
	BitDepth        int        `json:"bit_depth"`
	Year            int        `json:"year"`
	NeteaseID       string     `json:"netease_id"`
	Favorite        bool       `json:"favorite"`
	PlayCount       int        `json:"play_count"`
	LastPlayedAt    *time.Time `json:"last_played_at,omitempty"`
	ResumePosition  float64    `json:"resume_position_seconds"`
	HasLyrics       bool       `json:"has_lyrics"`
	LyricsSource    string     `json:"lyrics_source"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type Album struct {
	ID          int       `json:"id"`
	Title       string    `json:"title"`
	ArtistID    int       `json:"artist_id"`
	Artist      string    `json:"artist"`
	AlbumArtist string    `json:"album_artist"`
	Year        int       `json:"year"`
	Favorite    bool      `json:"favorite"`
	SongCount   int       `json:"song_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Artist struct {
	ID         int       `json:"id"`
	Name       string    `json:"name"`
	Favorite   bool      `json:"favorite"`
	SongCount  int       `json:"song_count"`
	AlbumCount int       `json:"album_count"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type User struct {
	ID            int       `json:"id"`
	Username      string    `json:"username"`
	Nickname      string    `json:"nickname"`
	AvatarDataURL string    `json:"avatar_data_url"`
	Role          string    `json:"role"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type AuthStatus struct {
	Initialized         bool  `json:"initialized"`
	RegistrationEnabled bool  `json:"registration_enabled"`
	User                *User `json:"user,omitempty"`
}

type MCPTokenStatus struct {
	Configured bool   `json:"configured"`
	Hint       string `json:"hint"`
	Token      string `json:"token,omitempty"`
}

type SubsonicCredentialStatus struct {
	Configured bool   `json:"configured"`
	Username   string `json:"username"`
	Hint       string `json:"hint"`
	Endpoint   string `json:"endpoint,omitempty"`
}

type UISoundSettings struct {
	Enabled bool `json:"enabled"`
}

type Playlist struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CoverTheme  string    `json:"cover_theme"`
	Favorite    bool      `json:"favorite"`
	SongCount   int       `json:"song_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type LibraryStats struct {
	Songs     int `json:"songs"`
	Albums    int `json:"albums"`
	Artists   int `json:"artists"`
	Playlists int `json:"playlists"`
}

type SongPage struct {
	Items  []Song `json:"items"`
	Total  int    `json:"total"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
	Page   int    `json:"page"`
}

type AlbumPage struct {
	Items  []Album `json:"items"`
	Total  int     `json:"total"`
	Limit  int     `json:"limit"`
	Offset int     `json:"offset"`
	Page   int     `json:"page"`
}

type ArtistPage struct {
	Items  []Artist `json:"items"`
	Total  int      `json:"total"`
	Limit  int      `json:"limit"`
	Offset int      `json:"offset"`
	Page   int      `json:"page"`
}

type PlaylistPage struct {
	Items  []Playlist `json:"items"`
	Total  int        `json:"total"`
	Limit  int        `json:"limit"`
	Offset int        `json:"offset"`
	Page   int        `json:"page"`
}

type Folder struct {
	Path            string  `json:"path"`
	Name            string  `json:"name"`
	SongCount       int     `json:"song_count"`
	DurationSeconds float64 `json:"duration_seconds"`
	CoverSongID     int     `json:"cover_song_id"`
}

type LibraryDirectory struct {
	ID            string     `json:"id"`
	Path          string     `json:"path"`
	Note          string     `json:"note"`
	Builtin       bool       `json:"builtin"`
	WatchEnabled  bool       `json:"watch_enabled"`
	WatchActive   bool       `json:"watch_active"`
	Status        string     `json:"status"`
	LastError     string     `json:"last_error,omitempty"`
	LastCheckedAt *time.Time `json:"last_checked_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type SmartPlaylist struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Kind        string `json:"kind"`
	Enabled     bool   `json:"enabled"`
}

type Share struct {
	Token     string     `json:"token"`
	Type      string     `json:"type"`
	ID        int        `json:"id"`
	Title     string     `json:"title"`
	URL       string     `json:"url,omitempty"`
	CreatedBy int        `json:"created_by,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

type PublicShare struct {
	Share Share  `json:"share"`
	Songs []Song `json:"songs"`
}

type ShareList struct {
	Shares []Share `json:"shares"`
}

type FolderBreadcrumb struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type FolderDirectory struct {
	Path            string             `json:"path"`
	Name            string             `json:"name"`
	ParentPath      string             `json:"parent_path"`
	Breadcrumbs     []FolderBreadcrumb `json:"breadcrumbs"`
	Folders         []Folder           `json:"folders"`
	Songs           []Song             `json:"songs"`
	SongCount       int                `json:"song_count"`
	DurationSeconds float64            `json:"duration_seconds"`
	CoverSongID     int                `json:"cover_song_id"`
}

type Lyrics struct {
	SongID  int    `json:"song_id"`
	Source  string `json:"source"`
	Lyrics  string `json:"lyrics"`
	Fetched bool   `json:"fetched"`
}

type LyricCandidate struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Title  string `json:"title"`
	Artist string `json:"artist"`
}

type WebFont struct {
	Name   string `json:"name"`
	Family string `json:"family"`
	URL    string `json:"url"`
	Size   int64  `json:"size"`
}

type Settings struct {
	Language               string `json:"language"`
	Theme                  string `json:"theme"`
	SleepTimerMins         int    `json:"sleep_timer_mins"`
	LibraryPath            string `json:"library_path"`
	NeteaseFallback        bool   `json:"netease_fallback"`
	RegistrationEnabled    bool   `json:"registration_enabled"`
	DiagnosticsEnabled     bool   `json:"diagnostics_enabled"`
	PlaybackSourceTTLHours int    `json:"playback_source_ttl_hours"`
	WebFontFamily          string `json:"web_font_family"`
	WebFontURL             string `json:"web_font_url"`
	MetadataGrouping       bool   `json:"metadata_grouping"`
	SmartPlaylistsEnabled  bool   `json:"smart_playlists_enabled"`
	SharingEnabled         bool   `json:"sharing_enabled"`
	SubsonicServerEnabled  bool   `json:"subsonic_server_enabled"`
	TranscodePolicy        string `json:"transcode_policy"`
	TranscodeQualityKbps   int    `json:"transcode_quality_kbps"`
}

type ScrobblingSettings struct {
	Enabled     bool   `json:"enabled"`
	Provider    string `json:"provider"`
	TokenHint   string `json:"token_hint"`
	HasToken    bool   `json:"has_token"`
	SubmitNow   bool   `json:"submit_now"`
	MinSeconds  int    `json:"min_seconds"`
	PercentGate int    `json:"percent_gate"`
}

type PlaybackSource struct {
	Type      string    `json:"type"`
	SourceID  int       `json:"source_id"`
	UpdatedAt time.Time `json:"updated_at"`
}

type PlaybackSourceStatus struct {
	Source *PlaybackSource `json:"source"`
}

type LibrarySource struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Status      string `json:"status"`
	Description string `json:"description"`
}

type NetworkSource struct {
	ID          string `json:"id"`
	Provider    string `json:"provider"`
	Name        string `json:"name"`
	BaseURL     string `json:"base_url"`
	Username    string `json:"username"`
	Password    string `json:"password,omitempty"`
	Token       string `json:"token,omitempty"`
	HasPassword bool   `json:"has_password"`
	HasToken    bool   `json:"has_token"`
	Status      string `json:"status"`
	LastError   string `json:"last_error,omitempty"`
}

type NetworkTrack struct {
	ID              string  `json:"id"`
	SourceID        string  `json:"source_id"`
	Provider        string  `json:"provider"`
	Title           string  `json:"title"`
	Artist          string  `json:"artist"`
	Album           string  `json:"album"`
	DurationSeconds float64 `json:"duration_seconds"`
	Year            int     `json:"year"`
	CoverURL        string  `json:"cover_url"`
	StreamURL       string  `json:"stream_url"`
}

type RadioSource struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	SourceURL string `json:"source_url"`
	GroupName string `json:"group_name"`
	StreamURL string `json:"stream_url"`
	Builtin   bool   `json:"builtin"`
	Favorite  bool   `json:"favorite"`
}

type RadioStation struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	URL       string `json:"url"`
	SourceURL string `json:"source_url"`
	GroupName string `json:"group_name"`
	StreamURL string `json:"stream_url"`
	Country   string `json:"country"`
	Tags      string `json:"tags"`
	Codec     string `json:"codec"`
	Bitrate   int    `json:"bitrate"`
	Votes     int    `json:"votes"`
	Homepage  string `json:"homepage"`
	Favicon   string `json:"favicon"`
	Favorite  bool   `json:"favorite"`
}

type ScanStatus struct {
	Running     bool       `json:"running"`
	Canceled    bool       `json:"canceled"`
	CurrentDir  string     `json:"current_dir"`
	CurrentPath string     `json:"current_path"`
	Scanned     int        `json:"scanned"`
	Added       int        `json:"added"`
	Updated     int        `json:"updated"`
	Skipped     int        `json:"skipped"`
	Errors      []string   `json:"errors"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`
}

type ScanResult struct {
	Scanned    int      `json:"scanned"`
	Added      int      `json:"added"`
	Updated    int      `json:"updated"`
	Skipped    int      `json:"skipped"`
	Canceled   bool     `json:"canceled"`
	Errors     []string `json:"errors"`
	CurrentDir string   `json:"current_dir"`
}
