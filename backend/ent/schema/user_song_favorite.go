package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type UserSongFavorite struct{ ent.Schema }

func (UserSongFavorite) Fields() []ent.Field {
	return []ent.Field{
		field.Time("created_at").Default(time.Now),
	}
}

func (UserSongFavorite) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("song_favorites").Unique().Required(),
		edge.From("song", Song.Type).Ref("user_favorites").Unique().Required(),
	}
}

func (UserSongFavorite) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("user", "song").Unique(),
		index.Edges("user").Fields("created_at"),
	}
}
