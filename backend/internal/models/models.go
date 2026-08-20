package models

import "time"

type Song struct {
	ID              int        `json:"id"`
	Type            string     `json:"type"`
	Title           string     `json:"title"`
	ArtistID        int        `json:"artist_id"`
	Artist          string     `json:"artist"`
	AlbumID         int        `json:"album_id"`
	Album           string     `json:"album"`
	URL             string     `json:"url,omitempty"`
	CoverURL        string     `json:"cover_url,omitempty"`
	PluginEntryPath string     `json:"plugin_entry_path,omitempty"`
	SourceData      string     `json:"source_data,omitempty"`
	DedupKey        string     `json:"dedup_key,omitempty"`
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
	LyricsRemoteURL string     `json:"lyric_remote_url,omitempty"`
	IsLive          bool       `json:"is_live"`
	IsVideo         bool       `json:"is_video"`
	CoverVersion    int64      `json:"cover_version,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	MetadataIssues  []string   `json:"metadata_issues,omitempty"`
}

type LibraryReviewSummary struct {
	IncompleteSongs int `json:"incomplete_songs"`
}

type Album struct {
	ID           int       `json:"id"`
	Title        string    `json:"title"`
	ArtistID     int       `json:"artist_id"`
	Artist       string    `json:"artist"`
	AlbumArtist  string    `json:"album_artist"`
	Year         int       `json:"year"`
	Favorite     bool      `json:"favorite"`
	SongCount    int       `json:"song_count"`
	CoverVersion int64     `json:"cover_version,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type MetadataCandidate struct {
	Source      string `json:"source"`
	ID          string `json:"id"`
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	Album       string `json:"album,omitempty"`
	Year        int    `json:"year,omitempty"`
	Cover       string `json:"cover,omitempty"`
	ReleaseDate string `json:"release_date,omitempty"`
	Link        string `json:"link,omitempty"`
	PathGroups  int    `json:"path_groups,omitempty"`
	SongCount   int    `json:"song_count,omitempty"`
}

type MetadataWritebackItem struct {
	SongID  int    `json:"song_id,omitempty"`
	Title   string `json:"title,omitempty"`
	Path    string `json:"path"`
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

type MetadataWritebackResult struct {
	Updated int                     `json:"updated"`
	Skipped int                     `json:"skipped"`
	Failed  int                     `json:"failed"`
	Items   []MetadataWritebackItem `json:"items"`
	Song    *Song                   `json:"song,omitempty"`
	Album   *Album                  `json:"album,omitempty"`
	Albums  []Album                 `json:"albums,omitempty"`
	Songs   []Song                  `json:"songs,omitempty"`
}

type Artist struct {
	ID         int       `json:"id"`
	Name       string    `json:"name"`
	Initial    string    `json:"initial"`
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

type OfflineAudioStatus struct {
	SongID    int    `json:"song_id"`
	Quality   int    `json:"quality"`
	Status    string `json:"status"`
	AudioURL  string `json:"audio_url,omitempty"`
	CoverURL  string `json:"cover_url,omitempty"`
	SizeBytes int64  `json:"size_bytes,omitempty"`
	ETag      string `json:"etag,omitempty"`
	Error     string `json:"error,omitempty"`
	Song      *Song  `json:"song,omitempty"`
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
	Enabled bool    `json:"enabled"`
	Volume  float64 `json:"volume"`
}

type PlaybackHistorySettings struct {
	SeparateByDevice bool `json:"separate_by_device"`
}

type PlaybackHistoryEntry struct {
	ID              int       `json:"id"`
	Song            Song      `json:"song"`
	PlayedAt        time.Time `json:"played_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	ProgressSeconds float64   `json:"progress_seconds"`
	DurationSeconds float64   `json:"duration_seconds"`
	Completed       bool      `json:"completed"`
	DeviceType      string    `json:"device_type"`
}

type UserPreferences struct {
	HomePlayerStyle         string `json:"home_player_style"`
	MobileHomePlayerStyle   string `json:"mobile_home_player_style"`
	MineradioStageEnabled   bool   `json:"mineradio_stage_enabled"`
	ArtistAlbumDisplayStyle string `json:"artist_album_display_style"`
	LyricsDisplayStyle      string `json:"lyrics_display_style"`
	LyricsDragSeekEnabled   bool   `json:"lyrics_drag_seek_enabled"`
	TerminalShellTheme      string `json:"terminal_shell_theme"`
}

type Playlist struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CoverTheme  string    `json:"cover_theme"`
	CoverURL    string    `json:"cover_url,omitempty"`
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
	Items    []Artist `json:"items"`
	Total    int      `json:"total"`
	Limit    int      `json:"limit"`
	Offset   int      `json:"offset"`
	Page     int      `json:"page"`
	Initials []string `json:"initials"`
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
	Language                     string `json:"language"`
	Theme                        string `json:"theme"`
	SleepTimerMins               int    `json:"sleep_timer_mins"`
	LibraryPath                  string `json:"library_path"`
	NeteaseFallback              bool   `json:"netease_fallback"`
	RegistrationEnabled          bool   `json:"registration_enabled"`
	DiagnosticsEnabled           bool   `json:"diagnostics_enabled"`
	DLNACastEnabled              bool   `json:"dlna_cast_enabled"`
	DLNALibraryEnabled           bool   `json:"dlna_library_enabled"`
	DLNAServerName               string `json:"dlna_server_name"`
	DLNAMediaBaseURL             string `json:"dlna_media_base_url"`
	DLNAAllowedIPs               string `json:"dlna_allowed_ips"`
	DLNAInterfaces               string `json:"dlna_interfaces"`
	NoDLNAOption                 bool   `json:"no_dlna_option"`
	PlaybackSourceTTLHours       int    `json:"playback_source_ttl_hours"`
	PlaybackHistoryRetentionDays int    `json:"playback_history_retention_days"`
	WebFontFamily                string `json:"web_font_family"`
	WebFontURL                   string `json:"web_font_url"`
	LyricsAutoSaveToSongDir      bool   `json:"lyrics_auto_save_to_song_dir"`
	LyricsFontFamily             string `json:"lyrics_font_family"`
	LyricsFontURL                string `json:"lyrics_font_url"`
	LyricsFontSize               int    `json:"lyrics_font_size"`
	MetadataGrouping             bool   `json:"metadata_grouping"`
	LibraryTagWriteback          bool   `json:"library_tag_writeback"`
	LibraryPathMetadataAssist    bool   `json:"library_path_metadata_assist"`
	SmartPlaylistsEnabled        bool   `json:"smart_playlists_enabled"`
	SharingEnabled               bool   `json:"sharing_enabled"`
	SubsonicServerEnabled        bool   `json:"subsonic_server_enabled"`
	TranscodePolicy              string `json:"transcode_policy"`
	TranscodeQualityKbps         int    `json:"transcode_quality_kbps"`
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

type PlaybackQueue struct {
	SongIDs   []int           `json:"song_ids"`
	CurrentID int             `json:"current_id"`
	Source    *PlaybackSource `json:"source,omitempty"`
	Radio     *PlaybackRadio  `json:"radio,omitempty"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type PlaybackQueueStatus struct {
	Queue *PlaybackQueue `json:"queue"`
}

type PlaybackRadio struct {
	Current RadioStation   `json:"current"`
	Queue   []RadioStation `json:"queue,omitempty"`
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
