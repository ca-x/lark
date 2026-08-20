package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	"lark/backend/ent"

	echo "github.com/labstack/echo/v5"
)

const (
	maxPluginMediaURLLength   = 16 << 10
	maxPluginMediaHeaders     = 64
	maxPluginMediaHeaderBytes = 64 << 10
	pluginMediaHeaderTimeout  = 60 * time.Second
)

var pluginMediaResponseHeaders = []string{
	"Content-Type",
	"Content-Length",
	"Content-Range",
	"Accept-Ranges",
	"Content-Encoding",
	"Cache-Control",
	"ETag",
	"Last-Modified",
}

var forbiddenPluginMediaRequestHeaders = map[string]struct{}{
	"Connection":          {},
	"Content-Length":      {},
	"Host":                {},
	"Keep-Alive":          {},
	"Proxy-Authenticate":  {},
	"Proxy-Authorization": {},
	"Proxy-Connection":    {},
	"Range":               {},
	"TE":                  {},
	"Trailer":             {},
	"Transfer-Encoding":   {},
	"Upgrade":             {},
}

func newPluginMediaClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DisableCompression = true
	transport.ResponseHeaderTimeout = pluginMediaHeaderTimeout
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, fmt.Errorf("split media address: %w", err)
		}
		addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, fmt.Errorf("resolve media host %q: %w", host, err)
		}
		if len(addresses) == 0 {
			return nil, fmt.Errorf("resolve media host %q: no addresses", host)
		}
		for _, resolved := range addresses {
			if !isAllowedPluginMediaIP(resolved) {
				return nil, fmt.Errorf("media host %q resolved to unsafe address %s", host, resolved)
			}
		}
		dialer := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
		var dialErr error
		for _, resolved := range addresses {
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(resolved.String(), port))
			if err == nil {
				return conn, nil
			}
			dialErr = errors.Join(dialErr, err)
		}
		return nil, fmt.Errorf("connect to media host %q: %w", host, dialErr)
	}
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many media redirects")
			}
			if err := validatePluginMediaURL(request.URL); err != nil {
				return err
			}
			applyBasicAuthFromMediaURL(request)
			return nil
		},
	}
}

func isAllowedPluginMediaIP(address netip.Addr) bool {
	if address.Is4In6() {
		address = address.Unmap()
	}
	// Private and loopback media servers are intentional SongLoft use cases
	// (Subsonic/Navidrome/NAS). Link-local, multicast, unspecified, and other
	// non-unicast destinations are not valid media origins and include cloud
	// metadata endpoints such as 169.254.169.254.
	return address.IsValid() && (address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback()) &&
		!address.IsLinkLocalUnicast() && !address.IsMulticast() && !address.IsUnspecified()
}

func validatePluginMediaURL(parsed *url.URL) error {
	if parsed == nil {
		return errors.New("media URL is required")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("unsupported media URL scheme %q", parsed.Scheme)
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return errors.New("media URL host is required")
	}
	if len(parsed.String()) > maxPluginMediaURLLength {
		return errors.New("media URL is too long")
	}
	return nil
}

func parsePluginMediaURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("parse media URL: %w", err)
	}
	if err := validatePluginMediaURL(parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

func applyBasicAuthFromMediaURL(request *http.Request) {
	if request == nil || request.URL == nil || request.URL.User == nil {
		return
	}
	password, _ := request.URL.User.Password()
	request.SetBasicAuth(request.URL.User.Username(), password)
	request.URL.User = nil
}

func applyPluginMediaRequestHeaders(header http.Header, values map[string]string) error {
	if len(values) > maxPluginMediaHeaders {
		return errors.New("plugin returned too many media request headers")
	}
	totalBytes := 0
	for name, value := range values {
		canonicalName := textproto.CanonicalMIMEHeaderKey(strings.TrimSpace(name))
		if canonicalName == "" || strings.ContainsAny(value, "\r\n\x00") {
			return fmt.Errorf("plugin returned an invalid media request header %q", name)
		}
		if _, forbidden := forbiddenPluginMediaRequestHeaders[canonicalName]; forbidden {
			return fmt.Errorf("plugin returned forbidden media request header %q", canonicalName)
		}
		totalBytes += len(canonicalName) + len(value)
		if totalBytes > maxPluginMediaHeaderBytes {
			return errors.New("plugin media request headers are too large")
		}
		header.Set(canonicalName, value)
	}
	return nil
}

func copyPluginMediaResponseHeaders(destination, source http.Header) {
	for _, name := range pluginMediaResponseHeaders {
		if value := source.Get(name); value != "" {
			destination.Set(name, value)
		}
	}
	if destination.Get("Cache-Control") == "" {
		destination.Set("Cache-Control", "no-store")
	}
	destination.Set("X-Content-Type-Options", "nosniff")
}

func proxyPluginMedia(
	ctx context.Context,
	response http.ResponseWriter,
	request *http.Request,
	rawURL string,
	pluginHeaders map[string]string,
	client *http.Client,
) error {
	parsed, err := parsePluginMediaURL(rawURL)
	if err != nil {
		return err
	}
	method := http.MethodGet
	if request.Method == http.MethodHead {
		method = http.MethodHead
	}
	upstreamRequest, err := http.NewRequestWithContext(ctx, method, parsed.String(), nil)
	if err != nil {
		return fmt.Errorf("create media request: %w", err)
	}
	applyBasicAuthFromMediaURL(upstreamRequest)
	upstreamRequest.Header.Set("User-Agent", "Lark/SongLoft-Plugin")
	if accept := request.Header.Get("Accept"); accept != "" {
		upstreamRequest.Header.Set("Accept", accept)
	}
	if err := applyPluginMediaRequestHeaders(upstreamRequest.Header, pluginHeaders); err != nil {
		return err
	}
	if requestedRange := request.Header.Get("Range"); requestedRange != "" {
		upstreamRequest.Header.Set("Range", requestedRange)
	}
	if client == nil {
		client = newPluginMediaClient()
	}
	upstreamResponse, err := client.Do(upstreamRequest)
	if err != nil {
		return fmt.Errorf("fetch plugin media: %w", err)
	}
	defer upstreamResponse.Body.Close()

	copyPluginMediaResponseHeaders(response.Header(), upstreamResponse.Header)
	response.WriteHeader(upstreamResponse.StatusCode)
	if method == http.MethodHead {
		return nil
	}
	if _, err := io.Copy(response, upstreamResponse.Body); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, net.ErrClosed) {
		return fmt.Errorf("stream plugin media: %w", err)
	}
	return nil
}

func (s *Server) streamRemoteSong(c *echo.Context, item *ent.Song) error {
	if item == nil {
		return echo.NewHTTPError(http.StatusNotFound, "song not found")
	}
	mediaURL := strings.TrimSpace(item.URL)
	var mediaHeaders map[string]string
	if item.PluginEntryPath != "" && item.SourceData != "" {
		if s.pluginManager == nil {
			return echo.NewHTTPError(http.StatusServiceUnavailable, "plugin runtime is unavailable")
		}
		resolved, err := s.pluginManager.ResolveSongURL(
			c.Request().Context(), item.PluginEntryPath, item.SourceData,
			item.Title, item.SourceArtist, item.DurationSeconds,
		)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadGateway, "plugin audio source is unavailable").Wrap(err)
		}
		mediaURL = resolved.URL
		mediaHeaders = resolved.Headers
	}
	if mediaURL == "" {
		return echo.NewHTTPError(http.StatusBadGateway, "remote song has no playable URL")
	}
	if err := proxyPluginMedia(
		c.Request().Context(), c.Response(), c.Request(), mediaURL, mediaHeaders, nil,
	); err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, "remote audio source is unavailable").Wrap(err)
	}
	return nil
}
