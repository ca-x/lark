package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

type User struct{ ent.Schema }

func (User) Fields() []ent.Field {
	return []ent.Field{
		field.String("username").Unique().NotEmpty(),
		field.String("password_hash").NotEmpty(),
		field.String("role").Default("user"),
		field.String("nickname").Default(""),
		field.Text("avatar_data_url").Default(""),
		field.String("mcp_token_hash").Default("").Sensitive(),
		field.String("mcp_token_hint").Default(""),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (User) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("sessions", Session.Type),
		edge.To("playlists", Playlist.Type),
		edge.To("song_favorites", UserSongFavorite.Type),
		edge.To("album_favorites", UserAlbumFavorite.Type),
		edge.To("artist_favorites", UserArtistFavorite.Type),
		edge.To("play_history", PlayHistory.Type),
	}
}
