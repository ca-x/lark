package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dhowden/tag"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/appsetting"
	"lark/backend/ent/artist"
	"lark/backend/ent/playhistory"
	"lark/backend/ent/playlist"
	"lark/backend/ent/song"
	"lark/backend/ent/user"
	"lark/backend/ent/useralbumfavorite"
	"lark/backend/ent/usersongfavorite"
	"lark/backend/internal/models"
	"lark/backend/internal/netease"
	"lark/backend/internal/qqmusic"
)

var supportedExts = map[string]bool{
	".mp3": true, ".flac": true, ".wav": true, ".aiff": true, ".aif": true,
	".m4a": true, ".aac": true, ".ogg": true, ".oga": true, ".opus": true,
	".dsf": true, ".dff": true, ".dst": true, ".ape": true, ".alac": true,
}

type Service struct {
	client     *ent.Client
	libraryDir string
	ffprobe    string
	ffmpeg     string
	netease    *netease.Client
	qqmusic    *qqmusic.Client
	scanMu     sync.RWMutex
	scanStatus models.ScanStatus
}

type ffprobeOutput struct {
	Format struct {
		Duration string            `json:"duration"`
		BitRate  string            `json:"bit_rate"`
		Tags     map[string]string `json:"tags"`
	} `json:"format"`
	Streams []struct {
		CodecType  string            `json:"codec_type"`
		SampleRate string            `json:"sample_rate"`
		Bits       int               `json:"bits_per_sample"`
		Tags       map[string]string `json:"tags"`
	} `json:"streams"`
}

type fileMetadata struct {
	Title       string
	Artist      string
	Album       string
	AlbumArtist string
	Duration    float64
	SampleRate  int
	BitRate     int
	BitDepth    int
	Lyrics      string
}

func New(client *ent.Client, libraryDir, ffprobe, ffmpeg string, neteaseClient *netease.Client, qqClient *qqmusic.Client) *Service {
	return &Service{client: client, libraryDir: libraryDir, ffprobe: ffprobe, ffmpeg: ffmpeg, netease: neteaseClient, qqmusic: qqClient}
}

func (s *Service) FFmpegBin() string { return s.ffmpeg }

func (s *Service) LibraryDir() string { return s.libraryDir }

func IsSupported(path string) bool { return supportedExts[strings.ToLower(filepath.Ext(path))] }

func (s *Service) ScanStatus() models.ScanStatus {
	s.scanMu.RLock()
	defer s.scanMu.RUnlock()
	return cloneScanStatus(s.scanStatus)
}

func (s *Service) Scan(ctx context.Context) (models.ScanResult, error) {
	started := time.Now()
	s.setScanStatus(func(status *models.ScanStatus) {
		*status = models.ScanStatus{Running: true, CurrentDir: s.libraryDir, Errors: []string{}, StartedAt: &started}
	})
	result := models.ScanResult{Errors: []string{}}
	defer func() {
		finished := time.Now()
		s.setScanStatus(func(status *models.ScanStatus) {
			status.Running = false
			status.FinishedAt = &finished
		})
	}()
	err := filepath.WalkDir(s.libraryDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			result.Errors = append(result.Errors, err.Error())
			s.updateScanProgress(path, filepath.Dir(path), &result)
			return nil
		}
		if d.IsDir() {
			if shouldSkipScanDir(s.libraryDir, path, d.Name()) {
				result.Skipped++
				s.updateScanProgress("", filepath.Dir(path), &result)
				return filepath.SkipDir
			}
			result.CurrentDir = path
			s.updateScanProgress("", path, &result)
			return nil
		}
		result.CurrentDir = filepath.Dir(path)
		s.updateScanProgress(path, result.CurrentDir, &result)
		if !IsSupported(path) {
			result.Skipped++
			s.updateScanProgress(path, result.CurrentDir, &result)
			return nil
		}
		result.Scanned++
		added, err := s.ImportFile(ctx, path)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", path, err))
			s.updateScanProgress(path, result.CurrentDir, &result)
			return nil
		}
		if added {
			result.Added++
		} else {
			result.Updated++
		}
		s.updateScanProgress(path, result.CurrentDir, &result)
		return nil
	})
	if err != nil {
		return result, err
	}
	return result, nil
}

func shouldSkipScanDir(root, path, name string) bool {
	if samePath(root, path) {
		return false
	}
	return name == ".shared-center"
}

func samePath(a, b string) bool {
	absA, errA := filepath.Abs(a)
	absB, errB := filepath.Abs(b)
	if errA == nil && errB == nil {
		return filepath.Clean(absA) == filepath.Clean(absB)
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

func (s *Service) updateScanProgress(currentPath, currentDir string, result *models.ScanResult) {
	s.setScanStatus(func(status *models.ScanStatus) {
		status.CurrentPath = currentPath
		status.CurrentDir = currentDir
		status.Scanned = result.Scanned
		status.Added = result.Added
		status.Updated = result.Updated
		status.Skipped = result.Skipped
		status.Errors = append(status.Errors[:0], result.Errors...)
	})
}

func (s *Service) setScanStatus(update func(*models.ScanStatus)) {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	update(&s.scanStatus)
}

func cloneScanStatus(status models.ScanStatus) models.ScanStatus {
	status.Errors = append([]string{}, status.Errors...)
	return status
}

func (s *Service) ImportFile(ctx context.Context, path string) (bool, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return false, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return false, err
	}
	if info.IsDir() || !IsSupported(abs) {
		return false, fmt.Errorf("unsupported audio file")
	}
	meta := s.probe(abs)
	if meta.Title == "" {
		meta.Title = strings.TrimSuffix(filepath.Base(abs), filepath.Ext(abs))
	}
	if meta.Artist == "" {
		meta.Artist = "Unknown Artist"
	}
	if meta.Album == "" {
		meta.Album = "Unknown Album"
	}
	format := strings.TrimPrefix(strings.ToLower(filepath.Ext(abs)), ".")
	mimeType := mime.TypeByExtension(filepath.Ext(abs))
	if mimeType == "" {
		mimeType = audioMime(format)
	}
	artistEntity, err := s.ensureArtist(ctx, meta.Artist)
	if err != nil {
		return false, err
	}
	albumEntity, err := s.ensureAlbum(ctx, meta.Album, meta.AlbumArtist, artistEntity)
	if err != nil {
		return false, err
	}
	existing, err := s.client.Song.Query().Where(song.Path(abs)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return false, err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.Song.Create().
			SetTitle(meta.Title).
			SetPath(abs).
			SetFileName(filepath.Base(abs)).
			SetFormat(format).
			SetMime(mimeType).
			SetSizeBytes(info.Size()).
			SetDurationSeconds(meta.Duration).
			SetSampleRate(meta.SampleRate).
			SetBitRate(meta.BitRate).
			SetBitDepth(meta.BitDepth).
			SetLyricsEmbedded(meta.Lyrics).
			SetLyricsSource(sourceIf(meta.Lyrics != "", "embedded", "")).
			SetArtist(artistEntity).
			SetAlbum(albumEntity).
			Save(ctx)
		return true, err
	}
	_, err = existing.Update().
		SetTitle(meta.Title).
		SetFileName(filepath.Base(abs)).
		SetFormat(format).
		SetMime(mimeType).
		SetSizeBytes(info.Size()).
		SetDurationSeconds(meta.Duration).
		SetSampleRate(meta.SampleRate).
		SetBitRate(meta.BitRate).
		SetBitDepth(meta.BitDepth).
		SetLyricsEmbedded(meta.Lyrics).
		SetLyricsSource(sourceIf(meta.Lyrics != "", "embedded", existing.LyricsSource)).
		SetArtist(artistEntity).
		SetAlbum(albumEntity).
		Save(ctx)
	return false, err
}

func (s *Service) Songs(ctx context.Context, userID int, q string, favorites bool, limit int) ([]models.Song, error) {
	query := s.client.Song.Query().WithArtist().WithAlbum().Order(ent.Desc(song.FieldUpdatedAt))
	if strings.TrimSpace(q) != "" {
		term := strings.TrimSpace(q)
		query = query.Where(song.Or(song.TitleContainsFold(term), song.FileNameContainsFold(term), song.FormatContainsFold(term)))
	}
	if favorites {
		query = query.Where(song.HasUserFavoritesWith(usersongfavorite.HasUserWith(user.ID(userID))))
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	items, err := query.All(ctx)
	if err != nil {
		return nil, err
	}
	out := mapSongs(items)
	return s.applySongUserState(ctx, userID, out)
}

func (s *Service) Song(ctx context.Context, userID, id int) (models.Song, error) {
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().WithAlbum().Only(ctx)
	if err != nil {
		return models.Song{}, err
	}
	out, err := s.applySongUserState(ctx, userID, []models.Song{mapSong(item)})
	if err != nil {
		return models.Song{}, err
	}
	return out[0], nil
}

func (s *Service) RawSong(ctx context.Context, id int) (*ent.Song, error) {
	return s.client.Song.Get(ctx, id)
}

func (s *Service) SongCover(ctx context.Context, id int) ([]byte, string, error) {
	item, err := s.client.Song.Get(ctx, id)
	if err != nil {
		return nil, "", err
	}
	return coverFromFile(item.Path)
}

func (s *Service) AlbumCover(ctx context.Context, id int) ([]byte, string, error) {
	items, err := s.client.Song.Query().
		Where(song.HasAlbumWith(album.ID(id))).
		Order(ent.Asc(song.FieldID)).
		All(ctx)
	if err != nil {
		return nil, "", err
	}
	return firstEmbeddedCover(items)
}

func (s *Service) ArtistCover(ctx context.Context, id int) ([]byte, string, error) {
	items, err := s.client.Song.Query().
		Where(song.HasArtistWith(artist.ID(id))).
		Order(ent.Asc(song.FieldID)).
		All(ctx)
	if err != nil {
		return nil, "", err
	}
	return firstEmbeddedCover(items)
}

func firstEmbeddedCover(items []*ent.Song) ([]byte, string, error) {
	for _, item := range items {
		data, mimeType, err := coverFromFile(item.Path)
		if err != nil {
			continue
		}
		if len(data) > 0 {
			return data, mimeType, nil
		}
	}
	return nil, "", nil
}

func coverFromFile(path string) ([]byte, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	m, err := tag.ReadFrom(f)
	if err != nil {
		return nil, "", err
	}
	pic := m.Picture()
	if pic == nil || len(pic.Data) == 0 {
		return nil, "", nil
	}
	mimeType := strings.TrimSpace(pic.MIMEType)
	if mimeType == "" {
		switch strings.ToLower(pic.Ext) {
		case "jpg", "jpeg":
			mimeType = "image/jpeg"
		case "png":
			mimeType = "image/png"
		case "webp":
			mimeType = "image/webp"
		default:
			mimeType = "application/octet-stream"
		}
	}
	return pic.Data, mimeType, nil
}

func (s *Service) ToggleSongFavorite(ctx context.Context, userID, id int) (models.Song, error) {
	if _, err := s.client.Song.Get(ctx, id); err != nil {
		return models.Song{}, err
	}
	existing, err := s.client.UserSongFavorite.Query().
		Where(usersongfavorite.HasUserWith(user.ID(userID)), usersongfavorite.HasSongWith(song.ID(id))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.Song{}, err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.UserSongFavorite.Create().SetUserID(userID).SetSongID(id).Save(ctx)
	} else {
		err = s.client.UserSongFavorite.DeleteOneID(existing.ID).Exec(ctx)
	}
	if err != nil {
		return models.Song{}, err
	}
	return s.Song(ctx, userID, id)
}

func (s *Service) MarkPlayed(ctx context.Context, userID, id int) error {
	if _, err := s.client.Song.Get(ctx, id); err != nil {
		return err
	}
	if _, err := s.client.PlayHistory.Create().SetUserID(userID).SetSongID(id).Save(ctx); err != nil {
		return err
	}
	return s.client.Song.UpdateOneID(id).AddPlayCount(1).SetLastPlayedAt(time.Now()).Exec(ctx)
}

func (s *Service) Lyrics(ctx context.Context, id int, sourceID string) (models.Lyrics, error) {
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().Only(ctx)
	if err != nil {
		return models.Lyrics{}, err
	}
	if strings.TrimSpace(item.LyricsEmbedded) != "" {
		return models.Lyrics{SongID: id, Source: "embedded", Lyrics: item.LyricsEmbedded}, nil
	}
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		sourceID = strings.TrimSpace(item.NeteaseID)
	}
	artistName := ""
	if item.Edges.Artist != nil {
		artistName = item.Edges.Artist.Name
	}
	lyric, matchedID, matchedSource, err := s.matchOnlineLyrics(ctx, item.Title, artistName, sourceID)
	if err != nil {
		return models.Lyrics{}, err
	}
	if strings.TrimSpace(lyric) == "" {
		return models.Lyrics{SongID: id, Source: "online:not-found", Lyrics: ""}, nil
	}
	if matchedSource == "" {
		matchedSource = "online"
	}
	update := item.Update().SetLyricsEmbedded(lyric).SetLyricsSource(matchedSource)
	if matchedSource == "netease" && matchedID != "" {
		update.SetNeteaseID(matchedID)
	}
	_, _ = update.Save(ctx)
	return models.Lyrics{SongID: id, Source: "online", Lyrics: lyric, Fetched: true}, nil
}

func (s *Service) LyricCandidates(ctx context.Context, id int) ([]models.LyricCandidate, error) {
	item, err := s.client.Song.Query().Where(song.ID(id)).WithArtist().Only(ctx)
	if err != nil {
		return nil, err
	}
	artistName := ""
	if item.Edges.Artist != nil {
		artistName = item.Edges.Artist.Name
	}
	out := []models.LyricCandidate{}
	seen := map[string]bool{}
	appendCandidates := func(items []models.LyricCandidate) {
		for _, candidate := range items {
			key := candidate.Source + ":" + candidate.ID
			if candidate.ID == "" || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, candidate)
		}
	}
	if s.netease != nil {
		items, _ := s.netease.SearchCandidates(ctx, item.Title, artistName)
		appendCandidates(items)
	}
	if s.qqmusic != nil {
		items, _ := s.qqmusic.SearchCandidates(ctx, item.Title, artistName)
		appendCandidates(items)
	}
	return out, nil
}

func (s *Service) SelectLyrics(ctx context.Context, id int, source, sourceID string) (models.Lyrics, error) {
	source = strings.ToLower(strings.TrimSpace(source))
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return models.Lyrics{}, fmt.Errorf("lyric candidate id is required")
	}
	lyric, err := s.fetchLyricsBySource(ctx, source, sourceID)
	if err != nil {
		return models.Lyrics{}, err
	}
	if strings.TrimSpace(lyric) == "" {
		return models.Lyrics{SongID: id, Source: source + ":not-found", Lyrics: ""}, nil
	}
	update := s.client.Song.UpdateOneID(id).SetLyricsEmbedded(lyric).SetLyricsSource(source)
	if source == "netease" {
		update.SetNeteaseID(sourceID)
	}
	if err := update.Exec(ctx); err != nil {
		return models.Lyrics{}, err
	}
	return models.Lyrics{SongID: id, Source: source, Lyrics: lyric, Fetched: true}, nil
}

func (s *Service) matchOnlineLyrics(ctx context.Context, title, artist, preferredID string) (string, string, string, error) {
	preferredID = strings.TrimSpace(preferredID)
	if strings.Contains(preferredID, ":") {
		parts := strings.SplitN(preferredID, ":", 2)
		lyric, err := s.fetchLyricsBySource(ctx, parts[0], parts[1])
		return lyric, parts[1], strings.ToLower(strings.TrimSpace(parts[0])), err
	}
	if preferredID != "" && s.netease != nil {
		lyric, err := s.netease.Lyrics(ctx, preferredID)
		if err != nil {
			return "", "", "", err
		}
		if strings.TrimSpace(lyric) != "" {
			return lyric, preferredID, "netease", nil
		}
	}
	if s.netease != nil {
		id, err := s.netease.SearchSongID(ctx, title, artist)
		if err == nil && strings.TrimSpace(id) != "" {
			lyric, lyricErr := s.netease.Lyrics(ctx, id)
			if lyricErr != nil {
				return "", "", "", lyricErr
			}
			if strings.TrimSpace(lyric) != "" {
				return lyric, id, "netease", nil
			}
		}
	}
	if s.qqmusic != nil {
		id, err := s.qqmusic.SearchSongID(ctx, title, artist)
		if err == nil && strings.TrimSpace(id) != "" {
			lyric, lyricErr := s.qqmusic.Lyrics(ctx, id)
			if lyricErr != nil {
				return "", "", "", lyricErr
			}
			if strings.TrimSpace(lyric) != "" {
				return lyric, id, "qq", nil
			}
		}
	}
	return "", "", "", nil
}

func (s *Service) fetchLyricsBySource(ctx context.Context, source, sourceID string) (string, error) {
	source = strings.ToLower(strings.TrimSpace(source))
	switch source {
	case "netease", "":
		if s.netease == nil {
			return "", nil
		}
		return s.netease.Lyrics(ctx, sourceID)
	case "qq", "qqmusic":
		if s.qqmusic == nil {
			return "", nil
		}
		return s.qqmusic.Lyrics(ctx, sourceID)
	default:
		return "", fmt.Errorf("unsupported lyric source")
	}
}

func (s *Service) Playlists(ctx context.Context, userID int) ([]models.Playlist, error) {
	items, err := s.client.Playlist.Query().Where(playlist.HasOwnerWith(user.ID(userID))).WithSongs().Order(ent.Desc(playlist.FieldUpdatedAt)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.Playlist, 0, len(items))
	for _, p := range items {
		out = append(out, mapPlaylist(p))
	}
	return out, nil
}

func (s *Service) CreatePlaylist(ctx context.Context, userID int, name, description, theme string) (models.Playlist, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return models.Playlist{}, fmt.Errorf("playlist name is required")
	}
	if theme == "" {
		theme = "deep-space"
	}
	p, err := s.client.Playlist.Create().SetName(name).SetDescription(description).SetCoverTheme(theme).SetOwnerID(userID).Save(ctx)
	if err != nil {
		return models.Playlist{}, err
	}
	return mapPlaylist(p), nil
}

func (s *Service) PlaylistSongs(ctx context.Context, userID, id int) ([]models.Song, error) {
	p, err := s.client.Playlist.Query().
		Where(playlist.ID(id), playlist.HasOwnerWith(user.ID(userID))).
		WithSongs(func(q *ent.SongQuery) { q.WithArtist().WithAlbum() }).
		Only(ctx)
	if err != nil {
		return nil, err
	}
	out := mapSongs(p.Edges.Songs)
	return s.applySongUserState(ctx, userID, out)
}

func (s *Service) AddSongToPlaylist(ctx context.Context, userID, playlistID, songID int) error {
	p, err := s.client.Playlist.Query().Where(playlist.ID(playlistID), playlist.HasOwnerWith(user.ID(userID))).Only(ctx)
	if err != nil {
		return err
	}
	return p.Update().AddSongIDs(songID).Exec(ctx)
}

func (s *Service) RemoveSongFromPlaylist(ctx context.Context, userID, playlistID, songID int) error {
	p, err := s.client.Playlist.Query().Where(playlist.ID(playlistID), playlist.HasOwnerWith(user.ID(userID))).Only(ctx)
	if err != nil {
		return err
	}
	return p.Update().RemoveSongIDs(songID).Exec(ctx)
}

func (s *Service) Albums(ctx context.Context, userID int) ([]models.Album, error) {
	items, err := s.client.Album.Query().WithArtist().WithSongs().Order(ent.Desc(album.FieldUpdatedAt)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.Album, 0, len(items))
	for _, a := range items {
		out = append(out, mapAlbum(a))
	}
	return s.applyAlbumUserState(ctx, userID, out)
}

func (s *Service) AlbumSongs(ctx context.Context, userID, id int) ([]models.Song, error) {
	a, err := s.client.Album.Query().Where(album.ID(id)).WithSongs(func(q *ent.SongQuery) { q.WithArtist().WithAlbum() }).Only(ctx)
	if err != nil {
		return nil, err
	}
	out := mapSongs(a.Edges.Songs)
	return s.applySongUserState(ctx, userID, out)
}

func (s *Service) Artists(ctx context.Context) ([]models.Artist, error) {
	items, err := s.client.Artist.Query().WithSongs().WithAlbums().Order(ent.Asc(artist.FieldName)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.Artist, 0, len(items))
	for _, a := range items {
		out = append(out, mapArtist(a))
	}
	return out, nil
}

func (s *Service) ArtistSongs(ctx context.Context, userID, id int) ([]models.Song, error) {
	a, err := s.client.Artist.Query().Where(artist.ID(id)).WithSongs(func(q *ent.SongQuery) { q.WithArtist().WithAlbum().Order(ent.Asc(song.FieldTitle)) }).Only(ctx)
	if err != nil {
		return nil, err
	}
	out := mapSongs(a.Edges.Songs)
	return s.applySongUserState(ctx, userID, out)
}

func (s *Service) ToggleAlbumFavorite(ctx context.Context, userID, id int) (models.Album, error) {
	if _, err := s.client.Album.Get(ctx, id); err != nil {
		return models.Album{}, err
	}
	existing, err := s.client.UserAlbumFavorite.Query().
		Where(useralbumfavorite.HasUserWith(user.ID(userID)), useralbumfavorite.HasAlbumWith(album.ID(id))).
		Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return models.Album{}, err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.UserAlbumFavorite.Create().SetUserID(userID).SetAlbumID(id).Save(ctx)
	} else {
		err = s.client.UserAlbumFavorite.DeleteOneID(existing.ID).Exec(ctx)
	}
	if err != nil {
		return models.Album{}, err
	}
	a, err := s.client.Album.Query().Where(album.ID(id)).WithArtist().WithSongs().Only(ctx)
	if err != nil {
		return models.Album{}, err
	}
	items, err := s.applyAlbumUserState(ctx, userID, []models.Album{mapAlbum(a)})
	if err != nil {
		return models.Album{}, err
	}
	return items[0], nil
}

func (s *Service) GetSettings(ctx context.Context) (models.Settings, error) {
	settings := models.Settings{Language: "zh-CN", Theme: "deep-space", SleepTimerMins: 0, LibraryPath: s.libraryDir, NeteaseFallback: true, RegistrationEnabled: false}
	items, err := s.client.AppSetting.Query().All(ctx)
	if err != nil {
		return settings, err
	}
	for _, item := range items {
		switch item.Key {
		case "language":
			settings.Language = item.Value
		case "theme":
			settings.Theme = item.Value
		case "sleep_timer_mins":
			settings.SleepTimerMins, _ = strconv.Atoi(item.Value)
		case "netease_fallback":
			settings.NeteaseFallback = item.Value != "false"
		case settingRegistrationEnabled:
			settings.RegistrationEnabled = item.Value == "true"
		}
	}
	return settings, nil
}

func (s *Service) SaveSettings(ctx context.Context, settings models.Settings) (models.Settings, error) {
	if settings.Language == "" {
		settings.Language = "zh-CN"
	}
	if settings.Theme == "" {
		settings.Theme = "deep-space"
	}
	pairs := map[string]string{"language": settings.Language, "theme": settings.Theme, "sleep_timer_mins": strconv.Itoa(settings.SleepTimerMins), "netease_fallback": strconv.FormatBool(settings.NeteaseFallback), settingRegistrationEnabled: strconv.FormatBool(settings.RegistrationEnabled)}
	for key, value := range pairs {
		if err := s.setSetting(ctx, key, value); err != nil {
			return models.Settings{}, err
		}
	}
	return s.GetSettings(ctx)
}

func (s *Service) setSetting(ctx context.Context, key, value string) error {
	existing, err := s.client.AppSetting.Query().Where(appsetting.Key(key)).Only(ctx)
	if err != nil && !ent.IsNotFound(err) {
		return err
	}
	if ent.IsNotFound(err) {
		_, err = s.client.AppSetting.Create().SetKey(key).SetValue(value).Save(ctx)
		return err
	}
	return existing.Update().SetValue(value).Exec(ctx)
}

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

func (s *Service) ensureAlbum(ctx context.Context, title, albumArtist string, ar *ent.Artist) (*ent.Album, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Unknown Album"
	}
	item, err := s.client.Album.Query().Where(album.Title(title)).Only(ctx)
	if err == nil {
		return item, nil
	}
	if !ent.IsNotFound(err) {
		return nil, err
	}
	return s.client.Album.Create().SetTitle(title).SetAlbumArtist(albumArtist).SetArtist(ar).Save(ctx)
}

func (s *Service) probe(path string) fileMetadata {
	meta := s.probeTags(path)
	if s.ffprobe == "" {
		return meta
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, s.ffprobe, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path)
	out, err := cmd.Output()
	if err != nil {
		return meta
	}
	var probed ffprobeOutput
	if err := json.Unmarshal(out, &probed); err != nil {
		return meta
	}
	tags := normalizeTags(probed.Format.Tags)
	if meta.Title == "" {
		meta.Title = first(tags, "title")
	}
	if meta.Artist == "" {
		meta.Artist = first(tags, "artist", "album_artist", "albumartist")
	}
	if meta.Album == "" {
		meta.Album = first(tags, "album")
	}
	if meta.AlbumArtist == "" {
		meta.AlbumArtist = first(tags, "album_artist", "albumartist")
	}
	if meta.Lyrics == "" {
		meta.Lyrics = first(tags, "lyrics", "unsyncedlyrics", "unsynced_lyrics", "syncedlyrics")
	}
	meta.Duration, _ = strconv.ParseFloat(probed.Format.Duration, 64)
	bitrate, _ := strconv.Atoi(probed.Format.BitRate)
	meta.BitRate = bitrate
	for _, stream := range probed.Streams {
		if stream.CodecType != "audio" {
			continue
		}
		meta.SampleRate, _ = strconv.Atoi(stream.SampleRate)
		meta.BitDepth = stream.Bits
		streamTags := normalizeTags(stream.Tags)
		if meta.Lyrics == "" {
			meta.Lyrics = first(streamTags, "lyrics", "unsyncedlyrics", "unsynced_lyrics", "syncedlyrics")
		}
		break
	}
	return meta
}

func (s *Service) probeTags(path string) fileMetadata {
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
		Title:       strings.TrimSpace(m.Title()),
		Artist:      strings.TrimSpace(m.Artist()),
		Album:       strings.TrimSpace(m.Album()),
		AlbumArtist: strings.TrimSpace(m.AlbumArtist()),
		Lyrics:      strings.TrimSpace(m.Lyrics()),
	}
	if meta.Artist == "" {
		meta.Artist = strings.TrimSpace(m.Composer())
	}
	return meta
}

func normalizeTags(in map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range in {
		out[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
	}
	return out
}

func first(tags map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(tags[k]); v != "" {
			return v
		}
	}
	return ""
}

func audioMime(format string) string {
	switch format {
	case "mp3":
		return "audio/mpeg"
	case "flac":
		return "audio/flac"
	case "wav":
		return "audio/wav"
	case "m4a", "aac", "alac":
		return "audio/mp4"
	case "ogg", "oga":
		return "audio/ogg"
	case "opus":
		return "audio/opus"
	case "aiff", "aif":
		return "audio/aiff"
	default:
		return "application/octet-stream"
	}
}

func sourceIf(ok bool, yes, no string) string {
	if ok {
		return yes
	}
	return no
}

func (s *Service) applySongUserState(ctx context.Context, userID int, items []models.Song) ([]models.Song, error) {
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	favorites, err := s.client.UserSongFavorite.Query().
		Where(usersongfavorite.HasUserWith(user.ID(userID)), usersongfavorite.HasSongWith(song.IDIn(ids...))).
		WithSong().
		All(ctx)
	if err != nil {
		return nil, err
	}
	favoriteIDs := map[int]bool{}
	for _, favorite := range favorites {
		if favorite.Edges.Song != nil {
			favoriteIDs[favorite.Edges.Song.ID] = true
		}
	}
	histories, err := s.client.PlayHistory.Query().
		Where(playhistory.HasUserWith(user.ID(userID)), playhistory.HasSongWith(song.IDIn(ids...))).
		WithSong().
		Order(ent.Desc(playhistory.FieldPlayedAt)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	playCounts := map[int]int{}
	lastPlayed := map[int]time.Time{}
	for _, history := range histories {
		if history.Edges.Song == nil {
			continue
		}
		songID := history.Edges.Song.ID
		playCounts[songID]++
		if lastPlayed[songID].IsZero() || history.PlayedAt.After(lastPlayed[songID]) {
			lastPlayed[songID] = history.PlayedAt
		}
	}
	for i := range items {
		items[i].Favorite = favoriteIDs[items[i].ID]
		items[i].PlayCount = playCounts[items[i].ID]
		if playedAt, ok := lastPlayed[items[i].ID]; ok {
			items[i].LastPlayedAt = &playedAt
		} else {
			items[i].LastPlayedAt = nil
		}
	}
	return items, nil
}

func (s *Service) applyAlbumUserState(ctx context.Context, userID int, items []models.Album) ([]models.Album, error) {
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]int, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	favorites, err := s.client.UserAlbumFavorite.Query().
		Where(useralbumfavorite.HasUserWith(user.ID(userID)), useralbumfavorite.HasAlbumWith(album.IDIn(ids...))).
		WithAlbum().
		All(ctx)
	if err != nil {
		return nil, err
	}
	favoriteIDs := map[int]bool{}
	for _, favorite := range favorites {
		if favorite.Edges.Album != nil {
			favoriteIDs[favorite.Edges.Album.ID] = true
		}
	}
	for i := range items {
		items[i].Favorite = favoriteIDs[items[i].ID]
	}
	return items, nil
}

func mapSongs(items []*ent.Song) []models.Song {
	out := make([]models.Song, 0, len(items))
	for _, item := range items {
		out = append(out, mapSong(item))
	}
	return out
}

func mapSong(item *ent.Song) models.Song {
	artistID, albumID := 0, 0
	artistName, albumTitle := "", ""
	if item.Edges.Artist != nil {
		artistID = item.Edges.Artist.ID
		artistName = item.Edges.Artist.Name
	}
	if item.Edges.Album != nil {
		albumID = item.Edges.Album.ID
		albumTitle = item.Edges.Album.Title
	}
	return models.Song{ID: item.ID, Title: item.Title, ArtistID: artistID, Artist: artistName, AlbumID: albumID, Album: albumTitle, Path: item.Path, FileName: item.FileName, Format: item.Format, Mime: item.Mime, SizeBytes: item.SizeBytes, DurationSeconds: item.DurationSeconds, SampleRate: item.SampleRate, BitRate: item.BitRate, BitDepth: item.BitDepth, NeteaseID: item.NeteaseID, Favorite: item.Favorite, PlayCount: item.PlayCount, LastPlayedAt: item.LastPlayedAt, HasLyrics: strings.TrimSpace(item.LyricsEmbedded) != "", LyricsSource: item.LyricsSource, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func mapAlbum(item *ent.Album) models.Album {
	artistID := 0
	artistName := ""
	if item.Edges.Artist != nil {
		artistID = item.Edges.Artist.ID
		artistName = item.Edges.Artist.Name
	}
	return models.Album{ID: item.ID, Title: item.Title, ArtistID: artistID, Artist: artistName, AlbumArtist: item.AlbumArtist, Favorite: item.Favorite, SongCount: len(item.Edges.Songs), CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func mapArtist(item *ent.Artist) models.Artist {
	return models.Artist{ID: item.ID, Name: item.Name, SongCount: len(item.Edges.Songs), AlbumCount: len(item.Edges.Albums), CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func mapPlaylist(item *ent.Playlist) models.Playlist {
	count := 0
	if item.Edges.Songs != nil {
		count = len(item.Edges.Songs)
	}
	return models.Playlist{ID: item.ID, Name: item.Name, Description: item.Description, CoverTheme: item.CoverTheme, Favorite: item.Favorite, SongCount: count, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func IsMissing(err error) bool { return errors.Is(err, os.ErrNotExist) || ent.IsNotFound(err) }
