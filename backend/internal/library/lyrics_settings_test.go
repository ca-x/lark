package library

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/online"
)

type optionalLyricsProvider struct {
	online.Provider
	searches int
	fetches  int
}

func (p *optionalLyricsProvider) Name() string { return "fixture" }

func (p *optionalLyricsProvider) SearchSongs(context.Context, string, string) ([]online.Song, error) {
	p.searches++
	return []online.Song{{ID: "42", Title: "Test", Source: p.Name()}}, nil
}

func (p *optionalLyricsProvider) Lyrics(context.Context, online.Song) (string, error) {
	p.fetches++
	return "[00:00.00]Online fixture", nil
}

func TestOnlineLyricsSettingsAndProviderGating(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	provider := &optionalLyricsProvider{}
	service.online = []online.Provider{provider}
	ctx := t.Context()
	settings, err := service.GetSettings(ctx)
	if err != nil || !settings.OnlineLyricsEnabled {
		t.Fatalf("missing setting must default on: %+v, %v", settings, err)
	}
	item := client.Song.Create().SetTitle("Test").SetPath("missing.mp3").SetFileName("missing.mp3").SaveX(ctx)
	candidates, err := service.LyricCandidatesForUser(ctx, 1, item.ID, false)
	if err != nil || len(candidates) != 1 || provider.searches != 1 {
		t.Fatalf("enabled candidates = %+v, %v; searches %d", candidates, err, provider.searches)
	}
	settings.OnlineLyricsEnabled = false
	if _, err := service.SaveSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	reopened := New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	loaded, err := reopened.GetSettings(ctx)
	if err != nil || loaded.OnlineLyricsEnabled {
		t.Fatalf("disabled setting not persisted: %+v, %v", loaded, err)
	}
	for _, refresh := range []bool{false, true} {
		candidates, err := service.LyricCandidatesForUser(ctx, 1, item.ID, refresh)
		if err != nil || len(candidates) != 0 {
			t.Fatalf("disabled candidates (refresh %v): %+v, %v", refresh, candidates, err)
		}
	}
	lyrics, err := service.Lyrics(ctx, item.ID, "")
	if err != nil || lyrics.Lyrics != "" || lyrics.Source != "online:disabled" {
		t.Fatalf("disabled auto lookup = %+v, %v", lyrics, err)
	}
	for _, source := range []string{"42", "fixture:42"} {
		if _, err := service.Lyrics(ctx, item.ID, source); !errors.Is(err, ErrOnlineLyricsDisabled) {
			t.Fatalf("explicit source bypassed switch: %v", err)
		}
	}
	if _, err := service.SelectLyricsForUser(ctx, 1, item.ID, "fixture", "42"); !errors.Is(err, ErrOnlineLyricsDisabled) {
		t.Fatalf("stale selection bypassed switch: %v", err)
	}
	if provider.searches != 1 || provider.fetches != 0 {
		t.Fatalf("disabled provider was contacted: %+v", provider)
	}
	for _, source := range []string{"embedded", "sidecar", "fixture"} {
		item.Update().SetLyricsSource(source).SetLyricsEmbedded("[00:00.00]Saved lyrics").ExecX(ctx)
		lyrics, err := service.Lyrics(ctx, item.ID, "")
		if err != nil || lyrics.Lyrics != "[00:00.00]Saved lyrics" {
			t.Fatalf("saved %s lyrics lost: %+v, %v", source, lyrics, err)
		}
	}
	item.Update().SetLyricsSource("").SetLyricsEmbedded("").ExecX(ctx)
	searcher := &lyricSearcherFixture{lyrics: "[00:00.00]Source lyrics", source: "plugin:lyrics"}
	service.SetLyricSearcher(searcher)
	lyrics, err = service.Lyrics(ctx, item.ID, "")
	if err != nil || lyrics.Source != "plugin:lyrics" || searcher.calls != 1 {
		t.Fatalf("Songloft lyrics must remain independent: %+v, %v", lyrics, err)
	}
	settings.OnlineLyricsEnabled = true
	if _, err := service.SaveSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	lyrics, err = service.SelectLyricsForUser(ctx, 1, item.ID, "fixture", "42")
	if err != nil || lyrics.Lyrics != "[00:00.00]Online fixture" || provider.fetches != 1 {
		t.Fatalf("reenabled selection = %+v, %v", lyrics, err)
	}
}
