package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Song struct{ ent.Schema }

func (Song) Fields() []ent.Field {
	return []ent.Field{
		field.String("title").NotEmpty(),
		field.String("path").Unique().NotEmpty(),
		field.String("file_name").NotEmpty(),
		field.String("format").Default(""),
		field.String("mime").Default("application/octet-stream"),
		field.Int64("size_bytes").Default(0),
		field.Float("duration_seconds").Default(0),
		field.Int("sample_rate").Default(0),
		field.Int("bit_rate").Default(0),
		field.Int("bit_depth").Default(0),
		field.String("lyrics_embedded").Default(""),
		field.String("lyrics_source").Default(""),
		field.String("netease_id").Default(""),
		field.Bool("favorite").Default(false),
		field.Int("play_count").Default(0),
		field.Time("last_played_at").Optional().Nillable(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Song) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("artist", Artist.Type).Ref("songs").Unique(),
		edge.From("album", Album.Type).Ref("songs").Unique(),
		edge.From("playlists", Playlist.Type).Ref("songs"),
	}
}

func (Song) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("title"),
		index.Fields("favorite"),
		index.Fields("netease_id"),
	}
}
