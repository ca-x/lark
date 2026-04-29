package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type UserArtistFavorite struct{ ent.Schema }

func (UserArtistFavorite) Fields() []ent.Field {
	return []ent.Field{
		field.Time("created_at").Default(time.Now),
	}
}

func (UserArtistFavorite) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("artist_favorites").Unique().Required(),
		edge.From("artist", Artist.Type).Ref("user_favorites").Unique().Required(),
	}
}

func (UserArtistFavorite) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("user", "artist").Unique(),
		index.Edges("user").Fields("created_at"),
	}
}
