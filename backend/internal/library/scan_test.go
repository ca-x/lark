package library

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"

	"lark/backend/ent"
	"lark/backend/internal/models"
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
	out := []byte{0xff, 0xfe}
	for _, unit := range utf16.Encode([]rune(value)) {
		out = append(out, byte(unit), byte(unit>>8))
	}
	return out
}

func syncsafeBytes(value int) []byte {
	return []byte{byte(value >> 21 & 0x7f), byte(value >> 14 & 0x7f), byte(value >> 7 & 0x7f), byte(value & 0x7f)}
}
