package library

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/enttest"
	"lark/backend/internal/models"
)

func TestPlaylistsPageCountsOnlyOwnedListsInTwoQueries(t *testing.T) {
	ctx := t.Context()
	var queries int
	client := enttest.Open(t, "sqlite3", "file:owned-playlist-counts?mode=memory&cache=shared&_pragma=foreign_keys(1)", enttest.WithOptions(ent.Debug(), ent.Log(func(args ...any) {
		if strings.HasPrefix(fmt.Sprint(args...), "driver.Query:") {
			queries++
		}
	})))
	t.Cleanup(func() { client.Close() })
	owner := client.User.Create().SetUsername("owner").SetPasswordHash("hash").SaveX(ctx)
	other := client.User.Create().SetUsername("other").SetPasswordHash("hash").SaveX(ctx)
	song := client.Song.Create().SetTitle("Track").SetFileName("track").SetPath("/track").SaveX(ctx)
	at := time.Now().UTC().Truncate(time.Second)
	withSong := client.Playlist.Create().SetOwnerID(owner.ID).SetName("First").SetUpdatedAt(at).AddSongIDs(song.ID).SaveX(ctx)
	empty := client.Playlist.Create().SetOwnerID(owner.ID).SetName("Second").SetUpdatedAt(at).SaveX(ctx)
	client.Playlist.Create().SetOwnerID(other.ID).SetName("Private").SetUpdatedAt(at).AddSongIDs(song.ID).SaveX(ctx)
	queries = 0
	service := &Service{client: client}
	page, err := service.PlaylistsPage(ctx, owner.ID, 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if queries != 2 || page.Total != 2 || len(page.Items) != 2 || page.Items[0].ID != empty.ID || page.Items[0].SongCount != 0 || page.Items[1].ID != withSong.ID || page.Items[1].SongCount != 1 {
		t.Fatalf("got %d queries, page %+v", queries, page)
	}
	second, err := service.PlaylistsPage(ctx, owner.ID, 1, 1)
	if err != nil || second.Total != 2 || len(second.Items) != 1 || second.Items[0].ID != withSong.ID {
		t.Fatalf("second page %+v, error %v", second, err)
	}
}

func BenchmarkPlaylistsPage(b *testing.B) {
	ctx := b.Context()
	client := enttest.Open(b, "sqlite3", "file:benchmark-playlists?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	b.Cleanup(func() { client.Close() })
	owner := client.User.Create().SetUsername("listener").SetPasswordHash("hash").SaveX(ctx)
	track := client.Song.Create().SetTitle("Track").SetFileName("one.flac").SetPath("/one.flac").SaveX(ctx)
	for i := range 100 {
		client.Playlist.Create().SetName(fmt.Sprint(i)).SetOwnerID(owner.ID).AddSongIDs(track.ID).SaveX(ctx)
	}
	service := &Service{client: client}
	b.ReportAllocs()
	for b.Loop() {
		page, err := service.PlaylistsPage(ctx, owner.ID, 100, 0)
		if err != nil || len(page.Items) != 100 || page.Items[0].SongCount != 1 {
			b.Fatalf("unexpected playlist page: %d items, error %v", len(page.Items), err)
		}
	}
}

func TestSongStateIncludesLessFrequentlyPlayedTracks(t *testing.T) {
	ctx := t.Context()
	client := enttest.Open(t, "sqlite3", "file:song-state-skew?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	t.Cleanup(func() { client.Close() })
	owner := client.User.Create().SetUsername("listener").SetPasswordHash("hash").SaveX(ctx)
	frequent := client.Song.Create().SetTitle("Frequent").SetFileName("one").SetPath("/one").SaveX(ctx)
	occasional := client.Song.Create().SetTitle("Occasional").SetFileName("two").SetPath("/two").SaveX(ctx)
	first := time.Now().UTC().Truncate(time.Second)
	client.PlayHistory.Create().SetUserID(owner.ID).SetSongID(occasional.ID).SetPlayedAt(first).SetUpdatedAt(first).SetProgressSeconds(30).SaveX(ctx)
	var plays []*ent.PlayHistoryCreate
	for i := range 205 {
		at := first.Add(time.Duration(i+1) * time.Minute)
		plays = append(plays, client.PlayHistory.Create().SetUserID(owner.ID).SetSongID(frequent.ID).SetPlayedAt(at).SetUpdatedAt(at).SetCompleted(true))
	}
	client.PlayHistory.CreateBulk(plays...).SaveX(ctx)
	items := []models.Song{{ID: frequent.ID, DurationSeconds: 100}, {ID: occasional.ID, DurationSeconds: 100}}
	service := &Service{client: client}
	got, err := service.applySongUserStateWithDevice(ctx, owner.ID, items, "pc")
	if err != nil {
		t.Fatal(err)
	}
	if got[1].ResumePosition != 30 || got[1].LastPlayedAt == nil || !got[1].LastPlayedAt.Equal(first) || got[0].PlayCount != len(plays) || got[0].ResumePosition != 0 {
		t.Fatalf("unexpected state: frequent plays %d, occasional last played %v, resume %v", got[0].PlayCount, got[1].LastPlayedAt, got[1].ResumePosition)
	}
}
