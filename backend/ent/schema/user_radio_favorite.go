package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type UserRadioFavorite struct{ ent.Schema }

func (UserRadioFavorite) Fields() []ent.Field {
	return []ent.Field{
		field.String("station_id").NotEmpty(),
		field.String("name").NotEmpty(),
		field.String("url").NotEmpty(),
		field.String("source_url").Default(""),
		field.String("group_name").Default(""),
		field.String("country").Default(""),
		field.String("tags").Default(""),
		field.String("codec").Default(""),
		field.Int("bitrate").Default(0),
		field.String("homepage").Default(""),
		field.String("favicon").Default(""),
		field.Time("created_at").Default(time.Now),
	}
}

func (UserRadioFavorite) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("radio_favorites").Unique().Required(),
	}
}

func (UserRadioFavorite) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("station_id").Edges("user").Unique(),
	}
}
