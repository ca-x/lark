package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

type Playlist struct{ ent.Schema }

func (Playlist) Fields() []ent.Field {
	return []ent.Field{
		field.String("name").Unique().NotEmpty(),
		field.Text("description").Default(""),
		field.String("cover_theme").Default("deep-space"),
		field.Bool("favorite").Default(false),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Playlist) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("songs", Song.Type),
	}
}
