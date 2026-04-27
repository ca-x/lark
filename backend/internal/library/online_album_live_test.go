package library

import (
	"context"
	"strings"
	"testing"

	"lark/backend/internal/online"
)

func TestSearchOnlineAlbumsLiveJayCatalog(t *testing.T) {
	service := &Service{online: online.Providers()}
	cases := []struct {
		title  string
		artist string
	}{
		{title: "Jay", artist: "周杰伦"},
		{title: "依然范特西", artist: "周杰伦"},
		{title: "魔杰座", artist: "周杰伦"},
		{title: "范特西", artist: "周杰伦"},
	}
	for _, tc := range cases {
		t.Run(tc.title, func(t *testing.T) {
			items := service.searchOnlineAlbums(context.Background(), tc.title, tc.artist)
			if len(items) == 0 {
				t.Fatalf("expected live online album search to return candidates for %q / %q", tc.title, tc.artist)
			}
			matchedTitle := false
			hasCover := false
			sources := map[string]bool{}
			for _, item := range items {
				sources[item.Source] = true
				if item.Cover != "" {
					hasCover = true
				}
				if albumTitleMatches(tc.title, item.Title) {
					matchedTitle = true
				}
			}
			if !matchedTitle {
				t.Fatalf("expected at least one title match for %q, got %#v", tc.title, items)
			}
			if !hasCover {
				t.Fatalf("expected at least one online cover for %q, got %#v", tc.title, items)
			}
			if tc.title == "Jay" && len(sources) < 2 {
				t.Fatalf("expected multiple switchable sources for %q, got sources %#v from %#v", tc.title, sources, items)
			}
		})
	}
}

func albumTitleMatches(want, got string) bool {
	want = normalizeCompareText(want)
	got = normalizeCompareText(got)
	return want == got || strings.Contains(want, got) || strings.Contains(got, want)
}
