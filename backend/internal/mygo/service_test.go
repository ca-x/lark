package mygo

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json/v2"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type memoryStore struct {
	mu     sync.Mutex
	values map[string][]byte
}

func (s *memoryStore) Get(_ context.Context, key string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return bytes.Clone(s.values[key]), nil
}
func (s *memoryStore) Put(_ context.Context, key string, value []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[key] = bytes.Clone(value)
	return nil
}

func testPackage(t *testing.T, source string, extra map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	files := map[string]string{"plugin.json": `{"id":"demo","name":"Demo","settings":[{"key":"greeting","label":"Greeting"}],"permissions":{}}`, "index.js": source}
	for name, value := range extra {
		files[name] = value
	}
	for name, value := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func installedService(t *testing.T, source string, options ...Option) *Service {
	t.Helper()
	store := &memoryStore{values: map[string][]byte{}}
	service, err := New(t.Context(), store, t.TempDir(), options...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close(context.Background()) })
	preview, err := service.Preview(t.Context(), testPackage(t, source, nil), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Install(t.Context(), preview.Token); err != nil {
		t.Fatal(err)
	}
	if err := service.SetEnabled(t.Context(), "demo", true); err != nil {
		t.Fatal(err)
	}
	if err := service.Resume(t.Context()); err != nil {
		t.Fatal(err)
	}
	return service
}

func TestUserIsolationAsyncAndLifecycle(t *testing.T) {
	service := installedService(t, `export async function search(p) { await new Promise(resolve=>setTimeout(resolve,1)); if(p.query) host.storage.set("token",p.query); return {token:host.storage.get("token"),setting:host.setting("greeting")}; }`)
	if err := service.SaveSettings(t.Context(), 1, "demo", map[string]string{"greeting": "one"}); err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct {
		user    int
		query   string
		token   string
		setting string
	}{{1, "secret-one", "secret-one", "one"}, {2, "secret-two", "secret-two", ""}, {1, "", "secret-one", "one"}} {
		params, _ := json.Marshal(map[string]string{"query": step.query})
		result, err := service.Call(t.Context(), step.user, "demo", "search", params)
		if err != nil {
			t.Fatal(err)
		}
		var value struct {
			Token   string `json:"token"`
			Setting string `json:"setting"`
		}
		if err := json.Unmarshal(result, &value); err != nil {
			t.Fatal(err)
		}
		if value.Token != step.token || value.Setting != step.setting {
			t.Fatalf("user state leaked: %+v", value)
		}
	}
	if err := service.Suspend(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Call(t.Context(), 1, "demo", "search", []byte(`{}`)); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled call: %v", err)
	}
	if !service.List()[0].Enabled {
		t.Fatal("suspend lost plugin intent")
	}
	if err := service.Resume(t.Context()); err != nil {
		t.Fatal(err)
	}
	result, err := service.Call(t.Context(), 1, "demo", "search", []byte(`{}`))
	if err != nil || !strings.Contains(string(result), "secret-one") {
		t.Fatalf("resume lost persistent state: %s %v", result, err)
	}
	if _, err := service.Call(t.Context(), 0, "demo", "search", nil); err == nil {
		t.Fatal("anonymous VM created")
	}
}

func TestCancellationInterruptsInfiniteLoop(t *testing.T) {
	service := installedService(t, `export function search() { while(true) {} }`)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := service.Call(ctx, 1, "demo", "search", nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout = %v", err)
	}
	if time.Since(start) > time.Second {
		t.Fatal("infinite runtime did not stop")
	}
}

func TestReplacementCannotInheritAnotherOriginsCredentials(t *testing.T) {
	source := `export function search(p) { if(p.query) host.storage.set("token",p.query); return {token:host.storage.get("token"),setting:host.setting("greeting")}; }`
	service := installedService(t, source)
	original := service.List()[0]
	if err := service.SaveSettings(t.Context(), 1, "demo", map[string]string{"greeting": "secret-setting"}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Call(t.Context(), 1, "demo", "search", []byte(`{"query":"secret-token"}`)); err != nil {
		t.Fatal(err)
	}
	if err := service.Delete(t.Context(), "demo"); err != nil {
		t.Fatal(err)
	}
	preview, err := service.Preview(t.Context(), testPackage(t, source, nil), "https://github.com/another/source@revision")
	if err != nil {
		t.Fatal(err)
	}
	replacement, err := service.Install(t.Context(), preview.Token)
	if err != nil {
		t.Fatal(err)
	}
	if original.Identity == replacement.Identity {
		t.Fatal("replacement has same origin identity")
	}
	if err := service.SetEnabled(t.Context(), "demo", true); err != nil {
		t.Fatal(err)
	}
	settings, err := service.Settings(t.Context(), 1, "demo")
	if err != nil || len(settings) != 0 {
		t.Fatalf("settings leaked: %v %v", settings, err)
	}
	result, err := service.Call(t.Context(), 1, "demo", "search", []byte(`{}`))
	if err != nil || strings.Contains(string(result), "secret") {
		t.Fatalf("storage leaked: %s %v", result, err)
	}
	if _, err := service.CallFrom(t.Context(), 1, "demo", original.Identity, "search", []byte(`{}`)); err == nil {
		t.Fatal("stale source reference accepted")
	}
}

func TestOriginIdentity(t *testing.T) {
	if originIdentity("https://github.com/Owner/Repo@v1", "digest-a") != originIdentity("https://github.com/owner/repo@v2", "digest-b") {
		t.Fatal("repository update lost identity")
	}
	if originIdentity("uploaded ZIP", "digest-a") == originIdentity("uploaded ZIP", "digest-b") {
		t.Fatal("changed ZIP inherited identity")
	}
}

func TestActiveMediaLeaseSurvivesIdleEviction(t *testing.T) {
	service := installedService(t, `export function stream(){ return {url:"file:///package/tone.mp3"} } export function search(){ return {} }`)
	service.mu.Lock()
	session, err := service.sessionLocked(t.Context(), 1, "demo")
	service.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	release := session.leaseMedia()
	session.lastUsed.Store(time.Now().Add(-16 * time.Minute).UnixNano())
	if _, err := service.Call(t.Context(), 2, "demo", "search", []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	if session.closed.Load() {
		t.Fatal("active media evicted")
	}
	release()
	session.lastUsed.Store(time.Now().Add(-16 * time.Minute).UnixNano())
	if _, err := service.Call(t.Context(), 2, "demo", "search", []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	if !session.closed.Load() {
		t.Fatal("idle session not evicted after release")
	}
}

func TestMediaRedirectCannotRefillCredentialsAcrossOrigins(t *testing.T) {
	service := installedService(t, `export function search(){ return {} }`)
	service.mu.Lock()
	service.installed[0].Manifest.Permissions.Network = []string{"example.com"}
	service.mu.Unlock()
	service.mu.Lock()
	session, err := service.sessionLocked(t.Context(), 1, "demo")
	service.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	session.manifest.Permissions.Network = []string{"example.com"}
	session.manifest.RequestHeaders = []HeaderRule{{Hosts: []string{"example.com"}, Headers: map[string]string{"Authorization": "secret"}}}
	token, err := service.NewMedia(t.Context(), 1, "demo", "https://example.com/audio", "audio")
	if err != nil {
		t.Fatal(err)
	}
	media, err := service.Media(t.Context(), 1, token)
	if err != nil {
		t.Fatal(err)
	}
	defer media.Release()
	for _, target := range []string{"http://example.com/next", "https://example.com:8443/next"} {
		address, _ := url.Parse(target)
		headers, err := media.HeadersFor(address)
		if err == nil && headers.Get("Authorization") != "" {
			t.Fatal("manifest credentials refilled across origins")
		}
	}
}

func TestPackageRejectsTraversalDuplicateAndNative(t *testing.T) {
	for _, extra := range []map[string]string{{"../escape": "bad"}, {"plugin.json": `{"id":"demo","name":"Demo","permissions":{"process":true}}`}, {"plugin.json": `{"id":"demo","name":"Demo","playback":"remote","permissions":{}}`}} {
		if _, err := ReadPackage(testPackage(t, `export function home(){}`, extra)); err == nil {
			t.Fatalf("unsafe package accepted: %v", extra)
		}
	}
}

func TestOfficialDemoSearch(t *testing.T) {
	contents, err := os.ReadFile("testdata/demo/index.js")
	if err != nil {
		t.Fatal(err)
	}
	service := installedService(t, string(contents))
	result, err := service.Call(t.Context(), 1, "demo", "search", []byte(`{"query":"Song 2","kind":"tracks","offset":0}`))
	if err != nil {
		t.Fatal(err)
	}
	var page struct {
		Tracks []struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Duration int64  `json:"duration"`
		} `json:"tracks"`
	}
	if err := json.Unmarshal(result, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Tracks) != 1 || page.Tracks[0].ID != "t2" || page.Tracks[0].Duration != 12000 {
		t.Fatalf("unexpected demo search: %s", result)
	}
}
