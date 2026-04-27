package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

type Album struct{ ent.Schema }

func (Album) Fields() []ent.Field {
	return []ent.Field{
		field.String("title").NotEmpty(),
		field.String("album_artist").Default(""),
		field.String("cover_path").Default(""),
		field.Int("year").Default(0),
		field.Bool("favorite").Default(false),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Album) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("artist", Artist.Type).Ref("albums").Unique(),
		edge.To("songs", Song.Type),
		edge.To("user_favorites", UserAlbumFavorite.Type),
	}
}
