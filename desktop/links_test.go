package main

import "testing"

func TestParseDeepLink(t *testing.T) {
	link, err := parseDeepLink("lark://song/42?server=https%3A%2F%2Fmusic.example.com")
	if err != nil || link.Kind != "song" || link.ID != 42 || link.Server != "https://music.example.com" {
		t.Fatalf("song link = %+v, %v", link, err)
	}
	for _, raw := range []string{"https://example.com/song/42", "lark://song/0", "lark://song/1/2", "lark://unknown/1", "lark://album/-1"} {
		if _, err := parseDeepLink(raw); err == nil {
			t.Errorf("accepted invalid link %q", raw)
		}
	}
}
