package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// PlaylistSongPosition adds SongLoft's stable playlist ordering semantics
// without replacing Lark's existing Ent many-to-many playlist_songs table.
// Existing relations remain intact; rows are populated lazily when a plugin
// adds or reorders songs.
type PlaylistSongPosition struct{ ent.Schema }

func (PlaylistSongPosition) Fields() []ent.Field {
	return []ent.Field{
		field.Int("playlist_id"),
		field.Int("song_id"),
		field.Int("position"),
	}
}

func (PlaylistSongPosition) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("playlist_id", "song_id").Unique(),
		index.Fields("playlist_id", "position"),
	}
}
