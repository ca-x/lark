package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"lark/backend/internal/models"
	"lark/backend/pkg/version"

	echo "github.com/labstack/echo/v5"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type mcpTokenRequest struct {
	Token string `json:"token"`
}

type listArtistsInput struct {
	Limit int `json:"limit,omitempty" jsonschema:"Maximum number of artists to return. Defaults to 200 and is capped at 500."`
}
type listAlbumsInput struct {
	Limit int `json:"limit,omitempty" jsonschema:"Maximum number of albums to return. Defaults to 200 and is capped at 500."`
}

type searchSongsInput struct {
	Query string `json:"query" jsonschema:"Search text. Match song title, file name, or audio format. Use an empty string only when you intentionally want recent library songs."`
	Limit int    `json:"limit,omitempty" jsonschema:"Maximum number of songs to return. Defaults to 50 and is capped at 200 to keep MCP responses manageable."`
}

type listFavoritesInput struct {
	Type  string `json:"type,omitempty" jsonschema:"Optional favorite type filter: songs, albums, artists, or all. Defaults to all."`
	Limit int    `json:"limit,omitempty" jsonschema:"Maximum number of favorite songs to return. Defaults to 100 and is capped at 200. Album and artist favorites are always returned for their selected type."`
}

type favoriteSongInput struct {
	SongID int `json:"song_id" jsonschema:"Song id returned by search_songs or list_favorites."`
}

type favoriteAlbumInput struct {
	AlbumID int `json:"album_id" jsonschema:"Album id returned by list_albums or list_favorites."`
}

type favoriteArtistInput struct {
	ArtistID int `json:"artist_id" jsonschema:"Artist id returned by list_artists or list_favorites."`
}

type songLyricsInput struct {
	SongID   int    `json:"song_id" jsonschema:"Song id returned by search_songs or list_favorites."`
	SourceID string `json:"source_id,omitempty" jsonschema:"Optional explicit lyric source id. Use values from the web app lyric candidate picker when available, e.g. netease id or source:id."`
}

type playSongInput struct {
	SongID int `json:"song_id" jsonschema:"Song id returned by search_songs or list_favorites."`
}

type mcpArtistsOutput struct {
	Artists []models.Artist `json:"artists" jsonschema:"Artists in the shared Lark music library with user-scoped favorite state."`
}

type mcpAlbumsOutput struct {
	Albums []models.Album `json:"albums" jsonschema:"Albums in the shared Lark music library with user-scoped favorite state."`
}

type mcpSongsOutput struct {
	Songs []models.Song `json:"songs" jsonschema:"Songs matching the request, including user-scoped favorite and resume state."`
}

type mcpFavoritesOutput struct {
	Songs   []models.Song   `json:"songs,omitempty" jsonschema:"Favorite songs for the MCP token user."`
	Albums  []models.Album  `json:"albums,omitempty" jsonschema:"Favorite albums for the MCP token user."`
	Artists []models.Artist `json:"artists,omitempty" jsonschema:"Favorite artists for the MCP token user."`
}

type mcpPlaybackOutput struct {
	Song      models.Song `json:"song" jsonschema:"Song metadata including user favorite state and resume position."`
	StreamURL string      `json:"stream_url" jsonschema:"Relative web URL for audio playback. MCP clients should resolve it against the Lark site origin and include normal browser/session credentials if needed."`
	Note      string      `json:"note" jsonschema:"Playback integration note for MCP clients."`
}

func (s *Server) handleGetMCPToken(c *echo.Context) error {
	status, err := s.lib.GetMCPTokenStatus(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleSetMCPToken(c *echo.Context) error {
	var req mcpTokenRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request")
	}
	status, err := s.lib.SetMCPToken(c.Request().Context(), currentUserID(c), req.Token)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleGenerateMCPToken(c *echo.Context) error {
	status, err := s.lib.GenerateMCPToken(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleDeleteMCPToken(c *echo.Context) error {
	status, err := s.lib.DeleteMCPToken(c.Request().Context(), currentUserID(c))
	if err != nil {
		return mapError(err)
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleMCP(c *echo.Context) error {
	s.mcp.ServeHTTP(c.Response(), c.Request())
	return nil
}

func (s *Server) newMCPHandler() http.Handler {
	return mcp.NewSSEHandler(func(request *http.Request) *mcp.Server {
		token := mcpTokenFromRequest(request)
		user, err := s.lib.AuthenticateMCPToken(request.Context(), token)
		if err != nil {
			return nil
		}
		return s.buildMCPServer(user.ID)
	}, nil)
}

func (s *Server) buildMCPServer(userID int) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "lark", Title: "Lark / 百灵 Music", Version: version.GetVersion()}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_artists",
		Title:       "List library artists",
		Description: "Return every artist in the shared Lark music library, with song_count, album_count, and favorite=true when this MCP token user has favorited the artist. Use this before opening artist pages, filtering albums by artist, or managing favorite artists.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input listArtistsInput) (*mcp.CallToolResult, mcpArtistsOutput, error) {
		items, err := s.lib.Artists(ctx, userID, normalizeMCPLimit(input.Limit, 200, 500))
		if err != nil {
			return nil, mcpArtistsOutput{}, err
		}
		out := mcpArtistsOutput{Artists: items}
		return mcpTextResult(out), out, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_albums",
		Title:       "List library albums",
		Description: "Return every album in the shared Lark music library, including album id, title, artist, album_artist, song_count, and this user's album favorite state. Use album_id with favorite_album or the web album song API when the user asks about an album.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input listAlbumsInput) (*mcp.CallToolResult, mcpAlbumsOutput, error) {
		items, err := s.lib.Albums(ctx, userID, normalizeMCPLimit(input.Limit, 200, 500))
		if err != nil {
			return nil, mcpAlbumsOutput{}, err
		}
		out := mcpAlbumsOutput{Albums: items}
		return mcpTextResult(out), out, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "search_songs",
		Title:       "Search songs",
		Description: "Search the shared Lark music library for songs by title, filename, or format. Returns user-scoped fields such as favorite and resume_position_seconds. Provide a concise query from the user's request; use limit to keep results small. If the user wants favorites, call list_favorites instead.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input searchSongsInput) (*mcp.CallToolResult, mcpSongsOutput, error) {
		limit := normalizeMCPLimit(input.Limit, 50, 200)
		items, err := s.lib.Songs(ctx, userID, input.Query, false, limit)
		if err != nil {
			return nil, mcpSongsOutput{}, err
		}
		out := mcpSongsOutput{Songs: items}
		return mcpTextResult(out), out, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_favorites",
		Title:       "List personal favorites",
		Description: "List this MCP token user's favorites. Favorites are personal, not global: songs, albums, and artists are scoped to the authenticated user. Optional type can be songs, albums, artists, or all. Use this for the top-level Favorites page or when a user asks what they liked/collected.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input listFavoritesInput) (*mcp.CallToolResult, mcpFavoritesOutput, error) {
		out, err := s.mcpFavorites(ctx, userID, input.Type, normalizeMCPLimit(input.Limit, 100, 200))
		if err != nil {
			return nil, mcpFavoritesOutput{}, err
		}
		return mcpTextResult(out), out, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "favorite_song",
		Title:       "Toggle song favorite",
		Description: "Toggle a song in or out of this user's personal favorites. Requires song_id from search_songs/list_favorites. Returns the updated song with favorite=true when it is now favorited and favorite=false when removed.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input favoriteSongInput) (*mcp.CallToolResult, models.Song, error) {
		if input.SongID <= 0 {
			return nil, models.Song{}, fmt.Errorf("song_id is required")
		}
		item, err := s.lib.ToggleSongFavorite(ctx, userID, input.SongID)
		if err != nil {
			return nil, models.Song{}, err
		}
		return mcpTextResult(item), item, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "favorite_album",
		Title:       "Toggle album favorite",
		Description: "Toggle an album in or out of this user's personal favorites. Requires album_id from list_albums/list_favorites. Returns the updated album with the user-scoped favorite state.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input favoriteAlbumInput) (*mcp.CallToolResult, models.Album, error) {
		if input.AlbumID <= 0 {
			return nil, models.Album{}, fmt.Errorf("album_id is required")
		}
		item, err := s.lib.ToggleAlbumFavorite(ctx, userID, input.AlbumID)
		if err != nil {
			return nil, models.Album{}, err
		}
		return mcpTextResult(item), item, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "favorite_artist",
		Title:       "Toggle artist favorite",
		Description: "Toggle an artist in or out of this user's personal favorites. Requires artist_id from list_artists/list_favorites. Returns the updated artist with the user-scoped favorite state.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input favoriteArtistInput) (*mcp.CallToolResult, models.Artist, error) {
		if input.ArtistID <= 0 {
			return nil, models.Artist{}, fmt.Errorf("artist_id is required")
		}
		item, err := s.lib.ToggleArtistFavorite(ctx, userID, input.ArtistID)
		if err != nil {
			return nil, models.Artist{}, err
		}
		return mcpTextResult(item), item, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_song_lyrics",
		Title:       "Get song lyrics",
		Description: "Fetch lyrics for a song. Prefer embedded lyrics; otherwise Lark attempts configured online lyric sources. Requires song_id from search_songs/list_favorites. Optional source_id can force a known lyric candidate/source when the automatic match is wrong. Returns LRC/plain lyrics and source.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input songLyricsInput) (*mcp.CallToolResult, models.Lyrics, error) {
		if input.SongID <= 0 {
			return nil, models.Lyrics{}, fmt.Errorf("song_id is required")
		}
		lyrics, err := s.lib.Lyrics(ctx, input.SongID, input.SourceID)
		if err != nil {
			return nil, models.Lyrics{}, err
		}
		return mcpTextResult(lyrics), lyrics, nil
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "play_song",
		Title:       "Prepare song playback",
		Description: "Prepare a song for playback from Lark. Requires song_id from search_songs/list_favorites. The tool records a play for this user and returns song metadata plus a relative stream_url (/api/songs/{id}/stream?mode=auto). MCP clients should resolve the URL against the Lark origin and play it with a capable audio client; backend cannot force an already-open browser tab to start playing.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input playSongInput) (*mcp.CallToolResult, mcpPlaybackOutput, error) {
		if input.SongID <= 0 {
			return nil, mcpPlaybackOutput{}, fmt.Errorf("song_id is required")
		}
		if err := s.lib.MarkPlayed(ctx, userID, input.SongID); err != nil {
			return nil, mcpPlaybackOutput{}, err
		}
		item, err := s.lib.Song(ctx, userID, input.SongID)
		if err != nil {
			return nil, mcpPlaybackOutput{}, err
		}
		out := mcpPlaybackOutput{
			Song:      item,
			StreamURL: fmt.Sprintf("/api/songs/%d/stream?mode=auto", input.SongID),
			Note:      "Use the returned stream_url for client-side playback; Lark also recorded this as a play for the MCP token user.",
		}
		return mcpTextResult(out), out, nil
	})

	return server
}

func (s *Server) mcpFavorites(ctx context.Context, userID int, favoriteType string, limit int) (mcpFavoritesOutput, error) {
	favoriteType = strings.ToLower(strings.TrimSpace(favoriteType))
	if favoriteType == "" {
		favoriteType = "all"
	}
	if favoriteType != "all" && favoriteType != "songs" && favoriteType != "albums" && favoriteType != "artists" {
		return mcpFavoritesOutput{}, fmt.Errorf("type must be songs, albums, artists, or all")
	}
	out := mcpFavoritesOutput{}
	if favoriteType == "all" || favoriteType == "songs" {
		items, err := s.lib.Songs(ctx, userID, "", true, limit)
		if err != nil {
			return out, err
		}
		out.Songs = items
	}
	if favoriteType == "all" || favoriteType == "albums" {
		items, err := s.lib.Albums(ctx, userID, 500)
		if err != nil {
			return out, err
		}
		for _, item := range items {
			if item.Favorite {
				out.Albums = append(out.Albums, item)
			}
		}
	}
	if favoriteType == "all" || favoriteType == "artists" {
		items, err := s.lib.Artists(ctx, userID, 500)
		if err != nil {
			return out, err
		}
		for _, item := range items {
			if item.Favorite {
				out.Artists = append(out.Artists, item)
			}
		}
	}
	return out, nil
}

func normalizeMCPLimit(value, defaultValue, maxValue int) int {
	if value <= 0 {
		value = defaultValue
	}
	if value > maxValue {
		value = maxValue
	}
	return value
}

func mcpTokenFromRequest(request *http.Request) string {
	if token := strings.TrimSpace(request.URL.Query().Get("token")); token != "" {
		return token
	}
	auth := strings.TrimSpace(request.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		return strings.TrimSpace(auth[len("bearer "):])
	}
	return ""
}

func mcpTextResult(value any) *mcp.CallToolResult {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		payload = []byte(fmt.Sprint(value))
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(payload)}}}
}
