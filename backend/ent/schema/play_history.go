package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type PlayHistory struct{ ent.Schema }

func (PlayHistory) Fields() []ent.Field {
	return []ent.Field{
		field.Time("played_at").Default(time.Now),
	}
}

func (PlayHistory) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("play_history").Unique().Required(),
		edge.From("song", Song.Type).Ref("play_history").Unique().Required(),
	}
}

func (PlayHistory) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("user"),
		index.Edges("song"),
	}
}
