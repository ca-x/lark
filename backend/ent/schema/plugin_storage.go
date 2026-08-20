package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// PluginStorage separates volatile and persistent SongLoft storage namespaces.
type PluginStorage struct{ ent.Schema }

func (PluginStorage) Fields() []ent.Field {
	return []ent.Field{
		field.String("plugin_entry_path").NotEmpty(),
		field.String("namespace").NotEmpty(),
		field.String("key").NotEmpty(),
		field.Text("value").Default("null"),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (PluginStorage) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("plugin_entry_path", "namespace", "key").Unique(),
		index.Fields("plugin_entry_path", "namespace"),
	}
}
