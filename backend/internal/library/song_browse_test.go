package library

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"lark/backend/ent/enttest"

	_ "github.com/lib-x/entsqlite"
)

func TestSongsPageWithOptionsSortsAndFiltersIncompleteMetadata(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}
	userItem, err := client.User.Create().SetUsername("browse-user").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artistItem, err := client.Artist.Create().SetName("Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	albumItem, err := client.Album.Create().SetTitle("Album").SetAlbumArtist("Artist").SetArtist(artistItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	created := time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	alpha, err := client.Song.Create().SetTitle("Alpha").SetPath("/music/Alpha.flac").SetFileName("Alpha.flac").SetCreatedAt(created).SetArtist(artistItem).SetAlbum(albumItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	beta, err := client.Song.Create().SetTitle("Beta").SetPath("/music/beta.flac").SetFileName("beta.flac").SetCreatedAt(created).SetArtist(artistItem).SetAlbum(albumItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	unknownArtist, err := client.Artist.Create().SetName("Unknown Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	unknownAlbum, err := client.Album.Create().SetTitle("Unknown Album").SetAlbumArtist("Unknown Artist").SetArtist(unknownArtist).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	incomplete, err := client.Song.Create().SetTitle("Needs Work").SetPath("/music/zeta.flac").SetFileName("zeta.flac").SetCreatedAt(created.Add(-time.Hour)).SetArtist(unknownArtist).SetAlbum(unknownAlbum).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	page, err := service.SongsPageWithOptions(ctx, userItem.ID, "", false, 20, 0, SongBrowseOptions{Sort: SongSortFilenameAsc})
	if err != nil {
		t.Fatal(err)
	}
	got := []int{page.Items[0].ID, page.Items[1].ID, page.Items[2].ID}
	if want := []int{alpha.ID, beta.ID, incomplete.ID}; !slices.Equal(got, want) {
		t.Fatalf("filename ids = %v, want %v", got, want)
	}

	review, err := service.SongsPageWithOptions(ctx, userItem.ID, "", false, 20, 0, SongBrowseOptions{Review: SongReviewIncomplete})
	if err != nil {
		t.Fatal(err)
	}
	if len(review.Items) != 1 || review.Items[0].ID != incomplete.ID {
		t.Fatalf("review items = %#v", review.Items)
	}
	if want := []string{MetadataIssueMissingArtist, MetadataIssueMissingAlbum}; !slices.Equal(review.Items[0].MetadataIssues, want) {
		t.Fatalf("issues = %v, want %v", review.Items[0].MetadataIssues, want)
	}

	summary, err := service.ReviewSummary(ctx, userItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if summary.IncompleteSongs != 1 {
		t.Fatalf("incomplete count = %d", summary.IncompleteSongs)
	}
}

func TestSongsPageDefaultRemainsAddedDescending(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}
	userItem, err := client.User.Create().SetUsername("default-sort-user").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	old, err := client.Song.Create().SetTitle("Old").SetPath("/music/old.flac").SetFileName("old.flac").SetCreatedAt(time.Now().Add(-time.Hour)).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	newer, err := client.Song.Create().SetTitle("New").SetPath("/music/new.flac").SetFileName("new.flac").SetCreatedAt(time.Now()).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	page, err := service.SongsPage(ctx, userItem.ID, "", false, 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := []int{page.Items[0].ID, page.Items[1].ID}; !slices.Equal(got, []int{newer.ID, old.ID}) {
		t.Fatalf("ids = %v", got)
	}
}
