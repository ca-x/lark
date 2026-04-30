package api

import (
	"context"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"lark/backend/ent"
	"lark/backend/internal/models"
	"lark/backend/pkg/version"

	echo "github.com/labstack/echo/v5"
)

func (s *Server) handleSubsonic(c *echo.Context) error {
	ctx := c.Request().Context()
	endpoint := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(c.Param("endpoint"))), ".view")
	if endpoint == "getopensubsonicextensions" {
		return subsonicOK(c, subsonicResponse{OpenSubsonicExtensions: &subsonicOpenSubsonicExtensions{Extension: []subsonicOpenSubsonicExtension{
			{Name: "transcodeOffset", Versions: []int{1}},
			{Name: "formPost", Versions: []int{1}},
			{Name: "songLyrics", Versions: []int{1}},
			{Name: "indexBasedQueue", Versions: []int{1}},
			{Name: "transcoding", Versions: []int{1}},
		}}})
	}
	settings, err := s.lib.GetSettings(ctx)
	if err != nil {
		return mapError(err)
	}
	if !settings.SubsonicServerEnabled {
		return subsonicError(c, 50, "Subsonic API is disabled")
	}
	u, err := s.authenticateSubsonicRequest(c)
	if err != nil {
		return subsonicError(c, 40, "Wrong username or password")
	}
	switch endpoint {
	case "ping":
		return subsonicOK(c, subsonicResponse{})
	case "getlicense":
		return subsonicOK(c, subsonicResponse{License: &subsonicLicense{Valid: true}})
	case "getmusicfolders":
		return subsonicOK(c, subsonicResponse{MusicFolders: &subsonicMusicFolders{MusicFolder: []subsonicMusicFolder{{ID: "1", Name: "Lark"}}}})
	case "getuser":
		username := firstNonEmpty(requestParam(c, "username"), requestParam(c, "u"), u.Username)
		return subsonicOK(c, subsonicResponse{User: &subsonicUser{
			Username:          username,
			ScrobblingEnabled: true,
			AdminRole:         u.Role == "admin",
			SettingsRole:      true,
			DownloadRole:      true,
			StreamRole:        true,
			PlaylistRole:      true,
			CoverArtRole:      true,
		}})
	case "getartists":
		items, err := s.lib.Artists(ctx, u.ID, 500)
		if err != nil {
			return mapError(err)
		}
		grouped := map[string][]subsonicArtist{}
		order := []string{}
		for _, item := range items {
			key := strings.ToUpper(firstRune(item.Name))
			if _, ok := grouped[key]; !ok {
				order = append(order, key)
			}
			grouped[key] = append(grouped[key], subsonicArtistFromModel(item))
		}
		indexes := make([]subsonicIndex, 0, len(grouped))
		for _, key := range order {
			indexes = append(indexes, subsonicIndex{Name: key, Artist: grouped[key]})
		}
		return subsonicOK(c, subsonicResponse{Artists: &subsonicArtists{Index: indexes}})
	case "getmusicdirectory":
		dir, err := s.subsonicDirectory(ctx, c, u.ID)
		if err != nil {
			return mapError(err)
		}
		return subsonicOK(c, subsonicResponse{Directory: dir})
	case "getartist":
		id, err := querySubsonicID(c, "id")
		if err != nil {
			return subsonicError(c, 10, "Required parameter is missing")
		}
		item, err := s.lib.Artist(ctx, u.ID, id)
		if err != nil {
			return mapError(err)
		}
		page, err := s.lib.AlbumsPage(ctx, u.ID, 500, 0, id)
		if err != nil {
			return mapError(err)
		}
		out := subsonicArtistFromModel(item)
		out.Album = mapSubsonicAlbums(page.Items)
		return subsonicOK(c, subsonicResponse{Artist: &out})
	case "getalbum":
		id, err := querySubsonicID(c, "id")
		if err != nil {
			return subsonicError(c, 10, "Required parameter is missing")
		}
		item, err := s.lib.Album(ctx, u.ID, id)
		if err != nil {
			return mapError(err)
		}
		songs, err := s.lib.AlbumSongs(ctx, u.ID, id, 500)
		if err != nil {
			return mapError(err)
		}
		out := subsonicAlbumFromModel(item)
		out.Song = mapSubsonicSongs(songs)
		return subsonicOK(c, subsonicResponse{Album: &out})
	case "getalbuminfo", "getalbuminfo2":
		return subsonicOK(c, subsonicResponse{AlbumInfo: &subsonicAlbumInfo{}})
	case "getartistinfo":
		return subsonicOK(c, subsonicResponse{ArtistInfo: &subsonicArtistInfo{}})
	case "getartistinfo2":
		return subsonicOK(c, subsonicResponse{ArtistInfo2: &subsonicArtistInfo{}})
	case "search2", "search3":
		limit := requestParamInt(c, "songCount", 20)
		if limit <= 0 || limit > 100 {
			limit = 20
		}
		items, err := s.lib.Songs(ctx, u.ID, requestParam(c, "query"), false, limit)
		if err != nil {
			return mapError(err)
		}
		if endpoint == "search2" {
			return subsonicOK(c, subsonicResponse{SearchResult2: &subsonicSearchResult3{Song: mapSubsonicSongs(items)}})
		}
		return subsonicOK(c, subsonicResponse{SearchResult3: &subsonicSearchResult3{Song: mapSubsonicSongs(items)}})
	case "getsong":
		id, err := querySubsonicID(c, "id")
		if err != nil {
			return subsonicError(c, 10, "Required parameter is missing")
		}
		item, err := s.lib.Song(ctx, u.ID, id)
		if err != nil {
			return mapError(err)
		}
		song := subsonicSongFromModel(item)
		return subsonicOK(c, subsonicResponse{Song: &song})
	case "stream", "download":
		id, err := querySubsonicID(c, "id")
		if err != nil {
			return subsonicError(c, 10, "Required parameter is missing")
		}
		if c.QueryParam("mode") == "" {
			q := c.Request().URL.Query()
			q.Set("mode", settings.TranscodePolicy)
			if q.Get("quality") == "" {
				q.Set("quality", strconv.Itoa(settings.TranscodeQualityKbps))
			}
			c.Request().URL.RawQuery = q.Encode()
		}
		return s.streamSong(c, id)
	case "getcoverart":
		rawID := strings.TrimSpace(requestParam(c, "id"))
		id, err := querySubsonicID(c, "id")
		if err != nil {
			return subsonicError(c, 10, "Required parameter is missing")
		}
		var data []byte
		var mimeType string
		if strings.HasPrefix(rawID, "album-") {
			data, mimeType, err = s.lib.AlbumCover(ctx, id)
		} else {
			data, mimeType, err = s.lib.SongCover(ctx, id)
		}
		if err != nil {
			return mapError(err)
		}
		if len(data) == 0 {
			return echo.NewHTTPError(http.StatusNotFound, "cover not found")
		}
		c.Response().Header().Set("Cache-Control", "public, max-age=86400")
		return c.Blob(http.StatusOK, mimeType, data)
	case "getalbumlist", "getalbumlist2":
		size := requestParamInt(c, "size", 20)
		offset := requestParamInt(c, "offset", 0)
		if size <= 0 || size > 100 {
			size = 20
		}
		page, err := s.lib.AlbumsPage(ctx, u.ID, size, offset, 0)
		if err != nil {
			return mapError(err)
		}
		if endpoint == "getalbumlist" {
			return subsonicOK(c, subsonicResponse{AlbumList: &subsonicAlbumList2{Album: mapSubsonicAlbums(page.Items)}})
		}
		return subsonicOK(c, subsonicResponse{AlbumList2: &subsonicAlbumList2{Album: mapSubsonicAlbums(page.Items)}})
	case "getplaylists":
		items, err := s.lib.Playlists(ctx, u.ID, 500)
		if err != nil {
			return mapError(err)
		}
		return subsonicOK(c, subsonicResponse{Playlists: &subsonicPlaylists{Playlist: mapSubsonicPlaylists(items)}})
	case "getplaylist":
		id, err := querySubsonicID(c, "id")
		if err != nil {
			return subsonicError(c, 10, "Required parameter is missing")
		}
		songs, err := s.lib.PlaylistSongs(ctx, u.ID, id, 500)
		if err != nil {
			return mapError(err)
		}
		entries := mapSubsonicSongs(songs)
		return subsonicOK(c, subsonicResponse{Playlist: &subsonicPlaylist{ID: strconv.Itoa(id), SongCount: len(entries), Entry: entries}})
	case "createplaylist":
		name := firstNonEmpty(requestParam(c, "name"), "New Playlist")
		playlist, err := s.lib.CreatePlaylist(ctx, u.ID, name, "", "subsonic")
		if err != nil {
			return mapError(err)
		}
		return subsonicOK(c, subsonicResponse{Playlist: ptrSubsonicPlaylist(subsonicPlaylistFromModel(playlist))})
	case "deleteplaylist", "updateplaylist":
		return subsonicError(c, 0, "Endpoint not implemented")
	case "getstarred", "getstarred2":
		songs, err := s.lib.Songs(ctx, u.ID, "", true, 500)
		if err != nil {
			return mapError(err)
		}
		albums, err := s.lib.FavoriteAlbums(ctx, u.ID, 500)
		if err != nil {
			return mapError(err)
		}
		artists, err := s.lib.FavoriteArtists(ctx, u.ID, 500)
		if err != nil {
			return mapError(err)
		}
		if endpoint == "getstarred" {
			return subsonicOK(c, subsonicResponse{Starred: &subsonicStarred2{
				Song:   mapSubsonicSongs(songs),
				Album:  mapSubsonicAlbums(albums),
				Artist: mapSubsonicArtists(artists),
			}})
		}
		return subsonicOK(c, subsonicResponse{Starred2: &subsonicStarred2{
			Song:   mapSubsonicSongs(songs),
			Album:  mapSubsonicAlbums(albums),
			Artist: mapSubsonicArtists(artists),
		}})
	case "getnowplaying":
		return subsonicOK(c, subsonicResponse{NowPlaying: &subsonicNowPlaying{Entry: []subsonicNowPlayingEntry{}}})
	case "getrandomsongs":
		size := requestParamInt(c, "size", 20)
		if size <= 0 || size > 100 {
			size = 20
		}
		items, err := s.lib.DailyMix(ctx, u.ID, size)
		if err != nil {
			return mapError(err)
		}
		return subsonicOK(c, subsonicResponse{RandomSongs: &subsonicRandomSongs{Song: mapSubsonicSongs(items)}})
	case "getsongsbygenre":
		size := requestParamInt(c, "count", 20)
		offset := requestParamInt(c, "offset", 0)
		if size <= 0 || size > 100 {
			size = 20
		}
		page, err := s.lib.SongsPage(ctx, u.ID, "", false, size, offset)
		if err != nil {
			return mapError(err)
		}
		return subsonicOK(c, subsonicResponse{SongsByGenre: &subsonicRandomSongs{Song: mapSubsonicSongs(page.Items)}})
	case "getgenres":
		return subsonicOK(c, subsonicResponse{Genres: &subsonicGenres{Genre: []subsonicGenre{}}})
	case "gettopsongs":
		count := requestParamInt(c, "count", 50)
		if count <= 0 || count > 100 {
			count = 50
		}
		items, err := s.lib.Songs(ctx, u.ID, requestParam(c, "artist"), false, count)
		if err != nil {
			return mapError(err)
		}
		return subsonicOK(c, subsonicResponse{TopSongs: &subsonicRandomSongs{Song: mapSubsonicSongs(items)}})
	case "getsimilarsongs", "getsimilarsongs2":
		count := requestParamInt(c, "count", 50)
		if count <= 0 || count > 100 {
			count = 50
		}
		items, err := s.lib.DailyMix(ctx, u.ID, count)
		if err != nil {
			return mapError(err)
		}
		if endpoint == "getsimilarsongs" {
			return subsonicOK(c, subsonicResponse{SimilarSongs: &subsonicRandomSongs{Song: mapSubsonicSongs(items)}})
		}
		return subsonicOK(c, subsonicResponse{SimilarSongs2: &subsonicRandomSongs{Song: mapSubsonicSongs(items)}})
	case "getlyrics", "getlyricsbysongid":
		id, err := querySubsonicID(c, "id")
		if err != nil {
			return subsonicError(c, 10, "Required parameter is missing")
		}
		lyrics, err := s.lib.Lyrics(ctx, id, "")
		if err != nil {
			return mapError(err)
		}
		return subsonicOK(c, subsonicResponse{Lyrics: &subsonicLyrics{Value: lyrics.Lyrics}})
	case "getscanstatus":
		status := s.lib.ScanStatus()
		return subsonicOK(c, subsonicResponse{ScanStatus: &subsonicScanStatus{Scanning: status.Running, Count: status.Scanned, FolderCount: 1}})
	case "startscan":
		go func() {
			_, _ = s.lib.Scan(context.Background(), u.ID)
		}()
		status := s.lib.ScanStatus()
		return subsonicOK(c, subsonicResponse{ScanStatus: &subsonicScanStatus{Scanning: true, Count: status.Scanned, FolderCount: 1}})
	case "scrobble":
		id, err := querySubsonicID(c, "id")
		if err != nil {
			return subsonicError(c, 10, "Required parameter is missing")
		}
		if err := s.lib.MarkPlayed(ctx, u.ID, id); err != nil {
			return mapError(err)
		}
		return subsonicOK(c, subsonicResponse{})
	case "star", "unstar":
		if err := s.applySubsonicStar(ctx, c, u.ID, endpoint == "star"); err != nil {
			return mapError(err)
		}
		return subsonicOK(c, subsonicResponse{})
	case "getindexes":
		items, err := s.lib.Artists(ctx, u.ID, 500)
		if err != nil {
			return mapError(err)
		}
		indexes := make([]subsonicIndex, 0, len(items))
		for _, item := range items {
			indexes = append(indexes, subsonicIndex{Name: strings.ToUpper(firstRune(item.Name)), Artist: []subsonicArtist{subsonicArtistFromModel(item)}})
		}
		return subsonicOK(c, subsonicResponse{Indexes: &subsonicIndexes{Index: indexes}})
	default:
		return subsonicError(c, 0, "Endpoint not implemented")
	}
}

func (s *Server) authenticateSubsonicRequest(c *echo.Context) (*ent.User, error) {
	username := requestParam(c, "u")
	password := requestParam(c, "p")
	if strings.HasPrefix(strings.ToLower(password), "enc:") {
		if decoded, err := hex.DecodeString(password[4:]); err == nil {
			password = string(decoded)
		}
	}
	return s.lib.AuthenticateSubsonic(c.Request().Context(), username, password, requestParam(c, "t"), requestParam(c, "s"))
}

func requestParam(c *echo.Context, name string) string {
	if value := c.QueryParam(name); value != "" {
		return value
	}
	return c.FormValue(name)
}

func requestParamInt(c *echo.Context, name string, fallback int) int {
	raw := strings.TrimSpace(requestParam(c, name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}

type subsonicResponseEnvelope struct {
	Response subsonicResponse `json:"subsonic-response"`
}

type subsonicResponse struct {
	Status                 string                          `json:"status"`
	Version                string                          `json:"version"`
	Type                   string                          `json:"type"`
	ServerVersion          string                          `json:"serverVersion"`
	OpenSubsonic           bool                            `json:"openSubsonic"`
	Error                  *subsonicErrorPayload           `json:"error,omitempty"`
	OpenSubsonicExtensions *subsonicOpenSubsonicExtensions `json:"openSubsonicExtensions,omitempty"`
	License                *subsonicLicense                `json:"license,omitempty"`
	MusicFolders           *subsonicMusicFolders           `json:"musicFolders,omitempty"`
	User                   *subsonicUser                   `json:"user,omitempty"`
	Artists                *subsonicArtists                `json:"artists,omitempty"`
	Indexes                *subsonicIndexes                `json:"indexes,omitempty"`
	Directory              *subsonicDirectory              `json:"directory,omitempty"`
	Genres                 *subsonicGenres                 `json:"genres,omitempty"`
	Artist                 *subsonicArtist                 `json:"artist,omitempty"`
	Album                  *subsonicAlbum                  `json:"album,omitempty"`
	AlbumInfo              *subsonicAlbumInfo              `json:"albumInfo,omitempty"`
	ArtistInfo             *subsonicArtistInfo             `json:"artistInfo,omitempty"`
	ArtistInfo2            *subsonicArtistInfo             `json:"artistInfo2,omitempty"`
	SearchResult2          *subsonicSearchResult3          `json:"searchResult2,omitempty"`
	SearchResult3          *subsonicSearchResult3          `json:"searchResult3,omitempty"`
	Song                   *subsonicSong                   `json:"song,omitempty"`
	AlbumList              *subsonicAlbumList2             `json:"albumList,omitempty"`
	AlbumList2             *subsonicAlbumList2             `json:"albumList2,omitempty"`
	Playlists              *subsonicPlaylists              `json:"playlists,omitempty"`
	Playlist               *subsonicPlaylist               `json:"playlist,omitempty"`
	Starred                *subsonicStarred2               `json:"starred,omitempty"`
	Starred2               *subsonicStarred2               `json:"starred2,omitempty"`
	NowPlaying             *subsonicNowPlaying             `json:"nowPlaying,omitempty"`
	RandomSongs            *subsonicRandomSongs            `json:"randomSongs,omitempty"`
	SongsByGenre           *subsonicRandomSongs            `json:"songsByGenre,omitempty"`
	SimilarSongs           *subsonicRandomSongs            `json:"similarSongs,omitempty"`
	SimilarSongs2          *subsonicRandomSongs            `json:"similarSongs2,omitempty"`
	TopSongs               *subsonicRandomSongs            `json:"topSongs,omitempty"`
	Lyrics                 *subsonicLyrics                 `json:"lyrics,omitempty"`
	ScanStatus             *subsonicScanStatus             `json:"scanStatus,omitempty"`
}

type subsonicOpenSubsonicExtensions struct {
	Extension []subsonicOpenSubsonicExtension `json:"extension"`
}

type subsonicOpenSubsonicExtension struct {
	Name     string `json:"name"`
	Versions []int  `json:"versions"`
}

type subsonicErrorPayload struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type subsonicLicense struct {
	Valid bool `json:"valid"`
}

type subsonicMusicFolders struct {
	MusicFolder []subsonicMusicFolder `json:"musicFolder"`
}

type subsonicMusicFolder struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type subsonicDirectory struct {
	ID        string         `json:"id"`
	Parent    string         `json:"parent,omitempty"`
	Name      string         `json:"name"`
	Artist    string         `json:"artist,omitempty"`
	Album     string         `json:"album,omitempty"`
	CoverArt  string         `json:"coverArt,omitempty"`
	SongCount int            `json:"songCount,omitempty"`
	Child     []subsonicSong `json:"child"`
}

type subsonicGenres struct {
	Genre []subsonicGenre `json:"genre"`
}

type subsonicGenre struct {
	SongCount  int    `json:"songCount"`
	AlbumCount int    `json:"albumCount"`
	Value      string `json:"value"`
}

type subsonicUser struct {
	Username          string `json:"username"`
	ScrobblingEnabled bool   `json:"scrobblingEnabled"`
	AdminRole         bool   `json:"adminRole"`
	SettingsRole      bool   `json:"settingsRole"`
	DownloadRole      bool   `json:"downloadRole"`
	StreamRole        bool   `json:"streamRole"`
	PlaylistRole      bool   `json:"playlistRole"`
	CoverArtRole      bool   `json:"coverArtRole"`
}

type subsonicArtists struct {
	Index []subsonicIndex `json:"index"`
}

type subsonicIndexes struct {
	Index []subsonicIndex `json:"index"`
}

type subsonicIndex struct {
	Name   string           `json:"name"`
	Artist []subsonicArtist `json:"artist"`
}

type subsonicArtist struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	AlbumCount int             `json:"albumCount,omitempty"`
	Album      []subsonicAlbum `json:"album,omitempty"`
}

type subsonicAlbum struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Title     string         `json:"title"`
	Artist    string         `json:"artist"`
	ArtistID  string         `json:"artistId,omitempty"`
	SongCount int            `json:"songCount"`
	CoverArt  string         `json:"coverArt"`
	Year      int            `json:"year,omitempty"`
	Song      []subsonicSong `json:"song,omitempty"`
}

type subsonicSong struct {
	ID          string `json:"id"`
	Parent      string `json:"parent,omitempty"`
	Title       string `json:"title"`
	Album       string `json:"album,omitempty"`
	Artist      string `json:"artist,omitempty"`
	IsDir       bool   `json:"isDir"`
	Type        string `json:"type,omitempty"`
	Duration    int    `json:"duration,omitempty"`
	Suffix      string `json:"suffix,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	Size        int64  `json:"size,omitempty"`
	CoverArt    string `json:"coverArt,omitempty"`
	AlbumID     string `json:"albumId,omitempty"`
	ArtistID    string `json:"artistId,omitempty"`
	BitRate     int    `json:"bitRate,omitempty"`
	Year        int    `json:"year,omitempty"`
}

type subsonicAlbumInfo struct {
	Notes          string `json:"notes,omitempty"`
	SmallImageURL  string `json:"smallImageUrl,omitempty"`
	MediumImageURL string `json:"mediumImageUrl,omitempty"`
	LargeImageURL  string `json:"largeImageUrl,omitempty"`
	LastFmURL      string `json:"lastFmUrl,omitempty"`
	MusicBrainzID  string `json:"musicBrainzId,omitempty"`
}

type subsonicArtistInfo struct {
	Biography     string           `json:"biography,omitempty"`
	MusicBrainzID string           `json:"musicBrainzId,omitempty"`
	LastFmURL     string           `json:"lastFmUrl,omitempty"`
	SimilarArtist []subsonicArtist `json:"similarArtist,omitempty"`
}

type subsonicSearchResult3 struct {
	Song []subsonicSong `json:"song"`
}

type subsonicAlbumList2 struct {
	Album []subsonicAlbum `json:"album"`
}

type subsonicPlaylists struct {
	Playlist []subsonicPlaylist `json:"playlist"`
}

type subsonicPlaylist struct {
	ID        string         `json:"id"`
	Name      string         `json:"name,omitempty"`
	Comment   string         `json:"comment,omitempty"`
	SongCount int            `json:"songCount"`
	Public    bool           `json:"public"`
	Entry     []subsonicSong `json:"entry,omitempty"`
}

type subsonicStarred2 struct {
	Song   []subsonicSong   `json:"song"`
	Album  []subsonicAlbum  `json:"album"`
	Artist []subsonicArtist `json:"artist"`
}

type subsonicNowPlaying struct {
	Entry []subsonicNowPlayingEntry `json:"entry"`
}

type subsonicNowPlayingEntry struct {
	subsonicSong
	Username   string `json:"username,omitempty"`
	MinutesAgo int    `json:"minutesAgo,omitempty"`
	PlayerID   int    `json:"playerId,omitempty"`
	PlayerName string `json:"playerName,omitempty"`
}

type subsonicRandomSongs struct {
	Song []subsonicSong `json:"song"`
}

type subsonicLyrics struct {
	Value string `json:"value"`
}

type subsonicScanStatus struct {
	Scanning    bool `json:"scanning"`
	Count       int  `json:"count"`
	FolderCount int  `json:"folderCount"`
}

func subsonicOK(c *echo.Context, payload subsonicResponse) error {
	payload.Status = "ok"
	payload.Version = "1.16.1"
	payload.Type = "lark"
	payload.ServerVersion = version.Version
	payload.OpenSubsonic = true
	return c.JSON(http.StatusOK, subsonicResponseEnvelope{Response: payload})
}

func subsonicError(c *echo.Context, code int, message string) error {
	return c.JSON(http.StatusOK, subsonicResponseEnvelope{Response: subsonicResponse{
		Status:       "failed",
		Version:      "1.16.1",
		Type:         "lark",
		OpenSubsonic: true,
		Error:        &subsonicErrorPayload{Code: code, Message: message},
	}})
}

func querySubsonicID(c *echo.Context, name string) (int, error) {
	raw := strings.TrimSpace(requestParam(c, name))
	if raw == "" {
		return 0, fmt.Errorf("missing id")
	}
	if idx := strings.LastIndex(raw, "-"); idx >= 0 && idx < len(raw)-1 {
		raw = raw[idx+1:]
	}
	return strconv.Atoi(raw)
}

func (s *Server) applySubsonicStar(ctx context.Context, c *echo.Context, userID int, starred bool) error {
	if raw := requestParam(c, "id"); strings.TrimSpace(raw) != "" {
		id, err := querySubsonicID(c, "id")
		if err != nil {
			return err
		}
		item, err := s.lib.Song(ctx, userID, id)
		if err != nil {
			return err
		}
		if item.Favorite != starred {
			_, err = s.lib.ToggleSongFavorite(ctx, userID, id)
		}
		return err
	}
	if raw := requestParam(c, "albumId"); strings.TrimSpace(raw) != "" {
		id, err := querySubsonicID(c, "albumId")
		if err != nil {
			return err
		}
		item, err := s.lib.Album(ctx, userID, id)
		if err != nil {
			return err
		}
		if item.Favorite != starred {
			_, err = s.lib.ToggleAlbumFavorite(ctx, userID, id)
		}
		return err
	}
	if raw := requestParam(c, "artistId"); strings.TrimSpace(raw) != "" {
		id, err := querySubsonicID(c, "artistId")
		if err != nil {
			return err
		}
		item, err := s.lib.Artist(ctx, userID, id)
		if err != nil {
			return err
		}
		if item.Favorite != starred {
			_, err = s.lib.ToggleArtistFavorite(ctx, userID, id)
		}
		return err
	}
	return fmt.Errorf("star target is required")
}

func (s *Server) subsonicDirectory(ctx context.Context, c *echo.Context, userID int) (*subsonicDirectory, error) {
	raw := strings.TrimSpace(requestParam(c, "id"))
	id, err := querySubsonicID(c, "id")
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(raw, "album-") {
		return s.subsonicAlbumDirectory(ctx, userID, id)
	}
	if strings.HasPrefix(raw, "artist-") {
		return s.subsonicArtistDirectory(ctx, userID, id)
	}
	if dir, err := s.subsonicArtistDirectory(ctx, userID, id); err == nil {
		return dir, nil
	}
	return s.subsonicAlbumDirectory(ctx, userID, id)
}

func (s *Server) subsonicArtistDirectory(ctx context.Context, userID, id int) (*subsonicDirectory, error) {
	artist, err := s.lib.Artist(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	page, err := s.lib.AlbumsPage(ctx, userID, 500, 0, id)
	if err != nil {
		return nil, err
	}
	children := make([]subsonicSong, 0, len(page.Items))
	for _, album := range page.Items {
		children = append(children, subsonicAlbumAsChild(album))
	}
	return &subsonicDirectory{
		ID:        "artist-" + strconv.Itoa(artist.ID),
		Name:      artist.Name,
		SongCount: artist.SongCount,
		Child:     children,
	}, nil
}

func (s *Server) subsonicAlbumDirectory(ctx context.Context, userID, id int) (*subsonicDirectory, error) {
	album, err := s.lib.Album(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	songs, err := s.lib.AlbumSongs(ctx, userID, id, 500)
	if err != nil {
		return nil, err
	}
	return &subsonicDirectory{
		ID:        "album-" + strconv.Itoa(album.ID),
		Parent:    "artist-" + strconv.Itoa(album.ArtistID),
		Name:      album.Title,
		Artist:    firstNonEmpty(album.AlbumArtist, album.Artist),
		Album:     album.Title,
		CoverArt:  "album-" + strconv.Itoa(album.ID),
		SongCount: album.SongCount,
		Child:     mapSubsonicSongs(songs),
	}, nil
}

func subsonicSongFromModel(item models.Song) subsonicSong {
	id := strconv.Itoa(item.ID)
	out := subsonicSong{
		ID:          id,
		Title:       firstNonEmpty(item.Title, item.FileName),
		Album:       item.Album,
		Artist:      item.Artist,
		IsDir:       false,
		Type:        "music",
		Duration:    int(item.DurationSeconds + 0.5),
		Suffix:      item.Format,
		ContentType: item.Mime,
		Size:        item.SizeBytes,
		CoverArt:    "song-" + id,
	}
	if item.AlbumID > 0 {
		out.Parent = "album-" + strconv.Itoa(item.AlbumID)
		out.AlbumID = "album-" + strconv.Itoa(item.AlbumID)
	}
	if item.ArtistID > 0 {
		out.ArtistID = "artist-" + strconv.Itoa(item.ArtistID)
	}
	if item.BitRate > 0 {
		out.BitRate = item.BitRate / 1000
	}
	if item.Year > 0 {
		out.Year = item.Year
	}
	return out
}

func subsonicAlbumFromModel(item models.Album) subsonicAlbum {
	out := subsonicAlbum{
		ID:        "album-" + strconv.Itoa(item.ID),
		Name:      item.Title,
		Title:     item.Title,
		Artist:    firstNonEmpty(item.AlbumArtist, item.Artist),
		SongCount: item.SongCount,
		CoverArt:  "album-" + strconv.Itoa(item.ID),
	}
	if item.ArtistID > 0 {
		out.ArtistID = "artist-" + strconv.Itoa(item.ArtistID)
	}
	if item.Year > 0 {
		out.Year = item.Year
	}
	return out
}

func subsonicArtistFromModel(item models.Artist) subsonicArtist {
	return subsonicArtist{
		ID:         "artist-" + strconv.Itoa(item.ID),
		Name:       item.Name,
		AlbumCount: item.AlbumCount,
	}
}

func subsonicAlbumAsChild(item models.Album) subsonicSong {
	return subsonicSong{
		ID:       "album-" + strconv.Itoa(item.ID),
		Parent:   "artist-" + strconv.Itoa(item.ArtistID),
		Title:    item.Title,
		Album:    item.Title,
		Artist:   firstNonEmpty(item.AlbumArtist, item.Artist),
		IsDir:    true,
		Type:     "music",
		CoverArt: "album-" + strconv.Itoa(item.ID),
		AlbumID:  "album-" + strconv.Itoa(item.ID),
		ArtistID: "artist-" + strconv.Itoa(item.ArtistID),
		Year:     item.Year,
	}
}

func subsonicPlaylistFromModel(item models.Playlist) subsonicPlaylist {
	return subsonicPlaylist{
		ID:        strconv.Itoa(item.ID),
		Name:      item.Name,
		Comment:   item.Description,
		SongCount: item.SongCount,
		Public:    false,
	}
}

func mapSubsonicSongs(items []models.Song) []subsonicSong {
	out := make([]subsonicSong, 0, len(items))
	for _, item := range items {
		out = append(out, subsonicSongFromModel(item))
	}
	return out
}

func mapSubsonicAlbums(items []models.Album) []subsonicAlbum {
	out := make([]subsonicAlbum, 0, len(items))
	for _, item := range items {
		out = append(out, subsonicAlbumFromModel(item))
	}
	return out
}

func mapSubsonicArtists(items []models.Artist) []subsonicArtist {
	out := make([]subsonicArtist, 0, len(items))
	for _, item := range items {
		out = append(out, subsonicArtistFromModel(item))
	}
	return out
}

func mapSubsonicPlaylists(items []models.Playlist) []subsonicPlaylist {
	out := make([]subsonicPlaylist, 0, len(items))
	for _, item := range items {
		out = append(out, subsonicPlaylistFromModel(item))
	}
	return out
}

func ptrSubsonicPlaylist(item subsonicPlaylist) *subsonicPlaylist {
	return &item
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func firstRune(value string) string {
	value = strings.TrimSpace(value)
	for _, r := range value {
		return string(r)
	}
	return "#"
}
