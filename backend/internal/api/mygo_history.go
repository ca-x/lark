package api

import (
	"encoding/json/v2"
	"io"
	"net/http"

	"lark/backend/internal/mygo"

	echo "github.com/labstack/echo/v5"
)

func (s *Server) handleMygoHistory(c *echo.Context) error {
	contents, err := io.ReadAll(http.MaxBytesReader(c.Response(), c.Request().Body, mygo.MaxHistoryRequestBytes))
	var update mygo.HistoryUpdate
	if err != nil || json.Unmarshal(contents, &update, json.RejectUnknownMembers(true)) != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid mygo history")
	}
	ctx := c.Request().Context()
	userID := currentUserID(c)
	settings, err := s.lib.GetSettings(ctx)
	if err != nil {
		return mapError(err)
	}
	historySettings, err := s.lib.GetPlaybackHistorySettings(ctx, userID)
	if err != nil {
		return mapError(err)
	}
	deviceType := requestPlaybackDeviceType(c)
	deviceScope := ""
	if historySettings.SeparateByDevice {
		deviceScope = deviceType
	}
	if err := s.mygo.SaveHistory(ctx, userID, deviceType, deviceScope, settings.PlaybackHistoryRetentionDays, update); err != nil {
		return mygoHTTPError(err)
	}
	return c.NoContent(http.StatusNoContent)
}
