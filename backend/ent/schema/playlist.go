package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Playlist struct{ ent.Schema }

func (Playlist) Fields() []ent.Field {
	return []ent.Field{
		field.String("name").NotEmpty(),
		field.String("source_type").Default("normal"),
		field.Text("description").Default(""),
		field.String("cover_theme").Default("deep-space"),
		field.String("cover_url").Default(""),
		field.Bool("favorite").Default(false),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
		field.Int("owner_id").StorageKey("user_playlists").Optional().Nillable().StructTag(`json:"-" sql:"user_playlists"`),
	}
}

func (Playlist) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("songs", Song.Type),
		edge.From("owner", User.Type).Ref("playlists").Field("owner_id").Unique(),
	}
}

func (Playlist) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("owner").Fields("updated_at"),
		index.Fields("owner_id", "updated_at", "id").StorageKey("playlist_owner_updated"),
	}
}
