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
		field.Int64("mod_time_unix_nano").Default(0),
		field.String("content_hash").Default(""),
		field.Float("duration_seconds").Default(0),
		field.Int("sample_rate").Default(0),
		field.Int("bit_rate").Default(0),
		field.Int("bit_depth").Default(0),
		field.Int("year").Default(0),
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
		edge.To("user_favorites", UserSongFavorite.Type),
		edge.To("play_history", PlayHistory.Type),
	}
}

func (Song) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("content_hash"),
		index.Fields("title"),
		index.Fields("file_name"),
		index.Fields("favorite"),
		index.Fields("netease_id"),
		index.Fields("created_at"),
		index.Fields("updated_at"),
		index.Edges("artist"),
		index.Edges("album"),
	}
}
