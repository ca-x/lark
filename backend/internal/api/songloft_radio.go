package api

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"

	"lark/backend/ent"
	"lark/backend/ent/song"

	echo "github.com/labstack/echo/v5"
)

func (s *Server) handleSongLoftRadioSongs(c *echo.Context) error {
	var inputs []struct {
		URL      string `json:"url"`
		Title    string `json:"title"`
		Artist   string `json:"artist"`
		CoverURL string `json:"cover_url"`
		IsVideo  bool   `json:"is_video"`
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 1<<20)
	if err := c.Bind(&inputs); err != nil || len(inputs) == 0 || len(inputs) > 1000 {
		return echo.NewHTTPError(http.StatusBadRequest, "expected 1-1000 radio stations")
	}
	for index := range inputs {
		input := &inputs[index]
		input.Title = strings.TrimSpace(input.Title)
		parsed, err := parsePluginMediaURL(input.URL)
		if err != nil || input.Title == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "radio requires a title and an HTTP(S) URL")
		}
		input.URL = parsed.String()
	}
	ctx := c.Request().Context()
	transaction, err := s.client.Tx(ctx)
	if err != nil {
		return mapError(err)
	}
	defer transaction.Rollback()
	items := make([]*ent.Song, 0, len(inputs))
	for _, input := range inputs {
		path := fmt.Sprintf("radio://%x", sha256.Sum256([]byte(input.URL)))
		existing, err := transaction.Song.Query().Where(song.PathEQ(path), song.SourceTypeEQ("radio")).Only(ctx)
		var item *ent.Song
		if ent.IsNotFound(err) {
			item, err = transaction.Song.Create().SetTitle(input.Title).SetPath(path).SetFileName(input.Title).
				SetSourceType("radio").SetURL(input.URL).SetSourceArtist(strings.TrimSpace(input.Artist)).
				SetCoverURL(strings.TrimSpace(input.CoverURL)).SetIsLive(true).SetIsVideo(input.IsVideo).Save(ctx)
		} else if err == nil {
			item, err = existing.Update().SetTitle(input.Title).SetFileName(input.Title).
				SetSourceArtist(strings.TrimSpace(input.Artist)).SetCoverURL(strings.TrimSpace(input.CoverURL)).
				SetIsLive(true).SetIsVideo(input.IsVideo).Save(ctx)
		}
		if err != nil {
			return mapError(err)
		}
		items = append(items, item)
	}
	if err := transaction.Commit(); err != nil {
		return mapError(err)
	}
	s.lib.PluginCatalogChanged(ctx, currentUserID(c))
	return c.JSON(http.StatusCreated, map[string]any{"songs": mapSongLoftSongs(items), "count": len(items)})
}
