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
		field.Float("progress_seconds").Default(0),
		field.Float("duration_seconds").Default(0),
		field.Bool("completed").Default(false),
		field.String("device_type").Default("pc"),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
		field.Int("song_id").StorageKey("song_play_history").StructTag(`json:"-"`),
		field.Int("user_id").StorageKey("user_play_history").StructTag(`json:"-"`),
	}
}

func (PlayHistory) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("play_history").Field("user_id").Unique().Required(),
		edge.From("song", Song.Type).Ref("play_history").Field("song_id").Unique().Required(),
	}
}

func (PlayHistory) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("user"),
		index.Edges("song"),
		index.Edges("user").Fields("device_type", "updated_at"),
		index.Edges("user", "song").Fields("device_type", "updated_at"),
		index.Edges("user").Fields("updated_at"),
		index.Edges("user", "song").Fields("updated_at"),
		index.Fields("user_id", "song_id", "updated_at", "played_at", "id").StorageKey("playhistory_user_song_latest"),
		index.Fields("user_id", "song_id", "device_type", "updated_at", "played_at", "id").StorageKey("playhistory_user_song_device_latest"),
	}
}
