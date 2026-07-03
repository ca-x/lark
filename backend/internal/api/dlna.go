package api

import (
	"errors"
	"net"
	"net/http"
	"strings"

	dlnapkg "lark/backend/internal/dlna"

	echo "github.com/labstack/echo/v5"
)

func WithDLNA(service *dlnapkg.Service) Option {
	return func(s *Server) {
		s.dlna = service
	}
}

type dlnaPlayRequest struct {
	DeviceID string `json:"device_id"`
	SongID   int    `json:"song_id"`
}

type dlnaDeviceRequest struct {
	DeviceID string `json:"device_id"`
}

func (s *Server) registerDLNARoutes(auth echo.MiddlewareFunc) {
	if s.dlna == nil {
		return
	}
	s.dlna.RegisterPublicRoutes(s.echo)
	s.echo.GET("/api/dlna/status", s.handleDLNAStatus, auth)
	s.echo.GET("/api/dlna/devices", s.handleDLNADevices, auth)
	s.echo.POST("/api/dlna/discover", s.handleDLNADiscover, auth)
	s.echo.POST("/api/dlna/play", s.handleDLNAPlay, auth)
	s.echo.POST("/api/dlna/pause", s.handleDLNAPause, auth)
	s.echo.POST("/api/dlna/resume", s.handleDLNAResume, auth)
	s.echo.POST("/api/dlna/stop", s.handleDLNAStop, auth)
	s.echo.POST("/api/dlna/local", s.handleDLNALocal, auth)
}

func (s *Server) handleDLNAStatus(c *echo.Context) error {
	return c.JSON(http.StatusOK, s.dlna.Status(currentUserID(c)))
}

func (s *Server) handleDLNADevices(c *echo.Context) error {
	return c.JSON(http.StatusOK, s.dlna.Devices())
}

func (s *Server) handleDLNADiscover(c *echo.Context) error {
	devices, err := s.dlna.Discover(c.Request().Context())
	if err != nil {
		return mapDLNAError(err)
	}
	return c.JSON(http.StatusOK, devices)
}

func (s *Server) handleDLNAPlay(c *echo.Context) error {
	var req dlnaPlayRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if strings.TrimSpace(req.DeviceID) == "" || req.SongID <= 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "device_id and song_id are required")
	}
	status, err := s.dlna.PlaySong(c.Request().Context(), currentUserID(c), req.DeviceID, req.SongID, requestBaseURL(c))
	if err != nil {
		return mapDLNAError(err)
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleDLNAPause(c *echo.Context) error {
	deviceID, err := dlnaDeviceID(c)
	if err != nil {
		return err
	}
	status, err := s.dlna.Pause(c.Request().Context(), currentUserID(c), deviceID)
	if err != nil {
		return mapDLNAError(err)
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleDLNAResume(c *echo.Context) error {
	deviceID, err := dlnaDeviceID(c)
	if err != nil {
		return err
	}
	status, err := s.dlna.Resume(c.Request().Context(), currentUserID(c), deviceID)
	if err != nil {
		return mapDLNAError(err)
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleDLNAStop(c *echo.Context) error {
	deviceID, err := dlnaDeviceID(c)
	if err != nil {
		return err
	}
	status, err := s.dlna.Stop(c.Request().Context(), currentUserID(c), deviceID)
	if err != nil {
		return mapDLNAError(err)
	}
	return c.JSON(http.StatusOK, status)
}

func (s *Server) handleDLNALocal(c *echo.Context) error {
	return c.JSON(http.StatusOK, s.dlna.Local(currentUserID(c)))
}

func dlnaDeviceID(c *echo.Context) (string, error) {
	var req dlnaDeviceRequest
	if err := c.Bind(&req); err != nil {
		return "", echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if strings.TrimSpace(req.DeviceID) == "" {
		return "", echo.NewHTTPError(http.StatusBadRequest, "device_id is required")
	}
	return req.DeviceID, nil
}

func mapDLNAError(err error) error {
	switch {
	case errors.Is(err, dlnapkg.ErrDisabled):
		return echo.NewHTTPError(http.StatusConflict, "dlna is disabled")
	case errors.Is(err, dlnapkg.ErrDeviceNotFound):
		return echo.NewHTTPError(http.StatusNotFound, "dlna device not found")
	case errors.Is(err, dlnapkg.ErrDeviceUnavailable):
		return echo.NewHTTPError(http.StatusBadGateway, "dlna device unavailable")
	default:
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
}

func listenBaseURL(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return ""
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = firstLANIPv4()
	}
	if host == "" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
}

func firstLANIPv4() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip4 := ip.To4(); ip4 != nil && !ip4.IsLoopback() {
				return ip4.String()
			}
		}
	}
	return ""
}
