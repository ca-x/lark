package library

import "testing"

func TestCleanLyricArtistTitleSplitsEmbeddedArtist(t *testing.T) {
	artist, title := cleanLyricArtistTitle("Uploader", "李健 - 为你而来 (Official Video)")
	if artist != "李健" || title != "为你而来" {
		t.Fatalf("unexpected cleaned query: artist=%q title=%q", artist, title)
	}
}

func TestCleanLyricQueryRemovesCommonNoise(t *testing.T) {
	got := cleanLyricQuery("Blue in Green [Official Audio]")
	if got != "Blue in Green" {
		t.Fatalf("cleanLyricQuery()=%q", got)
	}
}

func TestLyricTitleQueryVariantsStripsLeadingTrackNumber(t *testing.T) {
	got := lyricTitleQueryVariants("1. 真的爱你")
	want := []string{"1. 真的爱你", "真的爱你"}
	if len(got) != len(want) {
		t.Fatalf("expected %d variants, got %#v", len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("variant %d: expected %q, got %q", i, want[i], got[i])
		}
	}
}

func TestLyricTitleQueryVariantsStripsPaddedNumberAndPunctuation(t *testing.T) {
	got := lyricTitleQueryVariants("  01、 海阔天空. ")
	want := []string{"01、 海阔天空.", "海阔天空"}
	if len(got) != len(want) {
		t.Fatalf("expected %d variants, got %#v", len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("variant %d: expected %q, got %q", i, want[i], got[i])
		}
	}
}

func TestLyricTitleQueryVariantsAddsSimplifiedChineseFallback(t *testing.T) {
	got := lyricTitleQueryVariants("真的愛你")
	want := []string{"真的愛你", "真的爱你"}
	if len(got) != len(want) {
		t.Fatalf("expected %d variants, got %#v", len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("variant %d: expected %q, got %q", i, want[i], got[i])
		}
	}
}

func TestLyricTitleQueryVariantsCombinesTrackNumberAndSimplifiedFallback(t *testing.T) {
	got := lyricTitleQueryVariants("1. 海闊天空")
	want := []string{"1. 海闊天空", "海闊天空", "1. 海阔天空", "海阔天空"}
	if len(got) != len(want) {
		t.Fatalf("expected %d variants, got %#v", len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("variant %d: expected %q, got %q", i, want[i], got[i])
		}
	}
}
