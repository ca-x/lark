package library

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/dhowden/tag"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/artist"
)

func (s *Service) ensureArtist(ctx context.Context, name string) (*ent.Artist, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Unknown Artist"
	}
	item, err := s.client.Artist.Query().Where(artist.Name(name)).Only(ctx)
	if err == nil {
		return item, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	return s.client.Artist.Create().SetName(name).Save(ctx)
}
func (s *Service) ensureAlbum(ctx context.Context, title, albumArtist string, ar *ent.Artist, year int) (*ent.Album, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Unknown Album"
	}
	albumArtist = strings.TrimSpace(albumArtist)
	if albumArtist == "" && ar != nil {
		albumArtist = strings.TrimSpace(ar.Name)
	}
	item, err := s.client.Album.Query().Where(album.Title(title), album.AlbumArtist(albumArtist)).Only(ctx)
	if err == nil {
		if item.Year == 0 && year > 0 {
			updated, updateErr := item.Update().SetYear(year).Save(ctx)
			if updateErr != nil {
				return nil, updateErr
			}
			return updated, nil
		}
		return item, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	return s.client.Album.Create().SetTitle(title).SetAlbumArtist(albumArtist).SetYear(year).SetArtist(ar).Save(ctx)
}
func prepareProbeCommand(cmd *exec.Cmd) {
	prepareProbeProcessGroup(cmd)
	cmd.Cancel = func() error {
		terminateProbeCommand(cmd)
		return nil
	}
	cmd.WaitDelay = 5 * time.Second
}
func commandOutputLimited(cmd *exec.Cmd, limit int64) ([]byte, error) {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	data, readErr := io.ReadAll(io.LimitReader(stdout, limit+1))
	if int64(len(data)) > limit {
		terminateProbeCommand(cmd)
		readErr = errProbeOutputTooLarge
	}
	waitErr := cmd.Wait()
	if readErr != nil {
		return nil, readErr
	}
	if waitErr != nil {
		return nil, waitErr
	}
	return data, nil
}
func terminateProbeCommand(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		return
	}
	if terminateProbeProcessGroup(cmd) {
		return
	}
	_ = cmd.Process.Kill()
}
func supportsEmbeddedLyrics(path string) bool {
	return embeddedLyricsExts[strings.ToLower(filepath.Ext(path))]
}
func (s *Service) probe(ctx context.Context, path string, options probeOptions) fileMetadata {
	if s.ffprobe != "" {
		if meta := s.probeViaFFprobe(ctx, path, options); !meta.empty() {
			s.enrichMetadataViaTags(path, &meta, options)
			mergeFileMetadata(&meta, probeWAVMetadata(path))
			return meta
		}
	}
	meta := s.probeTags(path, options)
	mergeFileMetadata(&meta, probeWAVMetadata(path))
	return meta
}
func (s *Service) probeViaFFprobe(ctx context.Context, path string, options probeOptions) fileMetadata {
	probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, s.ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path)
	prepareProbeCommand(cmd)
	out, err := commandOutputLimited(cmd, maxFFprobeOutputBytes)
	if err != nil {
		return fileMetadata{}
	}
	var probed ffprobeOutput
	if err := json.Unmarshal(out, &probed); err != nil {
		return fileMetadata{}
	}
	tags := normalizeTags(map[string]string(probed.Format.Tags))
	meta := fileMetadata{
		Title:       first(tags, "title"),
		Artist:      first(tags, "artist", "album_artist", "albumartist"),
		Album:       first(tags, "album"),
		AlbumArtist: first(tags, "album_artist", "albumartist"),
		Year:        parseYear(first(tags, "date", "year", "originaldate", "originalyear", "releasedate")),
	}
	if options.ReadLyrics {
		meta.Lyrics = first(tags, "lyrics", "unsyncedlyrics", "unsynced_lyrics", "syncedlyrics")
		meta.HasLyrics = strings.TrimSpace(meta.Lyrics) != ""
	} else if options.DetectLyrics {
		meta.HasLyrics = hasAnyTag(tags, "lyrics", "unsyncedlyrics", "unsynced_lyrics", "syncedlyrics")
	}
	if duration, _ := strconv.ParseFloat(probed.Format.Duration, 64); duration > 0 {
		meta.Duration = duration
	}
	if bitrate, _ := strconv.Atoi(probed.Format.BitRate); bitrate > 0 {
		meta.BitRate = bitrate
	}
	for _, stream := range probed.Streams {
		if stream.CodecType != "audio" {
			continue
		}
		if sampleRate, _ := strconv.Atoi(stream.SampleRate); sampleRate > 0 {
			meta.SampleRate = sampleRate
		}
		if stream.Bits > 0 {
			meta.BitDepth = stream.Bits
		}
		streamTags := normalizeTags(map[string]string(stream.Tags))
		if options.ReadLyrics && meta.Lyrics == "" {
			meta.Lyrics = first(streamTags, "lyrics", "unsyncedlyrics", "unsynced_lyrics", "syncedlyrics")
			meta.HasLyrics = strings.TrimSpace(meta.Lyrics) != ""
		} else if options.DetectLyrics && !meta.HasLyrics {
			meta.HasLyrics = hasAnyTag(streamTags, "lyrics", "unsyncedlyrics", "unsynced_lyrics", "syncedlyrics")
		}
		if meta.Year == 0 {
			meta.Year = parseYear(first(streamTags, "date", "year", "originaldate", "originalyear", "releasedate"))
		}
		break
	}
	return meta
}
func (s *Service) probeTags(path string, options probeOptions) fileMetadata {
	f, err := os.Open(path)
	if err != nil {
		return fileMetadata{}
	}
	defer f.Close()
	m, err := tag.ReadFrom(f)
	if err != nil {
		return fileMetadata{}
	}
	meta := fileMetadata{
		Title:       cleanMetadataText(m.Title()),
		Artist:      cleanMetadataText(m.Artist()),
		Album:       cleanMetadataText(m.Album()),
		AlbumArtist: cleanMetadataText(m.AlbumArtist()),
		Year:        m.Year(),
	}
	if options.ReadLyrics {
		meta.Lyrics = cleanMetadataText(m.Lyrics())
		meta.HasLyrics = strings.TrimSpace(meta.Lyrics) != ""
	} else if options.DetectLyrics {
		meta.HasLyrics = strings.TrimSpace(m.Lyrics()) != ""
	}
	if meta.Artist == "" {
		meta.Artist = cleanMetadataText(m.Composer())
	}
	return meta
}
