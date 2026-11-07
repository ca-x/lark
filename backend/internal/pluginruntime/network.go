package pluginruntime

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

func PublicIP(address netip.Addr) bool {
	address = address.Unmap()
	return address.IsValid() && address.IsGlobalUnicast() && !address.IsPrivate() && !address.IsLoopback() && !address.IsLinkLocalUnicast() && !netip.MustParsePrefix("100.64.0.0/10").Contains(address) && !netip.MustParsePrefix("0.0.0.0/8").Contains(address)
}

func ValidateURL(address *url.URL) error {
	if address == nil || (address.Scheme != "https" && address.Scheme != "http") || address.Hostname() == "" || address.User != nil || len(address.String()) > 16<<10 {
		return errors.New("a public HTTP(S) URL without credentials is required")
	}
	if ip, err := netip.ParseAddr(address.Hostname()); err == nil && !PublicIP(ip) {
		return errors.New("private network access is unavailable")
	}
	return nil
}

func HostMatches(host, pattern string) bool {
	host, pattern = strings.ToLower(strings.TrimSuffix(host, ".")), strings.ToLower(strings.TrimSuffix(pattern, "."))
	if pattern == "*" {
		return true
	}
	if strings.HasPrefix(pattern, "*.") {
		return strings.HasSuffix(host, pattern[1:]) && host != pattern[2:]
	}
	return host == pattern
}

func SameOrigin(first, second *url.URL) bool {
	port := func(address *url.URL) string {
		if value := address.Port(); value != "" {
			return value
		}
		if address.Scheme == "https" {
			return "443"
		}
		return "80"
	}
	return first.Scheme == second.Scheme && strings.EqualFold(first.Hostname(), second.Hostname()) && port(first) == port(second)
}

type redirectCredentialsKey struct{}

type publicTransport struct{ *http.Transport }

func (transport publicTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if strip, _ := request.Context().Value(redirectCredentialsKey{}).(bool); strip {
		request = request.Clone(request.Context())
		request.Header.Del("Cookie")
		request.Header.Del("Cookie2")
	}
	return transport.Transport.RoundTrip(request)
}

func CheckRedirect(request *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return errors.New("too many redirects")
	}
	if err := ValidateURL(request.URL); err != nil {
		return err
	}
	if len(via) > 0 {
		if via[len(via)-1].URL.Scheme == "https" && request.URL.Scheme != "https" {
			return errors.New("HTTPS downgrade is unavailable")
		}
		crossOrigin := !SameOrigin(request.URL, via[0].URL)
		*request = *request.WithContext(context.WithValue(request.Context(), redirectCredentialsKey{}, crossOrigin))
		if crossOrigin {
			request.Header = make(http.Header)
		}
	}
	return nil
}

func NewHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.ResponseHeaderTimeout = 30 * time.Second
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		if len(addresses) == 0 {
			return nil, errors.New("empty DNS response")
		}
		for _, ip := range addresses {
			if !PublicIP(ip) {
				return nil, errors.New("private network access is unavailable")
			}
		}
		dialer := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
		var failures []error
		for _, ip := range addresses {
			connection, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return connection, nil
			}
			failures = append(failures, err)
		}
		return nil, errors.Join(failures...)
	}
	return &http.Client{Transport: publicTransport{transport}, Timeout: 90 * time.Second, CheckRedirect: CheckRedirect}
}
