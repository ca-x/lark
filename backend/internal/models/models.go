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

type Settings struct {
	Language            string `json:"language"`
	Theme               string `json:"theme"`
	SleepTimerMins      int    `json:"sleep_timer_mins"`
	LibraryPath         string `json:"library_path"`
	NeteaseFallback     bool   `json:"netease_fallback"`
	RegistrationEnabled bool   `json:"registration_enabled"`
}

type ScanStatus struct {
	Running     bool       `json:"running"`
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
	Errors     []string `json:"errors"`
	CurrentDir string   `json:"current_dir"`
}
