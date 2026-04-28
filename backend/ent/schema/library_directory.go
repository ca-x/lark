package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type LibraryDirectory struct{ ent.Schema }

func (LibraryDirectory) Fields() []ent.Field {
	return []ent.Field{
		field.String("path").NotEmpty(),
		field.String("note").Default(""),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (LibraryDirectory) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("library_directories").Unique().Required(),
	}
}

func (LibraryDirectory) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("path").Edges("user").Unique(),
	}
}
