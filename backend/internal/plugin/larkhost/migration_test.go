package larkhost

import (
	"database/sql"
	"path/filepath"
	"testing"

	"lark/backend/ent"
	"lark/backend/ent/playlist"

	_ "github.com/lib-x/entsqlite"
)

func TestAdditivePluginSchemaMigrationPreservesLegacyLibrary(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "legacy.db") + "?_pragma=foreign_keys(1)"
	database, err := sql.Open("sqlite3", dsn)
	if err != nil {
		t.Fatal(err)
	}
	legacyDDL := []string{
		`CREATE TABLE songs (
			id integer PRIMARY KEY AUTOINCREMENT, title text NOT NULL, path text NOT NULL UNIQUE,
			file_name text NOT NULL, format text NOT NULL DEFAULT '', mime text NOT NULL DEFAULT 'application/octet-stream',
			size_bytes integer NOT NULL DEFAULT 0, mod_time_unix_nano integer NOT NULL DEFAULT 0,
			content_hash text NOT NULL DEFAULT '', duration_seconds real NOT NULL DEFAULT 0,
			sample_rate integer NOT NULL DEFAULT 0, bit_rate integer NOT NULL DEFAULT 0, bit_depth integer NOT NULL DEFAULT 0,
			year integer NOT NULL DEFAULT 0, lyrics_embedded text NOT NULL DEFAULT '', lyrics_source text NOT NULL DEFAULT '',
			has_lyrics boolean NOT NULL DEFAULT false, netease_id text NOT NULL DEFAULT '', favorite boolean NOT NULL DEFAULT false,
			play_count integer NOT NULL DEFAULT 0, last_played_at datetime NULL, created_at datetime NOT NULL,
			updated_at datetime NOT NULL, album_songs integer NULL, artist_songs integer NULL
		)`,
		`CREATE TABLE playlists (
			id integer PRIMARY KEY AUTOINCREMENT, name text NOT NULL, description text NOT NULL DEFAULT '',
			cover_theme text NOT NULL DEFAULT 'deep-space', favorite boolean NOT NULL DEFAULT false,
			created_at datetime NOT NULL, updated_at datetime NOT NULL, user_playlists integer NULL
		)`,
		`CREATE TABLE playlist_songs (playlist_id integer NOT NULL, song_id integer NOT NULL, PRIMARY KEY (playlist_id, song_id))`,
		`INSERT INTO songs (id,title,path,file_name,format,duration_seconds,play_count,created_at,updated_at) VALUES (7,'Legacy','/music/legacy.flac','legacy.flac','flac',180,12,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
		`INSERT INTO playlists (id,name,description,created_at,updated_at) VALUES (3,'Legacy list','kept',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
		`INSERT INTO playlist_songs (playlist_id,song_id) VALUES (3,7)`,
	}
	for _, statement := range legacyDDL {
		if _, err := database.Exec(statement); err != nil {
			database.Close()
			t.Fatalf("legacy setup: %v", err)
		}
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	client, err := ent.Open("sqlite3", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err := client.Schema.Create(t.Context()); err != nil {
		t.Fatalf("additive migration: %v", err)
	}
	legacy, err := client.Song.Get(t.Context(), 7)
	if err != nil {
		t.Fatal(err)
	}
	if legacy.Title != "Legacy" || legacy.Path != "/music/legacy.flac" || legacy.PlayCount != 12 || legacy.SourceType != "local" || legacy.URL != "" || legacy.PluginEntryPath != "" {
		t.Fatalf("legacy song changed after migration: %+v", legacy)
	}
	legacyPlaylist, err := client.Playlist.Query().Where(playlist.ID(3)).WithSongs().Only(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if legacyPlaylist.Name != "Legacy list" || legacyPlaylist.CoverURL != "" || len(legacyPlaylist.Edges.Songs) != 1 || legacyPlaylist.Edges.Songs[0].ID != 7 {
		t.Fatalf("legacy playlist changed after migration: %+v", legacyPlaylist)
	}
}
