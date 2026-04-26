package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type UserAlbumFavorite struct{ ent.Schema }

func (UserAlbumFavorite) Fields() []ent.Field {
	return []ent.Field{
		field.Time("created_at").Default(time.Now),
	}
}

func (UserAlbumFavorite) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("album_favorites").Unique().Required(),
		edge.From("album", Album.Type).Ref("user_favorites").Unique().Required(),
	}
}

func (UserAlbumFavorite) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("user", "album").Unique(),
	}
}
