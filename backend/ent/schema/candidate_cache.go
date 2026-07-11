package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type CandidateCache struct{ ent.Schema }

func (CandidateCache) Fields() []ent.Field {
	return []ent.Field{
		field.Int("user_id"),
		field.String("target_type").NotEmpty(),
		field.Int("target_id"),
		field.String("query_kind").NotEmpty(),
		field.String("snapshot_hash").NotEmpty(),
		field.Text("payload").Default("[]"),
		field.Time("expires_at"),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (CandidateCache) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "target_type", "target_id", "query_kind", "snapshot_hash").Unique(),
		index.Fields("expires_at"),
		index.Fields("user_id", "target_type", "target_id"),
	}
}
