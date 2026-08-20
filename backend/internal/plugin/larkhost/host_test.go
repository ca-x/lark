package larkhost

import (
	"fmt"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/library"
	pluginhost "lark/backend/internal/plugin/host"

	_ "github.com/lib-x/entsqlite"
)

func TestHostExposesLarkSongsAndPlaylistOperations(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	ctx := t.Context()
	owner, err := client.User.Create().SetUsername("plugin-host").SetPasswordHash("unusable").SetRole("admin").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artist, err := client.Artist.Create().SetName("John Lennon").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	album, err := client.Album.Create().SetTitle("Imagine").SetArtist(artist).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	song, err := client.Song.Create().SetTitle("Imagine").SetPath("/music/imagine.flac").SetFileName("imagine.flac").SetDurationSeconds(183).SetArtist(artist).SetAlbum(album).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	service := library.New(client, t.TempDir(), t.TempDir(), "ffprobe", "ffmpeg", nil, nil)
	host := New(client, service, Config{UserID: owner.ID, HostURL: "http://127.0.0.1:1234"})

	songs, err := host.Songs().Search(ctx, pluginhost.SongQuery{Query: "Imagine", Page: pluginhost.Page{Limit: 20}})
	if err != nil || len(songs) != 1 || songs[0].ID != song.ID || songs[0].Artist != "John Lennon" {
		t.Fatalf("songs=%+v err=%v", songs, err)
	}
	created, err := host.Playlists().Create(ctx, pluginhost.PlaylistCreate{Name: "Favorites", Description: "Plugin picks"})
	if err != nil {
		t.Fatal(err)
	}
	added, err := host.Playlists().AddSongs(ctx, created.ID, []int{song.ID, song.ID})
	if err != nil || added.Added != 1 || added.Skipped != 1 {
		t.Fatalf("added=%+v err=%v", added, err)
	}
	playlistSongs, err := host.Playlists().Songs(ctx, created.ID, pluginhost.PlaylistSongQuery{})
	if err != nil || len(playlistSongs) != 1 || playlistSongs[0].ID != song.ID {
		t.Fatalf("playlist songs=%+v err=%v", playlistSongs, err)
	}
	second, err := client.Song.Create().SetTitle("Woman").SetPath("/music/woman.flac").SetFileName("woman.flac").SetArtist(artist).SetAlbum(album).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := host.Playlists().AddSongs(ctx, created.ID, []int{second.ID}); err != nil {
		t.Fatal(err)
	}
	if err := host.Playlists().Reorder(ctx, created.ID, []int{second.ID, song.ID}); err != nil {
		t.Fatal(err)
	}
	playlistSongs, err = host.Playlists().Songs(ctx, created.ID, pluginhost.PlaylistSongQuery{})
	if err != nil || len(playlistSongs) != 2 || playlistSongs[0].ID != second.ID || playlistSongs[1].ID != song.ID {
		t.Fatalf("reordered songs=%+v err=%v", playlistSongs, err)
	}
	newName := "Updated favorites"
	updated, err := host.Playlists().Update(ctx, created.ID, pluginhost.PlaylistUpdate{Name: &newName})
	if err != nil || updated.Name != newName {
		t.Fatalf("updated=%+v err=%v", updated, err)
	}
	if err := host.Playlists().Delete(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := host.Playlists().Get(ctx, created.ID); err == nil {
		t.Fatal("deleted playlist is still readable")
	}
}

func TestSongHostCreatesAndUpsertsSongLoftRemoteSongs(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	ctx := t.Context()
	owner, err := client.User.Create().SetUsername("remote-plugin-host").SetPasswordHash("unusable").SetRole("admin").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	service := library.New(client, t.TempDir(), t.TempDir(), "ffprobe", "ffmpeg", nil, nil)
	host := New(client, service, Config{UserID: owner.ID})

	created, err := host.Songs().Create(ctx, "subsonic", []pluginhost.SongCreate{{
		Title: "Remote Song", Artist: "Remote Artist", Album: "Remote Album",
		SourceData: `{"id":"track-1"}`, DedupKey: "server:track-1", Duration: 123,
	}})
	if err != nil || len(created) != 1 {
		t.Fatalf("create = %+v, %v", created, err)
	}
	if created[0].Type != "remote" || created[0].PluginEntryPath != "subsonic" || created[0].Artist != "Remote Artist" {
		t.Fatalf("remote song = %+v", created[0])
	}

	upserted, err := host.Songs().Create(ctx, "subsonic", []pluginhost.SongCreate{{
		Title: "Updated Remote Song", Artist: "Remote Artist", Album: "Remote Album",
		SourceData: `{"id":"track-1","server":"new"}`, DedupKey: "server:track-1", Duration: 124,
	}})
	if err != nil || len(upserted) != 1 {
		t.Fatalf("upsert = %+v, %v", upserted, err)
	}
	if upserted[0].ID != created[0].ID || upserted[0].Title != "Updated Remote Song" || upserted[0].Duration != 124 {
		t.Fatalf("upserted song = %+v, original = %+v", upserted[0], created[0])
	}

	items, err := host.Songs().List(ctx, pluginhost.SongQuery{Type: "remote", Page: pluginhost.Page{Limit: 20}})
	if err != nil || len(items) != 1 || items[0].ID != created[0].ID {
		t.Fatalf("remote list = %+v, %v", items, err)
	}
	if err := host.Songs().Delete(ctx, created[0].ID); err != nil {
		t.Fatal(err)
	}
	items, err = host.Songs().List(ctx, pluginhost.SongQuery{Type: "remote", Page: pluginhost.Page{Limit: 20}})
	if err != nil || len(items) != 0 {
		t.Fatalf("remote list after delete = %+v, %v", items, err)
	}
}
