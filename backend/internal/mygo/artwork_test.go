package mygo

import (
	"encoding/hex"
	"encoding/json/v2"
	"net/url"
	"strings"
	"testing"
)

func TestArtworkReferencesAreScopedAndDurable(t *testing.T) {
	service := installedService(t, `export function home() { return {sections:[{tracks:[{id:"one",album:{imageUrl:"https://p1.music.126.net/cover.jpg?param={size}y{size}"}}]}],playlists:[{id:"two",imageUrl:"https://p2.music.126.net/playlist.jpg"}]}; }`)
	result, err := service.Call(t.Context(), 1, "demo", "home", nil)
	if err != nil {
		t.Fatal(err)
	}
	var page struct {
		Sections []struct {
			Tracks []struct {
				Album struct {
					ImageURL string `json:"imageUrl"`
				} `json:"album"`
			} `json:"tracks"`
		} `json:"sections"`
	}
	if err := json.Unmarshal(result, &page); err != nil {
		t.Fatal(err)
	}
	address, err := url.Parse(page.Sections[0].Tracks[0].Album.ImageURL)
	if err != nil || !strings.HasPrefix(address.Path, "/api/mygo/plugins/demo/image") {
		t.Fatal("CDN image was not converted into an authenticated image reference", string(result), err)
	}
	query := address.Query()
	if query.Get("url") != "https://p1.music.126.net/cover.jpg?param=600y600" {
		t.Fatal("upstream image sizing template was not expanded", query.Get("url"))
	}
	open := func(user int, address, identity, proof string) error {
		token, err := service.NewImageFrom(t.Context(), user, "demo", identity, address, proof)
		if err != nil {
			return err
		}
		defer service.ForgetMedia(token)
		media, err := service.Media(t.Context(), user, token)
		if err == nil {
			media.Release()
		}
		return err
	}
	if err := open(1, query.Get("url"), query.Get("identity"), query.Get("proof")); err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct {
		user                     int
		address, identity, proof string
	}{
		{2, query.Get("url"), query.Get("identity"), query.Get("proof")},
		{1, query.Get("url") + "&other=1", query.Get("identity"), query.Get("proof")},
		{1, query.Get("url"), "another-origin", query.Get("proof")},
		{1, query.Get("url"), query.Get("identity"), ""},
		{1, "http://127.0.0.1/private", query.Get("identity"), query.Get("proof")},
	} {
		if err := open(step.user, step.address, step.identity, step.proof); err == nil {
			t.Fatal("invalid artwork grant accepted", step)
		}
	}
	if err := service.Close(t.Context()); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(t.Context(), service.store, service.dir)
	if err != nil {
		t.Fatal(err)
	}
	service = restarted
	t.Cleanup(func() { _ = restarted.Close(t.Context()) })
	if err := service.Resume(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := open(1, query.Get("url"), query.Get("identity"), query.Get("proof")); err != nil {
		t.Fatal("saved queue artwork lost after restart", err)
	}
	if err := service.SetEnabled(t.Context(), "demo", false); err != nil {
		t.Fatal(err)
	}
	if err := open(1, query.Get("url"), query.Get("identity"), query.Get("proof")); err == nil {
		t.Fatal("disabled source served artwork")
	}
}

func TestArtworkReferencesDoNotAuthorizePrivateTargets(t *testing.T) {
	service := installedService(t, `export function home() { return {imageUrl:"http://169.254.169.254/metadata"}; }`)
	result, err := service.Call(t.Context(), 1, "demo", "home", nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(result), "proof=") {
		t.Fatal("private address received an artwork grant")
	}
	item := service.installed[0]
	for _, address := range []string{"http://127.0.0.1/private", "http://169.254.169.254/metadata", "https://user:secret@example.com/image"} {
		proof := hex.EncodeToString(service.artworkProof(1, item, address))
		if _, err := service.NewImageFrom(t.Context(), 1, "demo", item.Identity, address, proof); err == nil {
			t.Fatal("even a signed reference must reject unsafe addresses", address)
		}
	}
}

func TestArtworkHeadersRedirectsAndFetchIsolation(t *testing.T) {
	service := installedService(t, `export function home() { return {imageUrl:"https://images.example.com/cover.jpg"}; } export async function search() { return await fetch("https://images.example.com/private"); }`)
	result, err := service.Call(t.Context(), 1, "demo", "home", nil)
	if err != nil {
		t.Fatal(err)
	}
	var page struct {
		ImageURL string `json:"imageUrl"`
	}
	if err := json.Unmarshal(result, &page); err != nil {
		t.Fatal(err)
	}
	address, err := url.Parse(page.ImageURL)
	if err != nil {
		t.Fatal(err)
	}
	query := address.Query()
	session := service.sessions[scope{1, "demo"}]
	session.manifest.RequestHeaders = []HeaderRule{{Hosts: []string{"images.example.com"}, Kinds: []string{"image"}, Headers: map[string]string{"Authorization": "secret", "Referer": "https://example.com/"}}}
	token, err := service.NewImageFrom(t.Context(), 1, "demo", query.Get("identity"), query.Get("url"), query.Get("proof"))
	if err != nil {
		t.Fatal(err)
	}
	defer service.ForgetMedia(token)
	media, err := service.Media(t.Context(), 1, token)
	if err != nil {
		t.Fatal(err)
	}
	defer media.Release()
	if media.Headers.Get("Authorization") != "secret" {
		t.Fatal("image-specific source headers lost")
	}
	for _, target := range []string{"https://another.example.com/cover.jpg", "https://images.example.com/redirect.jpg"} {
		parsed, _ := url.Parse(target)
		headers, err := media.HeadersFor(parsed)
		if err != nil {
			t.Fatal(err)
		}
		if target == "https://another.example.com/cover.jpg" && len(headers) != 0 {
			t.Fatal("cross-origin artwork redirect leaked credentials", headers)
		}
		if target == "https://images.example.com/redirect.jpg" && headers.Get("Authorization") != "secret" {
			t.Fatal("same-origin headers lost")
		}
	}
	for _, target := range []string{"http://images.example.com/cover.jpg", "https://127.0.0.1/private"} {
		parsed, _ := url.Parse(target)
		if _, err := media.HeadersFor(parsed); err == nil {
			t.Fatal("unsafe image redirect accepted", target)
		}
	}
	if _, err := service.Call(t.Context(), 1, "demo", "search", nil); err == nil {
		t.Fatal("artwork grant widened plugin fetch permission")
	}
	if _, err := service.NewMedia(t.Context(), 1, "demo", "https://images.example.com/private", "image"); err == nil {
		t.Fatal("artwork grant widened arbitrary image proxy")
	}
}
