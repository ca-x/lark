package library

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lark/backend/ent"
	"lark/backend/ent/enttest"
	"lark/backend/ent/song"

	_ "github.com/lib-x/entsqlite"
	taglib "go.senan.xyz/taglib"
)

func TestFolderMetadataCorrectionSupportsIndependentDestinations(t *testing.T) {
	ctx := t.Context()
	root := t.TempDir()
	albumDir := filepath.Join(root, "陈粒", "如也")
	if err := os.MkdirAll(albumDir, 0o755); err != nil {
		t.Fatal(err)
	}
	audioPath := filepath.Join(albumDir, "陈粒 - 走马.wav")
	writeMinimalWAVFile(t, audioPath)
	if _, err := writeWAVInfoMetadata(audioPath, fileMetadata{Title: "走马", Artist: "错误歌手", Album: "错误专辑"}); err != nil {
		t.Fatal(err)
	}

	client := enttest.Open(t, "sqlite3", "file:folder-metadata-correction?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client, libraryDir: root}
	userItem, err := client.User.Create().SetUsername("folder-metadata-owner").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	oldArtist, err := client.Artist.Create().SetName("错误歌手").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	oldAlbum, err := client.Album.Create().SetTitle("错误专辑").SetAlbumArtist("错误歌手").SetArtist(oldArtist).SetYear(2020).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserAlbumFavorite.Create().SetUserID(userItem.ID).SetAlbumID(oldAlbum.ID).Save(ctx); err != nil {
		t.Fatal(err)
	}
	songItem, err := client.Song.Create().
		SetTitle("走马").
		SetPath(audioPath).
		SetFileName(filepath.Base(audioPath)).
		SetArtist(oldArtist).
		SetAlbum(oldAlbum).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	input := FolderMetadataCorrectionInput{
		Path:           "陈粒",
		Field:          FolderMetadataFieldArtist,
		Value:          "陈粒",
		UpdateDatabase: true,
	}
	preview, err := service.PreviewFolderMetadataCorrection(ctx, userItem.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if preview.SongCount != 1 || preview.FileCount != 1 || len(preview.Items) != 1 {
		t.Fatalf("unexpected preview: %#v", preview)
	}
	if preview.Items[0].Before != "错误歌手" || preview.Items[0].After != "陈粒" {
		t.Fatalf("unexpected preview item: %#v", preview.Items[0])
	}

	input.Confirm = true
	input.ExpectedSnapshot = preview.Snapshot
	input.ExpectedSongCount = new(2)
	input.ExpectedFileCount = new(1)
	if _, err := service.CorrectFolderMetadata(ctx, userItem.ID, input); err == nil {
		t.Fatal("correction accepted a song count that no longer matched its preview")
	}
	input.ExpectedSongCount = new(1)
	input.ExpectedSnapshot = "stale-preview"
	if _, err := service.CorrectFolderMetadata(ctx, userItem.ID, input); err == nil {
		t.Fatal("correction accepted a stale preview snapshot")
	}
	input.ExpectedSnapshot = preview.Snapshot
	input.Field = FolderMetadataFieldAlbum
	if _, err := service.CorrectFolderMetadata(ctx, userItem.ID, input); err == nil {
		t.Fatal("correction accepted an intent that differed from its preview")
	}
	input.Field = FolderMetadataFieldArtist
	result, err := service.CorrectFolderMetadata(ctx, userItem.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if result.DatabaseUpdated != 1 || result.FileUpdated != 0 || result.Failed != 0 {
		t.Fatalf("unexpected database-only result: %#v", result)
	}
	updatedSong, err := client.Song.Query().Where(song.ID(songItem.ID)).WithArtist().WithAlbum().Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if updatedSong.Edges.Artist.Name != "陈粒" {
		t.Fatalf("database artist = %q, want 陈粒", updatedSong.Edges.Artist.Name)
	}
	if got := probeWAVMetadata(audioPath).Artist; got != "错误歌手" {
		t.Fatalf("file artist = %q, database-only correction must not change it", got)
	}
	yearInput := FolderMetadataCorrectionInput{
		Path:           "陈粒/如也",
		Field:          FolderMetadataFieldYear,
		Value:          "2026",
		UpdateDatabase: true,
	}
	yearPreview, err := service.PreviewFolderMetadataCorrection(ctx, userItem.ID, yearInput)
	if err != nil {
		t.Fatal(err)
	}
	yearInput.Confirm = true
	yearInput.ExpectedSongCount = new(yearPreview.SongCount)
	yearInput.ExpectedFileCount = new(yearPreview.FileCount)
	yearInput.ExpectedSnapshot = yearPreview.Snapshot
	if _, err := service.CorrectFolderMetadata(ctx, userItem.ID, yearInput); err != nil {
		t.Fatal(err)
	}
	updatedAlbum, err := client.Album.Get(ctx, oldAlbum.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updatedAlbum.Year != 2026 {
		t.Fatalf("album year = %d, want 2026", updatedAlbum.Year)
	}

	fileOnly := FolderMetadataCorrectionInput{
		Path:       "陈粒/如也",
		Field:      FolderMetadataFieldAlbum,
		Value:      "如也",
		WriteFiles: true,
	}
	fileOnlyPreview, err := service.PreviewFolderMetadataCorrection(ctx, userItem.ID, fileOnly)
	if err != nil {
		t.Fatal(err)
	}
	fileOnly.Confirm = true
	fileOnly.ExpectedSongCount = new(fileOnlyPreview.SongCount)
	fileOnly.ExpectedFileCount = new(fileOnlyPreview.FileCount)
	fileOnly.ExpectedSnapshot = fileOnlyPreview.Snapshot
	result, err = service.CorrectFolderMetadata(ctx, userItem.ID, fileOnly)
	if err != nil {
		t.Fatal(err)
	}
	if result.FileUpdated != 1 || result.DatabaseUpdated != 0 || result.Failed != 0 {
		t.Fatalf("unexpected file-only result: %#v", result)
	}
	if got := probeWAVMetadata(audioPath).Album; got != "如也" {
		t.Fatalf("file album = %q, want 如也", got)
	}
	unchangedSong, err := client.Song.Query().Where(song.ID(songItem.ID)).WithAlbum().Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if unchangedSong.Edges.Album.Title != "错误专辑" {
		t.Fatalf("database album = %q, file-only correction must not change it", unchangedSong.Edges.Album.Title)
	}
	if _, err := service.ImportFile(ctx, audioPath); err != nil {
		t.Fatal(err)
	}
	unchangedAfterWatcherImport, err := client.Song.Query().Where(song.ID(songItem.ID)).WithAlbum().Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if unchangedAfterWatcherImport.Edges.Album.Title != "错误专辑" {
		t.Fatalf("database album = %q after watcher import, file-only correction must remain independent", unchangedAfterWatcherImport.Edges.Album.Title)
	}
	albumInput := FolderMetadataCorrectionInput{
		Path:           "陈粒/如也",
		Field:          FolderMetadataFieldAlbum,
		Value:          "新专辑",
		UpdateDatabase: true,
	}
	albumPreview, err := service.PreviewFolderMetadataCorrection(ctx, userItem.ID, albumInput)
	if err != nil {
		t.Fatal(err)
	}
	albumInput.Confirm = true
	albumInput.ExpectedSongCount = new(albumPreview.SongCount)
	albumInput.ExpectedFileCount = new(albumPreview.FileCount)
	albumInput.ExpectedSnapshot = albumPreview.Snapshot
	if _, err := service.CorrectFolderMetadata(ctx, userItem.ID, albumInput); err != nil {
		t.Fatal(err)
	}
	renamedSong, err := client.Song.Query().Where(song.ID(songItem.ID)).WithAlbum().Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	favoriteCount, err := renamedSong.Edges.Album.QueryUserFavorites().Count(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if favoriteCount != 1 {
		t.Fatalf("renamed album favorite count = %d, want 1", favoriteCount)
	}
}

func TestFolderMetadataCorrectionNormalizesArtistForBothDestinations(t *testing.T) {
	input, err := normalizeFolderMetadataCorrectionInput(FolderMetadataCorrectionInput{
		Field:          FolderMetadataFieldArtist,
		Value:          "陈粒/好妹妹",
		WriteFiles:     true,
		UpdateDatabase: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Value != "陈粒" {
		t.Fatalf("normalized artist = %q, want 陈粒", input.Value)
	}
}

func TestFolderMetadataCorrectionRejectsSymlinkOutsideSelectedFolder(t *testing.T) {
	ctx := t.Context()
	root := t.TempDir()
	outside := filepath.Join(root, "Other", "outside.wav")
	if err := os.MkdirAll(filepath.Dir(outside), 0o755); err != nil {
		t.Fatal(err)
	}
	writeMinimalWAVFile(t, outside)
	insideDir := filepath.Join(root, "Artist")
	if err := os.MkdirAll(insideDir, 0o755); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(insideDir, "linked.wav")
	if err := os.Symlink(outside, inside); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	client := enttest.Open(t, "sqlite3", "file:folder-metadata-symlink?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client, libraryDir: root}
	userItem, err := client.User.Create().SetUsername("folder-metadata-symlink-owner").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artistItem, err := client.Artist.Create().SetName("Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	albumItem, err := client.Album.Create().SetTitle("Album").SetArtist(artistItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Song.Create().SetTitle("Linked").SetPath(inside).SetFileName(filepath.Base(inside)).SetArtist(artistItem).SetAlbum(albumItem).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PreviewFolderMetadataCorrection(ctx, userItem.ID, FolderMetadataCorrectionInput{
		Path:       "Artist",
		Field:      FolderMetadataFieldArtist,
		Value:      "New Artist",
		WriteFiles: true,
	}); err == nil {
		t.Fatal("preview accepted a song symlink resolving outside the library")
	}
}

func TestFolderMetadataCorrectionPreservesCUEHashIdentity(t *testing.T) {
	ctx := t.Context()
	root := t.TempDir()
	audioPath := filepath.Join(root, "album.wav")
	writeMinimalWAVFile(t, audioPath)
	cuePath := filepath.Join(root, "album.cue")
	if err := os.WriteFile(cuePath, []byte("FILE \"album.wav\" WAVE\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	virtualPath := cueVirtualSongPath(audioPath, cuePath, 1, 0, 10)
	client := enttest.Open(t, "sqlite3", "file:folder-metadata-cue-hash?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client, libraryDir: root}
	oldArtist, err := client.Artist.Create().SetName("Old Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	albumItem, err := client.Album.Create().SetTitle("Album").SetAlbumArtist("Old Artist").SetArtist(oldArtist).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	created, err := client.Song.Create().SetTitle("Track").SetPath(virtualPath).SetFileName("album.wav").SetArtist(oldArtist).SetAlbum(albumItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	item, err := client.Song.Query().Where(song.ID(created.ID)).WithArtist().WithAlbum().Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.updateFolderMetadataSong(ctx, item, FolderMetadataFieldArtist, "New Artist", audioPath, false); err != nil {
		t.Fatal(err)
	}
	updated, err := client.Song.Get(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := cueTrackContentHash(virtualPath, fileMetadata{Title: "Track", Artist: "New Artist", Album: "Album"})
	if updated.ContentHash != want {
		t.Fatalf("CUE content hash = %q, want %q", updated.ContentHash, want)
	}
}

func TestFolderMetadataCorrectionKeepsSharedAlbumYearForPartialSelection(t *testing.T) {
	ctx := t.Context()
	root := t.TempDir()
	selectedPath := filepath.Join(root, "Selected", "one.wav")
	otherPath := filepath.Join(root, "Other", "two.wav")
	for _, path := range []string{selectedPath, otherPath} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		writeMinimalWAVFile(t, path)
	}
	client := enttest.Open(t, "sqlite3", "file:folder-metadata-partial-year?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client, libraryDir: root}
	userItem, err := client.User.Create().SetUsername("partial-year-owner").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	artistItem, err := client.Artist.Create().SetName("Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	albumItem, err := client.Album.Create().SetTitle("Shared Album").SetYear(2020).SetArtist(artistItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	selectedSong, err := client.Song.Create().SetTitle("One").SetPath(selectedPath).SetFileName(filepath.Base(selectedPath)).SetYear(2020).SetArtist(artistItem).SetAlbum(albumItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Song.Create().SetTitle("Two").SetPath(otherPath).SetFileName(filepath.Base(otherPath)).SetYear(2020).SetArtist(artistItem).SetAlbum(albumItem).Save(ctx); err != nil {
		t.Fatal(err)
	}
	input := FolderMetadataCorrectionInput{Path: "Selected", Field: FolderMetadataFieldYear, Value: "2026", UpdateDatabase: true}
	preview, err := service.PreviewFolderMetadataCorrection(ctx, userItem.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	input.Confirm = true
	input.ExpectedSongCount = new(preview.SongCount)
	input.ExpectedFileCount = new(preview.FileCount)
	input.ExpectedSnapshot = preview.Snapshot
	if _, err := service.CorrectFolderMetadata(ctx, userItem.ID, input); err != nil {
		t.Fatal(err)
	}
	updatedSong, err := client.Song.Get(ctx, selectedSong.ID)
	if err != nil {
		t.Fatal(err)
	}
	updatedAlbum, err := client.Album.Get(ctx, albumItem.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updatedSong.Year != 2026 || updatedAlbum.Year != 2020 {
		t.Fatalf("selected song/album years = %d/%d, want 2026/2020", updatedSong.Year, updatedAlbum.Year)
	}
}

func TestFolderMetadataCorrectionWritesAndVerifiesFLACTags(t *testing.T) {
	ctx := t.Context()
	audioPath := copyTaglibTestdata(t, "eg.flac")
	client := enttest.Open(t, "sqlite3", "file:folder-metadata-flac?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client, libraryDir: filepath.Dir(audioPath)}
	userItem, err := client.User.Create().SetUsername("folder-metadata-flac-owner").SetPasswordHash("hash").Save(ctx)
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
		SetTitle("Track").
		SetPath(audioPath).
		SetFileName(filepath.Base(audioPath)).
		SetArtist(oldArtist).
		SetAlbum(oldAlbum).
		Save(ctx)
	if err != nil {
		t.Fatal(err)
	}

	flacInput := FolderMetadataCorrectionInput{
		Path:              ".",
		Field:             FolderMetadataFieldAlbum,
		Value:             "New FLAC Album",
		WriteFiles:        true,
		UpdateDatabase:    true,
		Confirm:           true,
		ExpectedSongCount: new(1),
		ExpectedFileCount: new(1),
	}
	flacInput.ExpectedSnapshot = folderMetadataCorrectionSnapshot([]*ent.Song{songItem}, flacInput)
	result, err := service.CorrectFolderMetadata(ctx, userItem.ID, flacInput)
	if err != nil {
		t.Fatal(err)
	}
	if result.FileUpdated != 1 || result.DatabaseUpdated != 1 || result.Failed != 0 {
		t.Fatalf("unexpected FLAC result: %#v", result)
	}
	tags, err := taglib.ReadTags(audioPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := firstTaglibValue(tags, taglib.Album); got != "New FLAC Album" {
		t.Fatalf("FLAC album tag = %q, want New FLAC Album", got)
	}
}

func TestFolderMetadataCorrectionWritesSupportedFLACFields(t *testing.T) {
	audioPath := copyTaglibTestdata(t, "normal.flac")
	cases := []struct {
		field FolderMetadataField
		value string
	}{
		{FolderMetadataFieldTitle, "New Title"},
		{FolderMetadataFieldArtist, "New Artist"},
		{FolderMetadataFieldAlbum, "New Album"},
		{FolderMetadataFieldAlbumArtist, "New Album Artist"},
		{FolderMetadataFieldGenre, "Folk"},
		{FolderMetadataFieldYear, "2026"},
		{FolderMetadataFieldLanguage, "zho"},
		{FolderMetadataFieldStyle, "Live"},
		{FolderMetadataFieldTrack, "7/12"},
	}
	for _, tc := range cases {
		t.Run(string(tc.field), func(t *testing.T) {
			written, err := writeFolderMetadataField(audioPath, tc.field, tc.value)
			if err != nil {
				t.Fatal(err)
			}
			if !written {
				t.Fatalf("%s was not written", tc.field)
			}
			written, err = writeFolderMetadataField(audioPath, tc.field, tc.value)
			if err != nil {
				t.Fatal(err)
			}
			if written {
				t.Fatalf("identical %s value rewrote the FLAC file", tc.field)
			}
		})
	}
}

func TestFolderMetadataCorrectionValidatesFieldDestinationAndConfirmation(t *testing.T) {
	service := &Service{}
	cases := []FolderMetadataCorrectionInput{
		{Field: FolderMetadataField("unsafe"), Value: "value", UpdateDatabase: true},
		{Field: FolderMetadataFieldArtist, Value: "", UpdateDatabase: true},
		{Field: FolderMetadataFieldArtist, Value: "value"},
		{Field: FolderMetadataFieldYear, Value: "not-a-year", UpdateDatabase: true},
		{Field: FolderMetadataFieldArtist, Value: strings.Repeat("a", 513), UpdateDatabase: true},
	}
	for _, input := range cases {
		if _, err := service.PreviewFolderMetadataCorrection(t.Context(), 1, input); err == nil {
			t.Fatalf("PreviewFolderMetadataCorrection(%#v) succeeded, want validation error", input)
		}
	}
	if _, err := service.CorrectFolderMetadata(t.Context(), 1, FolderMetadataCorrectionInput{
		Field:          FolderMetadataFieldArtist,
		Value:          "陈粒",
		UpdateDatabase: true,
	}); err == nil {
		t.Fatal("CorrectFolderMetadata without confirmation succeeded")
	}
}
