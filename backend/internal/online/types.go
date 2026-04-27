package online

import "context"

type Song struct {
	ID       string
	Source   string
	Title    string
	Artist   string
	Album    string
	AlbumID  string
	Cover    string
	Duration int
	Extra    map[string]string
}

type Track struct {
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	DurationSec int    `json:"duration_seconds"`
	TrackNumber int    `json:"track_number"`
}

type AlbumCandidate struct {
	ID          string            `json:"id"`
	Source      string            `json:"source"`
	Title       string            `json:"title"`
	Artist      string            `json:"artist"`
	Cover       string            `json:"cover"`
	ReleaseDate string            `json:"release_date"`
	Year        int               `json:"year"`
	Description string            `json:"description"`
	TrackCount  int               `json:"track_count"`
	Link        string            `json:"link"`
	Extra       map[string]string `json:"extra,omitempty"`
}

type AlbumInfo struct {
	AlbumCandidate
	Tracks []Track `json:"tracks,omitempty"`
}

type ArtistCandidate struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	Link   string `json:"link"`
}

type Provider interface {
	Name() string
	SearchSongs(ctx context.Context, title, artist string) ([]Song, error)
	Lyrics(ctx context.Context, song Song) (string, error)
	SearchAlbums(ctx context.Context, title, artist string) ([]AlbumCandidate, error)
	AlbumInfo(ctx context.Context, id string) (AlbumInfo, error)
	SearchArtists(ctx context.Context, name string) ([]ArtistCandidate, error)
}
