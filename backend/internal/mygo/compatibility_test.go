package mygo

import (
	"context"
	"encoding/json/v2"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func TestRealLizhiStreamingPlugin(t *testing.T) {
	fixture := os.Getenv("LARK_MYGO_LIZHI_FIXTURE")
	if fixture == "" {
		t.Skip("set LARK_MYGO_LIZHI_FIXTURE to a locally reviewed upstream index.js; upstream has no redistribution license")
	}
	contents, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{values: map[string][]byte{}}
	service, err := New(t.Context(), store, t.TempDir(), WithHTTPClientFactory(func() *http.Client {
		return &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			body := `{"tree":[{"type":"blob","path":"audio/Album/Fixture.mp3","size":1024}]}`
			if request.URL.Host != "api.github.com" {
				t.Errorf("unexpected fixture network: %s", request.URL.Host)
			}
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
		})}
	}))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close(context.Background()) })
	manifest := `{"id":"demo","name":"Li Zhi","permissions":{"network":["api.github.com","testingcf.jsdelivr.net","raw.githubusercontent.com","lrclib.net"]}}`
	preview, err := service.Preview(t.Context(), testPackage(t, string(contents), map[string]string{"plugin.json": manifest}), "djyde/mygo-lizhi@87b97fd99a8453c56af5a768ce48a3454305f869")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Install(t.Context(), preview.Token); err != nil {
		t.Fatal(err)
	}
	_ = service.SetEnabled(t.Context(), "demo", true)
	_ = service.Resume(t.Context())
	result, err := service.Call(t.Context(), 1, "demo", "search", []byte(`{"query":"Fixture","kind":"tracks","offset":0}`))
	if err != nil {
		t.Fatal(err)
	}
	var page struct {
		Tracks []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"tracks"`
	}
	if err := json.Unmarshal(result, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Tracks) != 1 || page.Tracks[0].Name != "Fixture" {
		t.Fatalf("unexpected search: %s", result)
	}
	stream, err := service.Stream(t.Context(), 1, "demo", page.Tracks[0].ID, "high")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Release()
	if stream.URL != "https://testingcf.jsdelivr.net/gh/nj-lizhi/song@main/audio/Album/Fixture.mp3" {
		t.Fatal("unexpected stream", stream.URL)
	}
	if _, err := service.Call(t.Context(), 1, "demo", "like", []byte(`{"id":"audio/Album/Fixture.mp3","on":true}`)); err != nil {
		t.Fatal(err)
	}
	liked, err := service.Call(t.Context(), 1, "demo", "liked", []byte(`{"offset":0}`))
	if err != nil || !strings.Contains(string(liked), "Fixture") {
		t.Fatal("favorite did not persist", string(liked), err)
	}
	other, err := service.Call(t.Context(), 2, "demo", "liked", []byte(`{"offset":0}`))
	if err != nil || strings.Contains(string(other), "Fixture") {
		t.Fatal("favorite leaked to another user", string(other), err)
	}
}

func TestPackagedTypeScriptImports(t *testing.T) {
	store := &memoryStore{values: map[string][]byte{}}
	service, err := New(t.Context(), store, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close(context.Background()) })
	preview, err := service.Preview(t.Context(), testPackage(t, "", map[string]string{"plugin.json": `{"id":"demo","name":"TS Demo","main":"index.ts","permissions":{}}`, "index.ts": `import { word } from "./word.ts"; export function home(): {title: string} { return {title:word}; }`, "word.ts": `export const word: string = "TypeScript module";`}), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Install(t.Context(), preview.Token); err != nil {
		t.Fatal(err)
	}
	_ = service.SetEnabled(t.Context(), "demo", true)
	_ = service.Resume(t.Context())
	result, err := service.Call(t.Context(), 1, "demo", "home", nil)
	if err != nil || !strings.Contains(string(result), "TypeScript module") {
		t.Fatal(string(result), err)
	}
}
