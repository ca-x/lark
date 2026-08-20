package plugin

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

type netIPResolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

type contextDialer interface {
	DialContext(context.Context, string, string) (net.Conn, error)
}

func clonePublicHTTPClient(base *http.Client, timeout time.Duration) *http.Client {
	if base == nil {
		base = &http.Client{}
	}
	client := *base
	if client.Timeout == 0 {
		client.Timeout = timeout
	}

	// A custom RoundTripper is useful for deterministic tests. Production uses
	// an http.Transport so DNS can be resolved once, checked, and pinned.
	if base.Transport == nil {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.Proxy = nil
		transport.DialContext = publicDialContext(net.DefaultResolver, &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second})
		client.Transport = transport
	} else if transport, ok := base.Transport.(*http.Transport); ok {
		transport = transport.Clone()
		transport.Proxy = nil
		transport.DialContext = publicDialContext(net.DefaultResolver, &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second})
		client.Transport = transport
	}
	return &client
}

func publicDialContext(resolver netIPResolver, dialer contextDialer) func(context.Context, string, string) (net.Conn, error) {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, fmt.Errorf("split plugin registry address: %w", err)
		}
		addresses, err := resolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, fmt.Errorf("resolve plugin registry host %q: %w", host, err)
		}
		if len(addresses) == 0 {
			return nil, fmt.Errorf("resolve plugin registry host %q: no addresses", host)
		}
		for _, address := range addresses {
			if !isPublicIP(address) {
				return nil, fmt.Errorf("%w: host %q resolved to %s", ErrInvalidRegistryURL, host, address)
			}
		}

		var dialErr error
		for _, resolved := range addresses {
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(resolved.String(), port))
			if err == nil {
				return conn, nil
			}
			dialErr = errors.Join(dialErr, err)
		}
		return nil, fmt.Errorf("connect to plugin registry host %q: %w", host, dialErr)
	}
}

func isPublicIP(address netip.Addr) bool {
	if address.Is4In6() {
		address = address.Unmap()
	}
	if !address.IsValid() || !address.IsGlobalUnicast() || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() || address.IsMulticast() || address.IsUnspecified() {
		return false
	}
	// Carrier-grade NAT and documentation/benchmark ranges are not publicly
	// routable destinations and must not be reachable through registry fetches.
	for _, prefix := range nonPublicPrefixes {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

var nonPublicPrefixes = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001:db8::/32"),
}

func publicRedirectPolicy(previous func(*http.Request, []*http.Request) error) func(*http.Request, []*http.Request) error {
	return func(next *http.Request, via []*http.Request) error {
		if err := ValidateRegistryURL(next.URL.String()); err != nil {
			return err
		}
		if len(via) > 0 && !strings.EqualFold(via[len(via)-1].URL.Hostname(), next.URL.Hostname()) {
			next.Header.Del("Authorization")
		}
		if previous != nil {
			return previous(next, via)
		}
		return nil
	}
}
