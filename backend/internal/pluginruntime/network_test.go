package pluginruntime

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"testing"
)

func TestPublicNetworkPolicy(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "::1", "10.1.2.3", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::ffff:127.0.0.1", "0.0.0.0", "fc00::1"} {
		if PublicIP(netip.MustParseAddr(address)) {
			t.Fatal("unsafe IP allowed", address)
		}
	}
	for _, address := range []string{"8.8.8.8", "2606:4700:4700::1111"} {
		if !PublicIP(netip.MustParseAddr(address)) {
			t.Fatal("public IP denied", address)
		}
	}
	if !HostMatches("a.example.com", "*.example.com") || HostMatches("badexample.com", "*.example.com") {
		t.Fatal("wildcard boundary failed")
	}
	client := NewHTTPClient()
	defer client.CloseIdleConnections()
	previous, _ := http.NewRequest(http.MethodGet, "https://one.example/path", nil)
	next, _ := http.NewRequest(http.MethodGet, "https://two.example/next", nil)
	next.Header.Set("X-Private-Token", "secret")
	if err := client.CheckRedirect(next, []*http.Request{previous}); err != nil {
		t.Fatal(err)
	}
	if next.Header.Get("X-Private-Token") != "" {
		t.Fatal("credentials leaked across redirect")
	}
	address, _ := url.Parse("http://169.254.169.254/latest/meta-data")
	if ValidateURL(address) == nil {
		t.Fatal("metadata endpoint accepted")
	}
}

func TestRedirectOriginsAndDowngrade(t *testing.T) {
	client := NewHTTPClient()
	defer client.CloseIdleConnections()
	previous, _ := http.NewRequest(http.MethodGet, "https://example.com/path", nil)
	for _, target := range []string{"http://example.com/next", "https://example.com:8443/next"} {
		next, _ := http.NewRequest(http.MethodGet, target, nil)
		next.Header.Set("X-Private-Token", "secret")
		err := client.CheckRedirect(next, []*http.Request{previous})
		if target == "http://example.com/next" && err == nil {
			t.Fatal("TLS downgrade accepted")
		}
		if err == nil && next.Header.Get("X-Private-Token") != "" {
			t.Fatal("credentials leaked to different port")
		}
	}
}

func TestRedirectTransportStripsCookiesAddedByJar(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Cookie") != "" {
			t.Error("jar cookies leaked to a different origin")
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	transport := publicTransport{&http.Transport{DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}}}
	defer transport.CloseIdleConnections()
	previous, _ := http.NewRequest(http.MethodGet, "http://example.com/", nil)
	next, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://example.com:8443/", nil)
	if err := CheckRedirect(next, []*http.Request{previous}); err != nil {
		t.Fatal(err)
	}
	next.Header.Set("Cookie", "secret=jar-cookie")
	response, err := transport.RoundTrip(next)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
}
