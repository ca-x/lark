package library

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"

	"lark/backend/ent"
	"lark/backend/ent/enttest"
	"lark/backend/internal/kv"
	"lark/backend/internal/models"

	_ "github.com/lib-x/entsqlite"
)

func TestShouldSkipSharedCenterScanDirBelowRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "music")
	hidden := filepath.Join(root, ".shared-center")
	if !shouldSkipScanDir(root, hidden, ".shared-center") {
		t.Fatal("expected .shared-center child directory to be skipped")
	}
}

func TestShouldNotSkipRootEvenWhenHidden(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".shared-center")
	if shouldSkipScanDir(root, root, ".shared-center") {
		t.Fatal("expected root directory not to be skipped")
	}
}

func TestShouldNotSkipOtherHiddenScanDir(t *testing.T) {
	root := filepath.Join(t.TempDir(), "music")
	hidden := filepath.Join(root, ".artist-cache")
	if shouldSkipScanDir(root, hidden, ".artist-cache") {
		t.Fatal("expected non-shared-center hidden directory not to be skipped")
	}
}

func TestScanSkipsSharedCenterAndContinuesSiblings(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".shared-center", "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "album"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".shared-center", "nested", "ignored.txt"), []byte("ignored"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "album", "cover.txt"), []byte("visible"), 0o644); err != nil {
		t.Fatal(err)
	}

	service := &Service{libraryDir: root}
	result, err := service.Scan(context.Background(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if result.CurrentDir != filepath.Join(root, "album") {
		t.Fatalf("expected scan to continue into sibling album dir, got %q", result.CurrentDir)
	}
}

func TestScanRejectsConcurrentRun(t *testing.T) {
	service := &Service{}
	service.scanRunMu.Lock()
	defer service.scanRunMu.Unlock()
	_, err := service.Scan(context.Background(), 0)
	if !errors.Is(err, ErrScanRunning) {
		t.Fatalf("expected ErrScanRunning, got %v", err)
	}
}

func TestScanPreservesSongFavoriteForExistingPath(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	albumDir := filepath.Join(root, "Artist", "Album")
	if err := os.MkdirAll(albumDir, 0o755); err != nil {
		t.Fatal(err)
	}
	audioPath := filepath.Join(albumDir, "Artist - Title.mp3")
	if err := os.WriteFile(audioPath, []byte("first scan"), 0o644); err != nil {
		t.Fatal(err)
	}
	client := enttest.Open(t, "sqlite3", "file:scan-favorites?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	userItem, err := client.User.Create().SetUsername("owner").SetPasswordHash("hash").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{client: client, libraryDir: root}
	if _, err := service.Scan(ctx, userItem.ID); err != nil {
		t.Fatal(err)
	}
	page, err := service.SongsPage(ctx, userItem.ID, "Title", false, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("expected one scanned song, got %d", len(page.Items))
	}
	songID := page.Items[0].ID
	if _, err := service.ToggleSongFavorite(ctx, userItem.ID, songID); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(audioPath, []byte("second scan updates same path"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Scan(ctx, userItem.ID); err != nil {
		t.Fatal(err)
	}
	favorites, err := service.SongsPage(ctx, userItem.ID, "", true, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(favorites.Items) != 1 {
		t.Fatalf("expected favorite to survive rescan, got %d favorites", len(favorites.Items))
	}
	if favorites.Items[0].ID != songID {
		t.Fatalf("expected favorite song id %d to be preserved, got %d", songID, favorites.Items[0].ID)
	}
	if !favorites.Items[0].Favorite {
		t.Fatal("expected rescanned song to remain favorited")
	}
}

func TestCleanupMissingLibraryEntriesRemovesEmptyAlbumsWithoutMissingSongs(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:scan-empty-albums?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client}
	ar, err := service.ensureArtist(ctx, "Artist")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ensureAlbum(ctx, "Empty Album", "Artist", ar, 0); err != nil {
		t.Fatal(err)
	}
	nonEmpty, err := service.ensureAlbum(ctx, "Real Album", "Artist", ar, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Song.Create().
		SetTitle("Track").
		SetPath(filepath.Join(t.TempDir(), "Track.mp3")).
		SetFileName("Track.mp3").
		SetArtist(ar).
		SetAlbum(nonEmpty).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if err := service.cleanupMissingLibraryEntries(ctx, nil); err != nil {
		t.Fatal(err)
	}
	page, err := service.AlbumsPage(ctx, 0, 10, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("expected only non-empty album to remain visible, total=%d len=%d", page.Total, len(page.Items))
	}
	if page.Items[0].Title != "Real Album" || page.Items[0].SongCount != 1 {
		t.Fatalf("unexpected visible album: %+v", page.Items[0])
	}
}

func TestEnsureAlbumSeparatesSameTitleByAlbumArtist(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:album-identity?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client}

	artistA, err := service.ensureArtist(context.Background(), "Artist A")
	if err != nil {
		t.Fatal(err)
	}
	artistB, err := service.ensureArtist(context.Background(), "Artist B")
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.ensureAlbum(context.Background(), "Greatest Hits", "Artist A", artistA, 2001)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.ensureAlbum(context.Background(), "Greatest Hits", "Artist B", artistB, 2002)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatalf("expected same-titled albums by different artists to be separate, got id %d", first.ID)
	}
	again, err := service.ensureAlbum(context.Background(), "Greatest Hits", "Artist A", artistA, 2001)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != first.ID {
		t.Fatalf("expected same album artist to reuse album %d, got %d", first.ID, again.ID)
	}
}

func TestPreferredEmbeddedLyricsKeepsTaggedLyricsAheadOfOnlineCache(t *testing.T) {
	item := &ent.Song{
		LyricsEmbedded: "[00:00.00]online cache",
		LyricsSource:   "netease",
	}
	got := preferredEmbeddedLyrics(item, "[00:00.00]from file tag")
	if got != "[00:00.00]from file tag" {
		t.Fatalf("expected file tag lyrics to win over online cache, got %q", got)
	}
}

func TestPreferredEmbeddedLyricsTrustsStoredEmbeddedLyrics(t *testing.T) {
	item := &ent.Song{
		LyricsEmbedded: "[00:00.00]stored embedded",
		LyricsSource:   "embedded",
	}
	got := preferredEmbeddedLyrics(item, "[00:00.00]from file tag")
	if got != "[00:00.00]stored embedded" {
		t.Fatalf("expected stored embedded lyrics to win, got %q", got)
	}
}

func TestInvalidateSearchCatalogsClearsPersistentCache(t *testing.T) {
	ctx := context.Background()
	store := kv.NewMemoryStore()
	service := &Service{cache: store}
	if err := service.cacheSetJSONPermanent(ctx, artistCatalogCacheKey, []models.Artist{{ID: 1, Name: "Artist"}}); err != nil {
		t.Fatal(err)
	}
	if err := service.cacheSetJSONPermanent(ctx, songCatalogCacheKey, []models.Song{{ID: 1, Title: "Song"}}); err != nil {
		t.Fatal(err)
	}

	service.invalidateSearchCatalogs(ctx)

	if _, ok, err := store.Get(ctx, artistCatalogCacheKey); err != nil || ok {
		t.Fatalf("expected artist catalog cache deleted, ok=%v err=%v", ok, err)
	}
	if _, ok, err := store.Get(ctx, songCatalogCacheKey); err != nil || ok {
		t.Fatalf("expected song catalog cache deleted, ok=%v err=%v", ok, err)
	}
}

func TestReadSidecarLyricsPrefersLRCNextToAudio(t *testing.T) {
	dir := t.TempDir()
	audioPath := filepath.Join(dir, "track.flac")
	if err := os.WriteFile(audioPath, []byte("audio"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "track.lrc"), []byte("[00:00.00]sidecar lyric\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := readSidecarLyrics(audioPath)
	if got != "[00:00.00]sidecar lyric" {
		t.Fatalf("expected sidecar lyric, got %q", got)
	}
}

func TestRelativeFolderPathRejectsEscapes(t *testing.T) {
	root := filepath.Join(t.TempDir(), "music")
	outside := filepath.Join(filepath.Dir(root), "outside")
	if rel, ok := relativeFolderPath(root, outside); ok {
		t.Fatalf("expected outside folder to be rejected, got %q", rel)
	}
}

func TestRelativeFolderPathNormalizesNestedFolder(t *testing.T) {
	root := filepath.Join(t.TempDir(), "music")
	folder := filepath.Join(root, "Artist", "Album")
	rel, ok := relativeFolderPath(root, folder)
	if !ok {
		t.Fatal("expected nested folder to be accepted")
	}
	if rel != "Artist/Album" {
		t.Fatalf("expected slash-normalized path, got %q", rel)
	}
}

func TestResolveLibraryFolderRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	service := &Service{libraryDir: root}
	if _, err := service.resolveLibraryFolder("../escape"); err == nil {
		t.Fatal("expected traversal to be rejected")
	}
}

func TestResolveLibraryFolderAcceptsRootAliases(t *testing.T) {
	root := t.TempDir()
	service := &Service{libraryDir: root}
	got, err := service.resolveLibraryFolder(".")
	if err != nil {
		t.Fatal(err)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		t.Fatal(err)
	}
	if got != abs {
		t.Fatalf("expected root %q, got %q", abs, got)
	}
}

func TestRecentArtistInMixUsesGapOnly(t *testing.T) {
	items := []models.Song{{ArtistID: 7}, {ArtistID: 8}, {ArtistID: 9}}
	if recentArtistInMix(items, 7, 2) {
		t.Fatal("artist outside the recent gap should not block selection")
	}
	if !recentArtistInMix(items, 8, 2) {
		t.Fatal("artist inside the recent gap should block selection")
	}
}

func TestDailyScoreIsStableForSameDayAndUser(t *testing.T) {
	item := models.Song{ID: 42, ArtistID: 3, Title: "Track"}
	first := dailyScore("2026-04-27", 1, item)
	second := dailyScore("2026-04-27", 1, item)
	if first != second {
		t.Fatalf("expected stable score, got %d and %d", first, second)
	}
	if first == dailyScore("2026-04-28", 1, item) {
		t.Fatal("expected daily seed to change score")
	}
}

func TestCleanMetadataTextDecodesGBKBytesFromWavInfo(t *testing.T) {
	// Some WAV LIST/INFO writers store Chinese metadata as local ANSI/GBK bytes.
	// Tag readers may expose those bytes as Latin-1-looking mojibake.
	got := cleanMetadataText("²âÊÔ¸èÇú")
	if got != "测试歌曲" {
		t.Fatalf("expected GBK mojibake to decode, got %q", got)
	}
}

func TestCleanMetadataTextKeepsNormalUnicode(t *testing.T) {
	got := cleanMetadataText("Beyoncé – Déjà Vu")
	if got != "Beyoncé – Déjà Vu" {
		t.Fatalf("expected regular unicode to stay unchanged, got %q", got)
	}
}

func TestCleanMetadataTextDecodesRawGBKBytesFromWavInfo(t *testing.T) {
	got := cleanMetadataText(string([]byte{0xb2, 0xe2, 0xca, 0xd4, 0xb8, 0xe8, 0xc7, 0xfa}))
	if got != "测试歌曲" {
		t.Fatalf("expected raw GBK bytes to decode, got %q", got)
	}
}

func TestCleanMetadataTextDecodesUTF8ReadAsLatin1(t *testing.T) {
	var mojibake []rune
	for _, b := range []byte("你好，世界") {
		mojibake = append(mojibake, rune(b))
	}
	got := cleanMetadataText(string(mojibake))
	if got != "你好，世界" {
		t.Fatalf("expected UTF-8 mojibake to decode, got %q", got)
	}
}

func TestCleanMetadataTextDecodesMixedGBKLyricMojibake(t *testing.T) {
	got := cleanMetadataText("[00:01.00]ÄãºÃ love 你\n[00:02.00]goodbye")
	want := "[00:01.00]你好 love 你\n[00:02.00]goodbye"
	if got != want {
		t.Fatalf("expected mixed GBK lyric mojibake to decode, got %q", got)
	}
}

func TestCleanMetadataTextDecodesUTF16LEBOM(t *testing.T) {
	got := cleanMetadataText(string([]byte{0xff, 0xfe, 0x4b, 0x6d, 0xd5, 0x8b, 0x00, 0x00}))
	if got != "测试" {
		t.Fatalf("expected UTF-16LE BOM to decode, got %q", got)
	}
}

func TestApplyMetadataFallbackParsesTrackArtistTitleFromFilename(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "叶惠美", "01 - 周杰伦 - 晴天.wav")
	meta := fileMetadata{}
	applyMetadataFallback(path, root, &meta)
	if meta.Title != "晴天" {
		t.Fatalf("expected title from filename, got %q", meta.Title)
	}
	if meta.Artist != "周杰伦" {
		t.Fatalf("expected artist from filename, got %q", meta.Artist)
	}
	if meta.Album != "叶惠美" {
		t.Fatalf("expected album from parent folder, got %q", meta.Album)
	}
	if meta.AlbumArtist != "周杰伦" {
		t.Fatalf("expected album artist to fall back to artist, got %q", meta.AlbumArtist)
	}
}

func TestApplyMetadataFallbackDoesNotOverwriteExistingTags(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "Folder Album", "Other Artist - Other Title.flac")
	meta := fileMetadata{
		Title:  "Tagged Title",
		Artist: "Tagged Artist",
		Album:  "Tagged Album",
	}
	applyMetadataFallback(path, root, &meta)
	if meta.Title != "Tagged Title" || meta.Artist != "Tagged Artist" || meta.Album != "Tagged Album" {
		t.Fatalf("expected existing tags to stay, got title=%q artist=%q album=%q", meta.Title, meta.Artist, meta.Album)
	}
	if meta.AlbumArtist != "Tagged Artist" {
		t.Fatalf("expected missing album artist to fall back to tagged artist, got %q", meta.AlbumArtist)
	}
}

func TestApplyMetadataFallbackParsesCompactTitleArtistFilenameAtRoot(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "2002年的第一场雪-刀郎.wav")
	meta := fileMetadata{}
	applyMetadataFallback(path, root, &meta)
	if meta.Title != "2002年的第一场雪" {
		t.Fatalf("expected compact filename title, got %q", meta.Title)
	}
	if meta.Artist != "刀郎" {
		t.Fatalf("expected compact filename artist, got %q", meta.Artist)
	}
	if meta.Album != "Unknown Album" {
		t.Fatalf("expected root-level file not to use root folder as album, got %q", meta.Album)
	}
}

func TestMetadataTagsPreferReadableDuplicateValues(t *testing.T) {
	var tags metadataTags
	raw := []byte(`{"title":"寸寸相思寸寸心","artist":"邰正宵","title":"������˼������","artist":"ۢ����"}`)
	if err := json.Unmarshal(raw, &tags); err != nil {
		t.Fatal(err)
	}
	normalized := normalizeTags(map[string]string(tags))
	if normalized["title"] != "寸寸相思寸寸心" {
		t.Fatalf("expected readable duplicate title to win, got %q", normalized["title"])
	}
	if normalized["artist"] != "邰正宵" {
		t.Fatalf("expected readable duplicate artist to win, got %q", normalized["artist"])
	}
}

func TestParseWAVInfoListDecodesRawGBKTags(t *testing.T) {
	data := append([]byte("INFO"), wavInfoChunk("INAM", []byte{0xb2, 0xe2, 0xca, 0xd4, 0xb8, 0xe8, 0xc7, 0xfa, 0x00})...)
	meta := parseWAVInfoList(data)
	if meta.Title != "测试歌曲" {
		t.Fatalf("expected WAV LIST/INFO GBK title to decode, got %q", meta.Title)
	}
}

func TestDecodeWAVInfoTextForcesGB18030WhenPossible(t *testing.T) {
	got := decodeWAVInfoText([]byte{0xd6, 0xd8, 0xc8, 0xbc, 0xb0, 0xae, 0xc1, 0xb5, 0x00})
	if got != "重燃爱恋" {
		t.Fatalf("expected forced GB18030 WAV INFO decode, got %q", got)
	}
}

func TestDecodeWAVInfoTextDecodesGB2312Subset(t *testing.T) {
	got := decodeWAVInfoText([]byte{0xb2, 0xe2, 0xca, 0xd4, 0x00})
	if got != "测试" {
		t.Fatalf("expected GB2312-compatible WAV INFO decode, got %q", got)
	}
}

func TestApplyMetadataFallbackReplacesUnreadableTags(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "重燃爱恋", "2002年的第一场雪-刀郎.wav")
	meta := fileMetadata{
		Title:  "������˼������",
		Artist: "ۢ����",
		Album:  "��ȼ���",
	}
	applyMetadataFallback(path, root, &meta)
	if meta.Title != "2002年的第一场雪" {
		t.Fatalf("expected unreadable title to fall back to filename, got %q", meta.Title)
	}
	if meta.Artist != "刀郎" {
		t.Fatalf("expected unreadable artist to fall back to filename, got %q", meta.Artist)
	}
	if meta.Album != "重燃爱恋" {
		t.Fatalf("expected unreadable album to fall back to folder, got %q", meta.Album)
	}
}

func TestApplyMetadataFallbackParsesBracketedArtistFilename(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "(01) [李健] 为你而来.wav")
	meta := fileMetadata{
		Title:  "????",
		Artist: "??",
		Album:  "???? [??]",
	}
	applyMetadataFallback(path, root, &meta)
	if meta.Title != "为你而来" {
		t.Fatalf("expected bracketed filename title, got %q", meta.Title)
	}
	if meta.Artist != "李健" {
		t.Fatalf("expected bracketed filename artist, got %q", meta.Artist)
	}
	if meta.Album != "Unknown Album" {
		t.Fatalf("expected root-level placeholder album to fall back to unknown album, got %q", meta.Album)
	}
}

func TestParseID3MetadataFromWAVChunkDecodesUTF16TagsAndLyrics(t *testing.T) {
	id3 := buildID3Tag(
		id3TextFrame("TIT2", "寸寸相思寸寸心"),
		id3TextFrame("TPE1", "邰正宵"),
		id3TextFrame("TALB", "重燃爱恋"),
		id3LyricsFrame("[00:01.19]邰正宵 - 寸寸相思寸寸心"),
	)
	meta := parseID3Metadata(id3)
	if meta.Title != "寸寸相思寸寸心" {
		t.Fatalf("expected ID3 title, got %q", meta.Title)
	}
	if meta.Artist != "邰正宵" {
		t.Fatalf("expected ID3 artist, got %q", meta.Artist)
	}
	if meta.Album != "重燃爱恋" {
		t.Fatalf("expected ID3 album, got %q", meta.Album)
	}
	if meta.Lyrics != "[00:01.19]邰正宵 - 寸寸相思寸寸心" {
		t.Fatalf("expected ID3 lyrics, got %q", meta.Lyrics)
	}
}

func TestDecodeID3LyricsFrameDecodesUTF16LyricsWithoutBOMAfterDescriptor(t *testing.T) {
	payload := []byte{1, 'X', 'X', 'X', 0xff, 0xfe, 0x00, 0x00}
	payload = append(payload, utf16LEString("邰正宵")...)
	if got := decodeID3LyricsFrame(payload); got != "邰正宵" {
		t.Fatalf("expected UTF-16 lyrics without BOM after descriptor to decode, got %q", got)
	}
}

func wavInfoChunk(id string, value []byte) []byte {
	out := []byte(id)
	var size [4]byte
	binary.LittleEndian.PutUint32(size[:], uint32(len(value)))
	out = append(out, size[:]...)
	out = append(out, value...)
	if len(value)%2 == 1 {
		out = append(out, 0)
	}
	return out
}

func buildID3Tag(frames ...[]byte) []byte {
	payload := []byte{}
	for _, frame := range frames {
		payload = append(payload, frame...)
	}
	out := []byte{'I', 'D', '3', 3, 0, 0}
	out = append(out, syncsafeBytes(len(payload))...)
	out = append(out, payload...)
	return out
}

func id3TextFrame(id, value string) []byte {
	payload := append([]byte{1}, utf16LEBOMString(value)...)
	return id3Frame(id, payload)
}

func id3LyricsFrame(value string) []byte {
	payload := []byte{1, 'X', 'X', 'X', 0xff, 0xfe, 0x00, 0x00}
	payload = append(payload, utf16LEBOMString(value)...)
	return id3Frame("USLT", payload)
}

func id3Frame(id string, payload []byte) []byte {
	out := []byte(id)
	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(payload)))
	out = append(out, size[:]...)
	out = append(out, 0, 0)
	out = append(out, payload...)
	return out
}

func utf16LEBOMString(value string) []byte {
	return append([]byte{0xff, 0xfe}, utf16LEString(value)...)
}

func utf16LEString(value string) []byte {
	out := []byte{}
	for _, unit := range utf16.Encode([]rune(value)) {
		out = append(out, byte(unit), byte(unit>>8))
	}
	return out
}

func syncsafeBytes(value int) []byte {
	return []byte{byte(value >> 21 & 0x7f), byte(value >> 14 & 0x7f), byte(value >> 7 & 0x7f), byte(value & 0x7f)}
}
