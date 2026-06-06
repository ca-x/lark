package library

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/enttest"
	"lark/backend/ent/song"

	_ "github.com/lib-x/entsqlite"
	taglib "go.senan.xyz/taglib"
)

func TestMetadataWritebackResultMarshalsEmptyItemsAsArray(t *testing.T) {
	data, err := json.Marshal(newMetadataWritebackResult())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"items":[]`) {
		t.Fatalf("expected empty items array, got %s", data)
	}
	if strings.Contains(string(data), `"items":null`) {
		t.Fatalf("metadata writeback items must not marshal as null: %s", data)
	}
}

func TestWriteAudioMetadataUpdatesTagsAndCover(t *testing.T) {
	audioPath := copyTaglibTestdata(t, "eg.flac")
	coverData, err := os.ReadFile(filepath.Join(taglibTestdataDir(t), "cover.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	written, err := writeAudioMetadata(audioPath, map[string][]string{
		taglib.Title:  {"New Title"},
		taglib.Artist: {"New Artist"},
		taglib.Album:  {"New Album"},
		taglib.Date:   {"2026"},
	}, fileMetadata{}, coverData, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if !written {
		t.Fatal("expected metadata write to report a change")
	}
	tags, err := taglib.ReadTags(audioPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := firstTaglibValue(tags, taglib.Title); got != "New Title" {
		t.Fatalf("title = %q, want New Title", got)
	}
	if got := firstTaglibValue(tags, taglib.Artist); got != "New Artist" {
		t.Fatalf("artist = %q, want New Artist", got)
	}
	image, err := taglib.ReadImage(audioPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(image) == 0 {
		t.Fatal("expected embedded cover image")
	}
}

func TestWriteAudioMetadataMergesWAVInfoFields(t *testing.T) {
	audioPath := filepath.Join(t.TempDir(), "merge.wav")
	writeMinimalWAVFile(t, audioPath)
	if _, err := writeWAVInfoMetadata(audioPath, fileMetadata{
		Title:  "Old Title",
		Artist: "Old Artist",
		Album:  "Old Album",
		Year:   1999,
	}); err != nil {
		t.Fatal(err)
	}
	written, err := writeAudioMetadata(audioPath, map[string][]string{
		taglib.Album: {"New Album"},
		taglib.Date:  {"2026"},
	}, fileMetadata{Album: "New Album", Year: 2026}, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if !written {
		t.Fatal("expected WAV metadata write to report a change")
	}
	meta := probeWAVMetadata(audioPath)
	if meta.Title != "Old Title" {
		t.Fatalf("title = %q, want Old Title", meta.Title)
	}
	if meta.Artist != "Old Artist" {
		t.Fatalf("artist = %q, want Old Artist", meta.Artist)
	}
	if meta.Album != "New Album" || meta.Year != 2026 {
		t.Fatalf("album/year = %q/%d, want New Album/2026", meta.Album, meta.Year)
	}
}

func TestUpdateAlbumMetadataWritesAlbumArtistToFilesAndSongRows(t *testing.T) {
	ctx := context.Background()
	audioPath := copyTaglibTestdata(t, "eg.flac")
	client := enttest.Open(t, "sqlite3", "file:album-writeback-artist?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client, libraryDir: filepath.Dir(audioPath)}
	userItem, err := client.User.Create().SetUsername("album-writeback-owner").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	oldArtist, err := client.Artist.Create().SetName("Old Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	oldAlbum, err := client.Album.Create().SetTitle("Old Album").SetAlbumArtist("Old Artist").SetArtist(oldArtist).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	songItem, err := client.Song.Create().
		SetTitle("Existing Song").
		SetPath(audioPath).
		SetFileName(filepath.Base(audioPath)).
		SetArtist(oldArtist).
		SetAlbum(oldAlbum).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.UpdateAlbumMetadata(ctx, userItem.ID, oldAlbum.ID, MetadataWritebackInput{
		Title:            "New Album",
		AlbumArtist:      "New Album Artist",
		Year:             2026,
		ConfirmWriteback: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Updated != 1 {
		t.Fatalf("expected 1 updated file, got %#v", result)
	}

	tags, err := taglib.ReadTags(audioPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := firstTaglibValue(tags, taglib.Album); got != "New Album" {
		t.Fatalf("album tag = %q, want New Album", got)
	}
	if got := firstTaglibValue(tags, taglib.AlbumArtist); got != "New Album Artist" {
		t.Fatalf("album artist tag = %q, want New Album Artist", got)
	}
	if got := firstTaglibValue(tags, taglib.Artist); got != "New Album Artist" {
		t.Fatalf("track artist tag = %q, want New Album Artist", got)
	}
	if got := firstTaglibValue(tags, taglib.Date); got != "2026" {
		t.Fatalf("date tag = %q, want 2026", got)
	}

	updatedSong, err := client.Song.Query().Where(song.ID(songItem.ID)).WithArtist().WithAlbum().Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got := updatedSong.Edges.Artist.Name; got != "New Album Artist" {
		t.Fatalf("song artist = %q, want New Album Artist", got)
	}
	if got := updatedSong.Edges.Album.Title; got != "New Album" {
		t.Fatalf("song album = %q, want New Album", got)
	}
	if got := updatedSong.Year; got != 2026 {
		t.Fatalf("song year = %d, want 2026", got)
	}
}

func TestUpdateAlbumMetadataKeepsCompilationTrackArtists(t *testing.T) {
	ctx := context.Background()
	firstPath := copyTaglibTestdata(t, "eg.flac")
	secondPath := copyTaglibTestdata(t, "eg.flac")
	if _, err := writeAudioMetadata(firstPath, map[string][]string{
		taglib.Artist:      {"Artist A"},
		taglib.Album:       {"Old Compilation"},
		taglib.AlbumArtist: {"Various Artists"},
	}, fileMetadata{}, nil, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := writeAudioMetadata(secondPath, map[string][]string{
		taglib.Artist:      {"Artist B"},
		taglib.Album:       {"Old Compilation"},
		taglib.AlbumArtist: {"Various Artists"},
	}, fileMetadata{}, nil, ""); err != nil {
		t.Fatal(err)
	}
	client := enttest.Open(t, "sqlite3", "file:album-writeback-compilation?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client, libraryDir: filepath.Dir(firstPath)}
	userItem, err := client.User.Create().SetUsername("compilation-owner").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	albumArtist, err := client.Artist.Create().SetName("Various Artists").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artistA, err := client.Artist.Create().SetName("Artist A").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artistB, err := client.Artist.Create().SetName("Artist B").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	oldAlbum, err := client.Album.Create().SetTitle("Old Compilation").SetAlbumArtist("Various Artists").SetArtist(albumArtist).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	firstSong, err := client.Song.Create().
		SetTitle("Track A").
		SetPath(firstPath).
		SetFileName(filepath.Base(firstPath)).
		SetArtist(artistA).
		SetAlbum(oldAlbum).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	secondSong, err := client.Song.Create().
		SetTitle("Track B").
		SetPath(secondPath).
		SetFileName(filepath.Base(secondPath)).
		SetArtist(artistB).
		SetAlbum(oldAlbum).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.UpdateAlbumMetadata(ctx, userItem.ID, oldAlbum.ID, MetadataWritebackInput{
		AlbumArtist:      "New Compilation Artist",
		Year:             2026,
		ConfirmWriteback: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Updated != 2 {
		t.Fatalf("expected 2 updated files, got %#v", result)
	}

	firstTags, err := taglib.ReadTags(firstPath)
	if err != nil {
		t.Fatal(err)
	}
	secondTags, err := taglib.ReadTags(secondPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := firstTaglibValue(firstTags, taglib.Artist); got != "Artist A" {
		t.Fatalf("first track artist tag = %q, want Artist A", got)
	}
	if got := firstTaglibValue(secondTags, taglib.Artist); got != "Artist B" {
		t.Fatalf("second track artist tag = %q, want Artist B", got)
	}
	if got := firstTaglibValue(firstTags, taglib.AlbumArtist); got != "New Compilation Artist" {
		t.Fatalf("first album artist tag = %q, want New Compilation Artist", got)
	}
	if got := firstTaglibValue(secondTags, taglib.AlbumArtist); got != "New Compilation Artist" {
		t.Fatalf("second album artist tag = %q, want New Compilation Artist", got)
	}
	for _, item := range []struct {
		id   int
		want string
	}{
		{firstSong.ID, "Artist A"},
		{secondSong.ID, "Artist B"},
	} {
		updatedSong, err := client.Song.Query().Where(song.ID(item.id)).WithArtist().Only(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if got := updatedSong.Edges.Artist.Name; got != item.want {
			t.Fatalf("song %d artist = %q, want %q", item.id, got, item.want)
		}
	}
}

func TestUpdateAlbumMetadataTitleOnlyKeepsSongYear(t *testing.T) {
	ctx := context.Background()
	audioPath := filepath.Join(t.TempDir(), "title-only.wav")
	writeMinimalWAVFile(t, audioPath)
	if _, err := writeWAVInfoMetadata(audioPath, fileMetadata{
		Title:  "Track",
		Artist: "Artist",
		Album:  "Old Album",
		Year:   1999,
	}); err != nil {
		t.Fatal(err)
	}
	client := enttest.Open(t, "sqlite3", "file:album-writeback-title-only?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client, libraryDir: filepath.Dir(audioPath)}
	userItem, err := client.User.Create().SetUsername("title-only-owner").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artistItem, err := client.Artist.Create().SetName("Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	oldAlbum, err := client.Album.Create().SetTitle("Old Album").SetAlbumArtist("Artist").SetYear(2020).SetArtist(artistItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	songItem, err := client.Song.Create().
		SetTitle("Track").
		SetPath(audioPath).
		SetFileName(filepath.Base(audioPath)).
		SetYear(1999).
		SetArtist(artistItem).
		SetAlbum(oldAlbum).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.UpdateAlbumMetadata(ctx, userItem.ID, oldAlbum.ID, MetadataWritebackInput{
		Title:            "New Album",
		ConfirmWriteback: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Updated != 1 {
		t.Fatalf("expected 1 updated file, got %#v", result)
	}

	meta := probeWAVMetadata(audioPath)
	if meta.Album != "New Album" {
		t.Fatalf("file album = %q, want New Album", meta.Album)
	}
	if meta.Year != 1999 {
		t.Fatalf("file year = %d, want 1999", meta.Year)
	}
	updatedSong, err := client.Song.Query().Where(song.ID(songItem.ID)).Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got := updatedSong.Year; got != 1999 {
		t.Fatalf("song year = %d, want 1999", got)
	}
}

func TestUpdateAlbumMetadataFromPathSplitsIncorrectAlbumByDirectories(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	firstDir := filepath.Join(root, "五月天", "第二人生（明日版）")
	secondDir := filepath.Join(root, "五月天", "自传")
	if err := os.MkdirAll(firstDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(secondDir, 0o755); err != nil {
		t.Fatal(err)
	}
	firstPath := filepath.Join(firstDir, "01 - 分裂.wav")
	secondPath := filepath.Join(secondDir, "01 - 如果我们不曾相遇.wav")
	writeMinimalWAVFile(t, firstPath)
	writeMinimalWAVFile(t, secondPath)
	for _, item := range []struct {
		path  string
		title string
	}{
		{firstPath, "分裂"},
		{secondPath, "如果我们不曾相遇"},
	} {
		if _, err := writeWAVInfoMetadata(item.path, fileMetadata{
			Title:  item.title,
			Artist: "五月天",
			Album:  "微信公众号：磨坊高品质音乐论坛-MOOFEEL.COM",
		}); err != nil {
			t.Fatal(err)
		}
	}
	client := enttest.Open(t, "sqlite3", "file:album-path-split?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client, libraryDir: root}
	userItem, err := client.User.Create().SetUsername("metadata-owner").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.importFile(ctx, firstPath, false); err != nil {
		t.Fatal(err)
	}
	if _, err := service.importFile(ctx, secondPath, false); err != nil {
		t.Fatal(err)
	}
	wrongAlbum, err := client.Album.Query().Where(album.Title("微信公众号：磨坊高品质音乐论坛-MOOFEEL.COM")).Only(ctx)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.UpdateAlbumMetadata(ctx, userItem.ID, wrongAlbum.ID, MetadataWritebackInput{
		PathAssist:       true,
		ConfirmWriteback: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Updated != 2 || len(result.Albums) != 2 {
		t.Fatalf("expected 2 updated files and 2 albums, got updated=%d albums=%d result=%#v", result.Updated, len(result.Albums), result)
	}
	albums, err := client.Album.Query().Where(album.HasSongs()).All(ctx)
	if err != nil {
		t.Fatal(err)
	}
	titles := map[string]string{}
	for _, item := range albums {
		titles[item.Title] = item.AlbumArtist
	}
	if titles["第二人生（明日版）"] != "五月天" || titles["自传"] != "五月天" {
		t.Fatalf("expected path split albums, got %#v", titles)
	}
	if _, ok := titles["微信公众号：磨坊高品质音乐论坛-MOOFEEL.COM"]; ok {
		t.Fatalf("expected wrong album to have no songs, got %#v", titles)
	}
}

func TestMetadataWritebackFileGroupsDeduplicateCUETracks(t *testing.T) {
	audioPath := filepath.Join(t.TempDir(), "disc.wav")
	cuePath := filepath.Join(t.TempDir(), "disc.cue")
	items := []*ent.Song{
		{ID: 1, Path: cueVirtualSongPath(audioPath, cuePath, 1, 0, 120)},
		{ID: 2, Path: cueVirtualSongPath(audioPath, cuePath, 2, 120, 240)},
		{ID: 3, Path: filepath.Join(t.TempDir(), "single.flac")},
	}
	groups := metadataWritebackFileGroups(items)
	if len(groups) != 2 {
		t.Fatalf("expected 2 real file groups, got %d", len(groups))
	}
	if groups[0].Path != audioPath || len(groups[0].Songs) != 2 || groups[0].CUETrackCount != 2 {
		t.Fatalf("unexpected CUE group: %#v", groups[0])
	}
}

func TestMetadataPathCandidateFromSongUsesFilenameAndFolder(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "周杰伦", "叶惠美", "01 - 周杰伦 - 晴天.flac")
	item := &ent.Song{ID: 42, Path: path}
	candidate, ok := metadataPathCandidateFromSong(item, root)
	if !ok {
		t.Fatal("expected path metadata candidate")
	}
	if candidate.Source != metadataPathCandidateSource {
		t.Fatalf("source = %q, want %q", candidate.Source, metadataPathCandidateSource)
	}
	if candidate.Title != "晴天" || candidate.Artist != "周杰伦" || candidate.Album != "叶惠美" {
		t.Fatalf("candidate = %#v, want title/artist/album from path", candidate)
	}
}

func TestMetadataPathCandidateFromAlbumInfersMultidiscFolder(t *testing.T) {
	root := t.TempDir()
	item := &ent.Album{ID: 7}
	item.Edges.Songs = []*ent.Song{
		{ID: 1, Path: filepath.Join(root, "周杰伦", "范特西", "CD1", "01 - 爱在西元前.flac")},
		{ID: 2, Path: filepath.Join(root, "周杰伦", "范特西", "CD2", "02 - 简单爱.flac")},
	}
	candidate, ok := metadataPathCandidateFromAlbum(item, root)
	if !ok {
		t.Fatal("expected album path metadata candidate")
	}
	if candidate.Title != "范特西" || candidate.Artist != "周杰伦" {
		t.Fatalf("candidate = %#v, want album and artist from folder path", candidate)
	}
}

func TestParseFilenameMetadataTreatsTrackNumberTitleAsTitleOnly(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "周杰伦", "范特西", "01 - 爱在西元前.flac")
	parsed := parseFilenameMetadata(path, root)
	if parsed.Title != "爱在西元前" {
		t.Fatalf("title = %q, want 爱在西元前", parsed.Title)
	}
	if parsed.Artist != "" {
		t.Fatalf("artist = %q, want empty artist for track-number title filename", parsed.Artist)
	}
	if parsed.Album != "范特西" {
		t.Fatalf("album = %q, want 范特西", parsed.Album)
	}
}

func copyTaglibTestdata(t *testing.T, name string) string {
	t.Helper()
	src := filepath.Join(taglibTestdataDir(t), name)
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return dst
}

func taglibTestdataDir(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(os.Getenv("HOME"), "go", "pkg", "mod", "go.senan.xyz", "taglib@v0.12.0", "testdata")
	if _, err := os.Stat(dir); err == nil {
		return dir
	}
	t.Skip("go.senan.xyz/taglib testdata not available")
	return ""
}

func firstTaglibValue(tags map[string][]string, key string) string {
	if values := tags[key]; len(values) > 0 {
		return values[0]
	}
	return ""
}
