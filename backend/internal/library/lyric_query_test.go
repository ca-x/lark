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
