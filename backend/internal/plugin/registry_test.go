package plugin

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"testing"
)

type memoryRegistryStore struct {
	registries []RegistryConfig
	exists     bool
	saves      int
}

func (s *memoryRegistryStore) Load(context.Context) ([]RegistryConfig, bool, error) {
	return cloneRegistries(s.registries), s.exists, nil
}

func (s *memoryRegistryStore) Save(_ context.Context, registries []RegistryConfig) error {
	s.registries = cloneRegistries(registries)
	s.exists = true
	s.saves++
	return nil
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func registryClient(responses map[string]string) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		body, ok := responses[request.URL.String()]
		if !ok {
			return &http.Response{StatusCode: http.StatusNotFound, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("not found")), Request: request}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
}

func TestValidateRegistryURL(t *testing.T) {
	tests := []struct {
		url  string
		want bool
	}{
		{url: "https://raw.githubusercontent.com/org/repo/main/registry.json", want: true},
		{url: "http://example.com/registry.json"},
		{url: "https://user:pass@example.com/registry.json"},
		{url: "https://localhost/registry.json"},
		{url: "https://plugin.local/registry.json"},
		{url: "https://127.0.0.1/registry.json"},
		{url: "https://10.0.0.1/registry.json"},
		{url: "https://169.254.169.254/latest/meta-data"},
		{url: "https://[::1]/registry.json"},
		{url: "https://100.64.0.1/registry.json"},
		{url: "https://192.0.2.1/registry.json"},
	}
	for _, test := range tests {
		t.Run(test.url, func(t *testing.T) {
			if got := ValidateRegistryURL(test.url) == nil; got != test.want {
				t.Fatalf("ValidateRegistryURL(%q) success = %v, want %v", test.url, got, test.want)
			}
		})
	}
}

func TestRegistryDefaultsCanBeDeleted(t *testing.T) {
	store := &memoryRegistryStore{}
	service := NewRegistryService(store, registryClient(nil))

	registries, err := service.LoadRegistries(t.Context())
	if err != nil || len(registries) != 1 || registries[0].URL != DefaultRegistryURL || store.saves != 1 {
		t.Fatalf("initial registries = %+v, saves=%d, err=%v", registries, store.saves, err)
	}
	if err := service.SaveRegistries(t.Context(), []RegistryConfig{}); err != nil {
		t.Fatal(err)
	}
	registries, err = service.LoadRegistries(t.Context())
	if err != nil || len(registries) != 0 {
		t.Fatalf("registries after explicit delete = %+v, err=%v", registries, err)
	}
}

func TestRegistryMergeUsesHighestSemverAndSkipsDisabledSources(t *testing.T) {
	responses := map[string]string{
		"https://one.example/registry.json": `{"plugins":["https://one.example/demo.json"]}`,
		"https://one.example/demo.json":     pluginRegistryManifest("Demo", "demo-plugin", "1.0.0", "SongLoft", "https://one.example/demo.zip"),
		"https://two.example/registry.json": `{"plugins":["https://two.example/demo.json"]}`,
		"https://two.example/demo.json":     pluginRegistryManifest("Demo", "demo-plugin", "2.0.0", "SongLoft", "https://two.example/demo.zip"),
		"https://off.example/registry.json": `{"plugins":["https://off.example/demo.json"]}`,
		"https://off.example/demo.json":     pluginRegistryManifest("Demo", "demo-plugin", "9.0.0", "SongLoft", "https://off.example/demo.zip"),
	}
	service := NewRegistryService(registryClient(responses))
	entries, warnings, err := service.FetchAndMergeMulti(t.Context(), []RegistryConfig{
		{Name: "one", URL: "https://one.example/registry.json", Enabled: true},
		{Name: "two", URL: "https://two.example/registry.json", Enabled: true},
		{Name: "off", URL: "https://off.example/registry.json", Enabled: false},
	})
	if err != nil || len(warnings) != 0 || len(entries) != 1 {
		t.Fatalf("entries=%+v warnings=%v err=%v", entries, warnings, err)
	}
	if entries[0].Version != "2.0.0" || strings.Join(entries[0].SourceNames, ",") != "two,one" {
		t.Fatalf("merged entry = %+v", entries[0])
	}
}

func TestRegistryLimitsDepthCountAndBody(t *testing.T) {
	t.Run("include depth", func(t *testing.T) {
		responses := make(map[string]string)
		for depth := 0; depth <= RegistryMaxDepth+1; depth++ {
			url := registryDepthURL(depth)
			responses[url] = `{"includes":["` + registryDepthURL(depth+1) + `"]}`
		}
		service := NewRegistryService(registryClient(responses))
		_, warnings, err := service.FetchAndMerge(t.Context(), RegistryConfig{Name: "deep", URL: registryDepthURL(0), Enabled: true})
		if err != nil || !containsWarning(warnings, ErrRegistryDepth.Error()) {
			t.Fatalf("warnings=%v err=%v", warnings, err)
		}
	})

	t.Run("plugin count", func(t *testing.T) {
		responses := make(map[string]string, RegistryMaxPlugins+2)
		urls := make([]string, RegistryMaxPlugins+1)
		for index := range urls {
			indexString := strconv.Itoa(index)
			urls[index] = "https://plugins.example/plugin-" + indexString + ".json"
			responses[urls[index]] = pluginRegistryManifest("Plugin", "plugin-"+indexString, "1.0.0", "Author", "https://downloads.example/plugin-"+indexString+".zip")
		}
		responses["https://plugins.example/registry.json"] = `{"plugins":["` + strings.Join(urls, `","`) + `"]}`
		service := NewRegistryService(registryClient(responses))
		entries, _, err := service.FetchAndMerge(t.Context(), RegistryConfig{Name: "many", URL: "https://plugins.example/registry.json", Enabled: true})
		if err != nil || len(entries) != RegistryMaxPlugins {
			t.Fatalf("entry count=%d err=%v", len(entries), err)
		}
	})

	t.Run("response body", func(t *testing.T) {
		client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(make([]byte, RegistryMaxBody+1))), Request: request}, nil
		})}
		service := NewRegistryService(client)
		_, _, err := service.FetchAndMerge(t.Context(), RegistryConfig{Name: "large", URL: "https://large.example/registry.json", Enabled: true})
		if err != nil {
			t.Fatalf("source failures should be warnings, got %v", err)
		}
		_, warnings, _ := service.FetchAndMerge(t.Context(), RegistryConfig{Name: "large", URL: "https://large.example/registry.json", Enabled: true})
		if !containsWarning(warnings, ErrRegistryTooLarge.Error()) {
			t.Fatalf("warnings=%v", warnings)
		}
	})
}

func TestRegistryRejectsPrivateRedirect(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Hostname() != "redirect.example" {
			t.Fatalf("private redirect reached transport: %s", request.URL)
		}
		return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": []string{"https://127.0.0.1/secret"}}, Body: io.NopCloser(strings.NewReader("")), Request: request}, nil
	})}
	service := NewRegistryService(client)
	_, warnings, err := service.FetchAndMerge(t.Context(), RegistryConfig{Name: "redirect", URL: "https://redirect.example/registry.json", Enabled: true})
	if err != nil || !containsWarning(warnings, ErrInvalidRegistryURL.Error()) {
		t.Fatalf("warnings=%v err=%v", warnings, err)
	}
}

func TestRegistryTokenNeverCrossesSourceHost(t *testing.T) {
	seen := make(map[string]string)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		seen[request.URL.String()] = request.Header.Get("Authorization")
		var body string
		switch request.URL.String() {
		case "https://private.example/registry.json":
			body = `{"plugins":["https://community.example/plugin.json"]}`
		case "https://community.example/plugin.json":
			body = pluginRegistryManifest("Community", "community", "1.0.0", "Author", "https://community.example/plugin.zip")
		default:
			return nil, fmt.Errorf("unexpected URL %s", request.URL)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	service := NewRegistryService(client)
	entries, warnings, err := service.FetchAndMerge(t.Context(), RegistryConfig{
		Name: "private", URL: "https://private.example/registry.json", Enabled: true, Token: "source-secret",
	})
	if err != nil || len(warnings) != 0 || len(entries) != 1 {
		t.Fatalf("entries=%+v warnings=%v err=%v", entries, warnings, err)
	}
	if seen["https://private.example/registry.json"] != "Bearer source-secret" {
		t.Fatalf("source Authorization = %q", seen["https://private.example/registry.json"])
	}
	if seen["https://community.example/plugin.json"] != "" {
		t.Fatalf("token leaked to plugin host: %q", seen["https://community.example/plugin.json"])
	}
}

type staticResolver []netip.Addr

func (r staticResolver) LookupNetIP(context.Context, string, string) ([]netip.Addr, error) {
	return r, nil
}

type countingDialer struct{ calls int }

func (d *countingDialer) DialContext(context.Context, string, string) (net.Conn, error) {
	d.calls++
	return nil, errors.New("not connected")
}

func TestPublicDialRejectsAnyPrivateDNSAnswer(t *testing.T) {
	dialer := &countingDialer{}
	dial := publicDialContext(staticResolver{netip.MustParseAddr("8.8.8.8"), netip.MustParseAddr("10.0.0.2")}, dialer)
	_, err := dial(t.Context(), "tcp", "registry.example:443")
	if !errors.Is(err, ErrInvalidRegistryURL) || dialer.calls != 0 {
		t.Fatalf("err=%v dial calls=%d", err, dialer.calls)
	}
}

func pluginRegistryManifest(name, entryPath, version, author, downloadURL string) string {
	return `{"name":"` + name + `","entryPath":"` + entryPath + `","version":"` + version + `","author":"` + author + `","download_url":"` + downloadURL + `"}`
}

func registryDepthURL(depth int) string {
	return "https://deep.example/registry-" + strconv.Itoa(depth) + ".json"
}

func containsWarning(warnings []string, value string) bool {
	for _, warning := range warnings {
		if strings.Contains(warning, value) {
			return true
		}
	}
	return false
}
