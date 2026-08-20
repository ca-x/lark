package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
)

// Plugin stores the manifest and lifecycle state of an installed SongLoft
// plugin. Collection-like manifest fields are JSON encoded by Ent so callers
// never need to expose database-specific representations.
type Plugin struct{ ent.Schema }

func (Plugin) Fields() []ent.Field {
	return []ent.Field{
		field.String("name").NotEmpty(),
		field.String("version").NotEmpty(),
		field.Text("description").Default(""),
		field.String("author").Default(""),
		field.String("homepage").Default(""),
		field.String("license").Default(""),
		field.String("entry_path").Unique().NotEmpty(),
		field.String("main").NotEmpty(),
		field.String("min_host_version").Default(""),
		field.JSON("permissions", []string{}),
		field.JSON("public_paths", []string{}),
		field.JSON("external_paths", []string{}),
		field.String("icon").Default(""),
		field.String("update_url").Default(""),
		field.String("download_url").Default(""),
		field.String("render_engine").Default(""),
		field.String("status").Default("inactive"),
		field.String("zip_hash").Default(""),
		field.String("entry_hash").Default(""),
		field.String("file_mod_time").Default(""),
		field.String("file_path").Default(""),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
