package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Artist struct{ ent.Schema }

func (Artist) Fields() []ent.Field {
	return []ent.Field{
		field.String("name").Unique().NotEmpty(),
		field.String("initial").Default("#").MaxLen(1),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Artist) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("songs", Song.Type),
		edge.To("albums", Album.Type),
		edge.To("user_favorites", UserArtistFavorite.Type),
	}
}

func (Artist) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("initial"),
	}
}
