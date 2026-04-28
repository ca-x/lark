package online

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	defaultUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Lark/1.0"
	mobileUA  = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
)

type baseProvider struct{ http *http.Client }

func newHTTP() *http.Client { return &http.Client{Timeout: 10 * time.Second} }

func (b baseProvider) get(ctx context.Context, endpoint string, headers map[string]string) ([]byte, error) {
	client := b.http
	if client == nil {
		client = newHTTP()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", defaultUA)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	for k, v := range headers {
		if strings.TrimSpace(v) != "" {
			req.Header.Set(k, v)
		}
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("online status %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 4<<20))
}

func (b baseProvider) getJSON(ctx context.Context, endpoint string, headers map[string]string, out any) error {
	body, err := b.get(ctx, endpoint, headers)
	if err != nil {
		return err
	}
	return decodeLooseJSON(body, out)
}

func decodeLooseJSON(body []byte, out any) error {
	if err := json.Unmarshal(body, out); err == nil {
		return nil
	}
	loose := strings.TrimSpace(string(body))
	if loose == "" {
		return json.Unmarshal(body, out)
	}
	loose = strings.ReplaceAll(loose, "\\'", "__LARK_ESCAPED_APOSTROPHE__")
	loose = strings.ReplaceAll(loose, "'", "\"")
	loose = strings.ReplaceAll(loose, "__LARK_ESCAPED_APOSTROPHE__", "'")
	return json.Unmarshal([]byte(loose), out)
}

func query(title, artist string) string {
	return strings.TrimSpace(strings.TrimSpace(title) + " " + strings.TrimSpace(artist))
}
func clean(v string) string     { return strings.TrimSpace(html.UnescapeString(stripTags(v))) }
func stripTags(v string) string { return regexp.MustCompile(`<[^>]+>`).ReplaceAllString(v, "") }
func first(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
func norm(v string) string {
	v = strings.ToLower(strings.TrimSpace(html.UnescapeString(v)))
	for _, token := range []string{"（", "(", "[", "【", " - ", " feat.", " ft."} {
		if idx := strings.Index(v, token); idx >= 0 {
			v = v[:idx]
		}
	}
	return strings.NewReplacer(" ", "", "-", "", "_", "", "·", "", "・", "", "'", "", "’", "", ".", "").Replace(v)
}
func matchTitle(want, got string) bool {
	a, b := norm(want), norm(got)
	return a == "" || b == "" || a == b || strings.Contains(a, b) || strings.Contains(b, a)
}
func matchArtist(want, got string) bool {
	a, b := norm(want), norm(got)
	return a == "" || b == "" || a == b || strings.Contains(a, b) || strings.Contains(b, a)
}
func parseYear(v string) int {
	re := regexp.MustCompile(`(19|20)\d{2}`)
	m := re.FindString(v)
	if m == "" {
		return 0
	}
	y, _ := strconv.Atoi(m)
	return y
}
func unixMillisYear(v int64) int {
	if v <= 0 {
		return 0
	}
	if v > 1e12 {
		v /= 1000
	}
	return time.Unix(v, 0).Year()
}
func secondsFromMS(v int) int {
	if v > 10000 {
		return int(math.Round(float64(v) / 1000))
	}
	return v
}
func coverReplaceSize(v string) string {
	return strings.Replace(strings.TrimSpace(v), "{size}", "480", 1)
}
func sourceID(source, id string) string {
	if strings.TrimSpace(id) == "" {
		return ""
	}
	return source + ":" + strings.TrimSpace(id)
}
func trimLyrics(v string) string { return strings.TrimSpace(strings.ReplaceAll(v, "\r\n", "\n")) }
func q(values map[string]string) string {
	uv := url.Values{}
	for k, v := range values {
		uv.Set(k, v)
	}
	return uv.Encode()
}

func FilterSongs(items []Song, title, artist string, limit int) []Song {
	out := make([]Song, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.ID) == "" {
			continue
		}
		if !matchTitle(title, item.Title) {
			continue
		}
		if strings.TrimSpace(artist) != "" && !matchArtist(artist, item.Artist) {
			continue
		}
		out = append(out, item)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

// Providers returns the online metadata channels that are safe to use without cookies.
// The implementations intentionally cover search/lyrics/metadata only; playback/download
// URL logic from upstream references is not included in Lark.
func Providers() []Provider {
	return []Provider{
		NewLRCLib(), NewNeteaseAlbum(),
		NewKuwo(), NewKugou(), NewMigu(), NewQianqian(), NewSoda(), NewJoox(), NewFivesing(),
		NewJamendo(), NewITunes(), NewLastFM(),
	}
}

// NeteaseAlbum reads public NetEase album metadata. It intentionally does not
// expose playback URLs; it only contributes searchable album details.
type NeteaseAlbum struct{ baseProvider }

type neteaseName struct {
	Name string `json:"name"`
}

func NewNeteaseAlbum() *NeteaseAlbum                                                { return &NeteaseAlbum{baseProvider{newHTTP()}} }
func (p *NeteaseAlbum) Name() string                                                { return "netease" }
func (p *NeteaseAlbum) SearchSongs(context.Context, string, string) ([]Song, error) { return nil, nil }
func (p *NeteaseAlbum) Lyrics(context.Context, Song) (string, error)                { return "", nil }
func (p *NeteaseAlbum) SearchAlbums(ctx context.Context, title, artist string) ([]AlbumCandidate, error) {
	endpoint := "https://music.163.com/api/search/get/web?" + q(map[string]string{"s": query(title, artist), "type": "10", "limit": "10", "offset": "0"})
	var resp struct {
		Result struct {
			Albums []struct {
				ID          int           `json:"id"`
				Name        string        `json:"name"`
				PicURL      string        `json:"picUrl"`
				PublishTime int64         `json:"publishTime"`
				Description string        `json:"description"`
				BriefDesc   string        `json:"briefDesc"`
				Company     string        `json:"company"`
				Size        int           `json:"size"`
				Artist      neteaseName   `json:"artist"`
				Artists     []neteaseName `json:"artists"`
			} `json:"albums"`
		} `json:"result"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA, "Referer": "https://music.163.com/"}, &resp); err != nil {
		return nil, err
	}
	out := []AlbumCandidate{}
	for _, it := range resp.Result.Albums {
		name := clean(it.Name)
		ar := clean(first(joinNames(it.Artists), it.Artist.Name))
		if !matchTitle(title, name) || !matchArtist(artist, ar) {
			continue
		}
		rel := formatMillisDate(it.PublishTime)
		desc := clean(first(it.Description, it.BriefDesc))
		if desc == "" && strings.TrimSpace(it.Company) != "" {
			desc = "唱片公司：" + strings.TrimSpace(it.Company)
		}
		id := strconv.Itoa(it.ID)
		out = append(out, AlbumCandidate{Source: p.Name(), ID: id, Title: name, Artist: ar, Cover: it.PicURL, ReleaseDate: rel, Year: parseYear(rel), Description: desc, TrackCount: it.Size, Link: "https://music.163.com/#/album?id=" + id})
	}
	return out, nil
}
func (p *NeteaseAlbum) AlbumInfo(ctx context.Context, id string) (AlbumInfo, error) {
	endpoint := "https://music.163.com/api/album/" + url.PathEscape(id)
	var resp struct {
		Album struct {
			ID          int         `json:"id"`
			Name        string      `json:"name"`
			PicURL      string      `json:"picUrl"`
			PublishTime int64       `json:"publishTime"`
			Description string      `json:"description"`
			BriefDesc   string      `json:"briefDesc"`
			Company     string      `json:"company"`
			Size        int         `json:"size"`
			Artist      neteaseName `json:"artist"`
		} `json:"album"`
		Songs []struct {
			Name    string        `json:"name"`
			DT      int           `json:"dt"`
			Ar      []neteaseName `json:"ar"`
			Artists []neteaseName `json:"artists"`
		} `json:"songs"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA, "Referer": "https://music.163.com/"}, &resp); err != nil {
		return AlbumInfo{}, err
	}
	rel := formatMillisDate(resp.Album.PublishTime)
	desc := clean(first(resp.Album.Description, resp.Album.BriefDesc))
	if desc == "" && strings.TrimSpace(resp.Album.Company) != "" {
		desc = "唱片公司：" + strings.TrimSpace(resp.Album.Company)
	}
	tracks := make([]Track, 0, len(resp.Songs))
	for idx, song := range resp.Songs {
		artist := joinNames(song.Ar)
		if artist == "" {
			artist = joinNames(song.Artists)
		}
		tracks = append(tracks, Track{Title: clean(song.Name), Artist: artist, DurationSec: song.DT / 1000, TrackNumber: idx + 1})
	}
	trackCount := resp.Album.Size
	if trackCount == 0 {
		trackCount = len(tracks)
	}
	return AlbumInfo{AlbumCandidate: AlbumCandidate{Source: p.Name(), ID: id, Title: clean(resp.Album.Name), Artist: clean(resp.Album.Artist.Name), Cover: resp.Album.PicURL, ReleaseDate: rel, Year: parseYear(rel), Description: desc, TrackCount: trackCount, Link: "https://music.163.com/#/album?id=" + id}, Tracks: tracks}, nil
}
func (p *NeteaseAlbum) SearchArtists(context.Context, string) ([]ArtistCandidate, error) {
	return nil, nil
}

func joinNames(items []neteaseName) string {
	names := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		name := clean(item.Name)
		if name != "" && !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	return strings.Join(names, " / ")
}

func formatMillisDate(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format("2006-01-02")
}

// LRCLIB: foreign/open synced lyrics. No album provider.
type LRCLib struct{ baseProvider }

func NewLRCLib() *LRCLib       { return &LRCLib{baseProvider{newHTTP()}} }
func (p *LRCLib) Name() string { return "lrclib" }
func (p *LRCLib) SearchSongs(ctx context.Context, title, artist string) ([]Song, error) {
	endpoint := "https://lrclib.net/api/search?" + q(map[string]string{"track_name": title, "artist_name": artist})
	var rows []struct {
		ID                               int `json:"id"`
		TrackName, ArtistName, AlbumName string
		Duration                         float64
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": "Lark Music Player (https://github.com/ca-x/lark)"}, &rows); err != nil {
		return nil, err
	}
	out := []Song{}
	for _, r := range rows {
		out = append(out, Song{Source: p.Name(), ID: strconv.Itoa(r.ID), Title: r.TrackName, Artist: r.ArtistName, Album: r.AlbumName, Duration: int(r.Duration)})
	}
	return FilterSongs(out, title, artist, 8), nil
}
func (p *LRCLib) Lyrics(ctx context.Context, song Song) (string, error) {
	var r struct {
		SyncedLyrics string `json:"syncedLyrics"`
		PlainLyrics  string `json:"plainLyrics"`
	}
	endpoint := "https://lrclib.net/api/get/" + url.PathEscape(song.ID)
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": "Lark Music Player (https://github.com/ca-x/lark)"}, &r); err != nil {
		return "", err
	}
	return trimLyrics(first(r.SyncedLyrics, r.PlainLyrics)), nil
}
func (p *LRCLib) SearchAlbums(context.Context, string, string) ([]AlbumCandidate, error) {
	return nil, nil
}
func (p *LRCLib) AlbumInfo(context.Context, string) (AlbumInfo, error)             { return AlbumInfo{}, nil }
func (p *LRCLib) SearchArtists(context.Context, string) ([]ArtistCandidate, error) { return nil, nil }

// Kuwo.
type Kuwo struct{ baseProvider }

func NewKuwo() *Kuwo         { return &Kuwo{baseProvider{newHTTP()}} }
func (p *Kuwo) Name() string { return "kuwo" }
func (p *Kuwo) SearchSongs(ctx context.Context, title, artist string) ([]Song, error) {
	endpoint := "http://www.kuwo.cn/search/searchMusicBykeyWord?" + q(map[string]string{"vipver": "1", "client": "kt", "ft": "music", "cluster": "0", "strategy": "2012", "encoding": "utf8", "rformat": "json", "mobi": "1", "issubtitle": "1", "show_copyright_off": "1", "pn": "0", "rn": "12", "all": query(title, artist)})
	body, err := p.get(ctx, endpoint, map[string]string{"User-Agent": defaultUA})
	if err != nil {
		return nil, err
	}
	var raw struct {
		AbsList []map[string]any `json:"abslist"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	out := []Song{}
	for _, m := range raw.AbsList {
		id := strings.TrimPrefix(fmt.Sprint(m["MUSICRID"]), "MUSIC_")
		dur, _ := strconv.Atoi(fmt.Sprint(m["DURATION"]))
		out = append(out, Song{Source: p.Name(), ID: id, Title: clean(fmt.Sprint(m["SONGNAME"])), Artist: clean(fmt.Sprint(m["ARTIST"])), Album: clean(fmt.Sprint(m["ALBUM"])), Cover: fmt.Sprint(m["hts_MVPIC"]), Duration: dur, Extra: map[string]string{"rid": id}})
	}
	return FilterSongs(out, title, artist, 8), nil
}
func (p *Kuwo) Lyrics(ctx context.Context, song Song) (string, error) {
	rid := first(song.Extra["rid"], song.ID)
	endpoint := "http://m.kuwo.cn/newh5/singles/songinfoandlrc?" + q(map[string]string{"musicId": rid, "httpsStatus": "1"})
	var resp struct {
		Data struct {
			Lrclist []struct {
				Time      string `json:"time"`
				LineLyric string `json:"lineLyric"`
			} `json:"lrclist"`
		} `json:"data"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA}, &resp); err != nil {
		return "", err
	}
	var sb strings.Builder
	for _, line := range resp.Data.Lrclist {
		sec, _ := strconv.ParseFloat(line.Time, 64)
		m := int(sec) / 60
		s := int(sec) % 60
		ms := int((sec - float64(int(sec))) * 100)
		sb.WriteString(fmt.Sprintf("[%02d:%02d.%02d]%s\n", m, s, ms, line.LineLyric))
	}
	return trimLyrics(sb.String()), nil
}
func (p *Kuwo) SearchAlbums(ctx context.Context, title, artist string) ([]AlbumCandidate, error) {
	endpoint := "http://search.kuwo.cn/r.s?" + q(map[string]string{"all": query(title, artist), "ft": "album", "itemset": "web_2013", "client": "kt", "pn": "0", "rn": "10", "rformat": "json", "encoding": "utf8"})
	var resp struct {
		AlbumList []map[string]any `json:"albumlist"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA}, &resp); err != nil {
		return nil, err
	}
	out := []AlbumCandidate{}
	for _, m := range resp.AlbumList {
		id := first(fmt.Sprint(m["albumid"]), fmt.Sprint(m["id"]))
		name := clean(fmt.Sprint(m["name"]))
		ar := clean(first(fmt.Sprint(m["aartist"]), fmt.Sprint(m["artist"])))
		if !matchTitle(title, name) || !matchArtist(artist, ar) {
			continue
		}
		cnt, _ := strconv.Atoi(fmt.Sprint(m["musiccnt"]))
		rel := strings.TrimSpace(fmt.Sprint(m["pub"]))
		out = append(out, AlbumCandidate{Source: p.Name(), ID: id, Title: name, Artist: ar, Cover: coverReplaceSize(first(fmt.Sprint(m["hts_img"]), fmt.Sprint(m["img"]))), ReleaseDate: rel, Year: parseYear(rel), Description: clean(fmt.Sprint(m["info"])), TrackCount: cnt, Link: "http://www.kuwo.cn/album_detail/" + id})
	}
	return out, nil
}
func (p *Kuwo) AlbumInfo(ctx context.Context, id string) (AlbumInfo, error) {
	return AlbumInfo{AlbumCandidate: AlbumCandidate{Source: p.Name(), ID: id}}, nil
}
func (p *Kuwo) SearchArtists(context.Context, string) ([]ArtistCandidate, error) { return nil, nil }

// Kugou.
type Kugou struct{ baseProvider }

func NewKugou() *Kugou        { return &Kugou{baseProvider{newHTTP()}} }
func (p *Kugou) Name() string { return "kugou" }
func (p *Kugou) SearchSongs(ctx context.Context, title, artist string) ([]Song, error) {
	endpoint := "http://songsearch.kugou.com/song_search_v2?" + q(map[string]string{"keyword": query(title, artist), "platform": "WebFilter", "format": "json", "page": "1", "pagesize": "12"})
	var resp struct {
		Data struct {
			Lists []struct {
				SongName, SingerName, AlbumName, AlbumID, FileHash, Image string
				Duration                                                  int
			} `json:"lists"`
		} `json:"data"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": mobileUA}, &resp); err != nil {
		return nil, err
	}
	out := []Song{}
	for _, it := range resp.Data.Lists {
		out = append(out, Song{Source: p.Name(), ID: it.FileHash, Title: clean(it.SongName), Artist: clean(it.SingerName), Album: clean(it.AlbumName), AlbumID: it.AlbumID, Cover: coverReplaceSize(it.Image), Duration: it.Duration, Extra: map[string]string{"hash": it.FileHash}})
	}
	return FilterSongs(out, title, artist, 8), nil
}
func (p *Kugou) Lyrics(ctx context.Context, song Song) (string, error) {
	hash := first(song.Extra["hash"], song.ID)
	var sr struct {
		Candidates []struct {
			ID        any    `json:"id"`
			AccessKey string `json:"accesskey"`
		} `json:"candidates"`
	}
	if err := p.getJSON(ctx, "http://krcs.kugou.com/search?"+q(map[string]string{"ver": "1", "client": "mobi", "duration": "", "hash": hash, "album_audio_id": ""}), map[string]string{"User-Agent": mobileUA, "Referer": "http://m.kugou.com"}, &sr); err != nil {
		return "", err
	}
	if len(sr.Candidates) == 0 {
		return "", nil
	}
	endpoint := fmt.Sprintf("http://lyrics.kugou.com/download?ver=1&client=pc&id=%v&accesskey=%s&fmt=lrc&charset=utf8", sr.Candidates[0].ID, url.QueryEscape(sr.Candidates[0].AccessKey))
	var dr struct {
		Content string `json:"content"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": mobileUA, "Referer": "http://m.kugou.com"}, &dr); err != nil {
		return "", err
	}
	data, err := base64.StdEncoding.DecodeString(dr.Content)
	if err != nil {
		return "", err
	}
	return trimLyrics(string(data)), nil
}
func (p *Kugou) SearchAlbums(ctx context.Context, title, artist string) ([]AlbumCandidate, error) {
	endpoint := "http://mobilecdn.kugou.com/api/v3/search/album?" + q(map[string]string{"keyword": query(title, artist), "format": "json", "page": "1", "pagesize": "10"})
	var resp struct {
		Data struct {
			Info []struct {
				AlbumID                                           int `json:"albumid"`
				AlbumName, SingerName, PublishTime, ImgURL, Intro string
				SongCount                                         int `json:"songcount"`
			} `json:"info"`
		} `json:"data"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": mobileUA}, &resp); err != nil {
		return nil, err
	}
	out := []AlbumCandidate{}
	for _, it := range resp.Data.Info {
		name, ar := clean(it.AlbumName), clean(it.SingerName)
		if !matchTitle(title, name) || !matchArtist(artist, ar) {
			continue
		}
		id := strconv.Itoa(it.AlbumID)
		out = append(out, AlbumCandidate{Source: p.Name(), ID: id, Title: name, Artist: ar, Cover: coverReplaceSize(it.ImgURL), ReleaseDate: it.PublishTime, Year: parseYear(it.PublishTime), Description: it.Intro, TrackCount: it.SongCount, Link: "https://www.kugou.com/album/" + id + ".html"})
	}
	return out, nil
}
func (p *Kugou) AlbumInfo(ctx context.Context, id string) (AlbumInfo, error) {
	return AlbumInfo{AlbumCandidate: AlbumCandidate{Source: p.Name(), ID: id}}, nil
}
func (p *Kugou) SearchArtists(context.Context, string) ([]ArtistCandidate, error) { return nil, nil }

// Migu.
type Migu struct{ baseProvider }

func NewMigu() *Migu         { return &Migu{baseProvider{newHTTP()}} }
func (p *Migu) Name() string { return "migu" }
func (p *Migu) SearchSongs(ctx context.Context, title, artist string) ([]Song, error) {
	endpoint := "http://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do?" + q(map[string]string{"ua": "Android_migu", "version": "5.0.1", "text": query(title, artist), "pageNo": "1", "pageSize": "12", "searchSwitch": `{"song":1,"album":0,"singer":0,"tagSong":0,"mvSong":0,"songlist":0,"bestShow":1}`})
	var resp struct {
		SongResultData struct {
			Result []map[string]any `json:"result"`
		} `json:"songResultData"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": mobileUA, "Referer": "http://music.migu.cn/"}, &resp); err != nil {
		return nil, err
	}
	out := []Song{}
	for _, m := range resp.SongResultData.Result {
		name := clean(first(fmt.Sprint(m["name"]), fmt.Sprint(m["songName"])))
		ar := clean(first(fmt.Sprint(m["singer"]), fmt.Sprint(m["singerName"])))
		id := first(fmt.Sprint(m["contentId"]), fmt.Sprint(m["copyrightId"]), fmt.Sprint(m["id"]))
		album := clean(first(fmt.Sprint(m["album"]), fmt.Sprint(m["albumName"])))
		out = append(out, Song{Source: p.Name(), ID: id, Title: name, Artist: ar, Album: album, Cover: pickMiguCover(m), Extra: map[string]string{"content_id": id}})
	}
	return FilterSongs(out, title, artist, 8), nil
}
func pickMiguCover(m map[string]any) string {
	for _, key := range []string{"imgItems", "albumImgs"} {
		if arr, ok := m[key].([]any); ok {
			for _, raw := range arr {
				if mm, ok := raw.(map[string]any); ok {
					if img := strings.TrimSpace(fmt.Sprint(mm["img"])); img != "" {
						return img
					}
				}
			}
		}
	}
	return ""
}
func (p *Migu) Lyrics(ctx context.Context, song Song) (string, error) {
	id := first(song.Extra["content_id"], song.ID)
	var resp struct {
		Resource []struct {
			LrcURL   string `json:"lrcUrl"`
			LyricURL string `json:"lyricUrl"`
		} `json:"resource"`
	}
	endpoint := "http://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?" + q(map[string]string{"resourceId": id, "resourceType": "2"})
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": mobileUA, "Referer": "http://music.migu.cn/"}, &resp); err != nil {
		return "", err
	}
	if len(resp.Resource) == 0 {
		return "", nil
	}
	lyricURL := first(resp.Resource[0].LrcURL, resp.Resource[0].LyricURL)
	if lyricURL == "" {
		return "", nil
	}
	lyricURL = strings.Replace(lyricURL, "http://", "https://", 1)
	body, err := p.get(ctx, lyricURL, map[string]string{"User-Agent": defaultUA, "Referer": "https://y.migu.cn/"})
	if err != nil {
		return "", err
	}
	return trimLyrics(string(body)), nil
}
func (p *Migu) SearchAlbums(ctx context.Context, title, artist string) ([]AlbumCandidate, error) {
	endpoint := "http://pd.musicapp.migu.cn/MIGUM2.0/v1.0/content/search_all.do?" + q(map[string]string{"ua": "Android_migu", "version": "5.0.1", "text": query(title, artist), "pageNo": "1", "pageSize": "10", "searchSwitch": `{"song":0,"album":1,"singer":0,"tagSong":0,"mvSong":0,"songlist":0,"bestShow":1}`})
	var resp struct {
		AlbumResultData struct {
			Result []struct {
				ID, Name, Singer, PublishDate, Desc string
				ImgItems                            []struct {
					Img string `json:"img"`
				} `json:"imgItems"`
			} `json:"result"`
		} `json:"albumResultData"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": mobileUA, "Referer": "http://music.migu.cn/"}, &resp); err != nil {
		return nil, err
	}
	out := []AlbumCandidate{}
	for _, it := range resp.AlbumResultData.Result {
		name, ar := clean(it.Name), clean(it.Singer)
		if !matchTitle(title, name) || !matchArtist(artist, ar) {
			continue
		}
		cover := ""
		if len(it.ImgItems) > 0 {
			cover = it.ImgItems[0].Img
		}
		out = append(out, AlbumCandidate{Source: p.Name(), ID: it.ID, Title: name, Artist: ar, Cover: cover, ReleaseDate: it.PublishDate, Year: parseYear(it.PublishDate), Description: it.Desc, Link: "https://music.migu.cn/v3/music/album/" + it.ID})
	}
	return out, nil
}
func (p *Migu) AlbumInfo(ctx context.Context, id string) (AlbumInfo, error) {
	return AlbumInfo{AlbumCandidate: AlbumCandidate{Source: p.Name(), ID: id}}, nil
}
func (p *Migu) SearchArtists(context.Context, string) ([]ArtistCandidate, error) { return nil, nil }

// Qianqian.
type Qianqian struct{ baseProvider }

func NewQianqian() *Qianqian     { return &Qianqian{baseProvider{newHTTP()}} }
func (p *Qianqian) Name() string { return "qianqian" }

const qianqianAppID = "16073360"
const qianqianSecret = "0b50b02fd0d73a9c4c8c3a781c30845f"

func signQQian(v url.Values) {
	v.Set("timestamp", strconv.FormatInt(time.Now().Unix(), 10))
	keys := make([]string, 0, len(v))
	for k := range v {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(v.Get(k))
	}
	b.WriteString(qianqianSecret)
	h := md5.Sum([]byte(b.String()))
	v.Set("sign", hex.EncodeToString(h[:]))
}
func (p *Qianqian) SearchSongs(ctx context.Context, title, artist string) ([]Song, error) {
	v := url.Values{"word": {query(title, artist)}, "type": {"1"}, "pageNo": {"1"}, "pageSize": {"12"}, "appid": {qianqianAppID}}
	signQQian(v)
	var resp struct {
		Data struct {
			TypeTrack []struct {
				TSID, Title, AlbumTitle, AlbumAssetCode, Pic string
				Duration                                     int
				Lyric                                        string
				Artist                                       []struct {
					Name       string `json:"name"`
					ArtistType int    `json:"artistType"`
				} `json:"artist"`
			} `json:"typeTrack"`
		} `json:"data"`
	}
	if err := p.getJSON(ctx, "https://music.91q.com/v1/search?"+v.Encode(), map[string]string{"User-Agent": defaultUA, "Referer": "https://music.91q.com/player"}, &resp); err != nil {
		return nil, err
	}
	out := []Song{}
	for _, it := range resp.Data.TypeTrack {
		ar := joinQQianArtists(it.Artist)
		out = append(out, Song{Source: p.Name(), ID: it.TSID, Title: clean(it.Title), Artist: ar, Album: clean(it.AlbumTitle), AlbumID: it.AlbumAssetCode, Cover: it.Pic, Duration: it.Duration, Extra: map[string]string{"tsid": it.TSID}})
	}
	return FilterSongs(out, title, artist, 8), nil
}
func joinQQianArtists(a []struct {
	Name       string `json:"name"`
	ArtistType int    `json:"artistType"`
}) string {
	out := []string{}
	seen := map[string]bool{}
	for _, it := range a {
		n := clean(it.Name)
		if n != "" && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	return strings.Join(out, " / ")
}
func (p *Qianqian) Lyrics(ctx context.Context, song Song) (string, error) {
	tsid := first(song.Extra["tsid"], song.ID)
	v := url.Values{"TSID": {tsid}, "appid": {qianqianAppID}}
	signQQian(v)
	var resp struct {
		Data []struct {
			Lyric string `json:"lyric"`
		} `json:"data"`
	}
	if err := p.getJSON(ctx, "https://music.91q.com/v1/song/info?"+v.Encode(), map[string]string{"User-Agent": defaultUA, "Referer": "https://music.91q.com/player"}, &resp); err != nil {
		return "", err
	}
	if len(resp.Data) == 0 || resp.Data[0].Lyric == "" {
		return "", nil
	}
	body, err := p.get(ctx, resp.Data[0].Lyric, map[string]string{"User-Agent": defaultUA})
	if err != nil {
		return "", err
	}
	return trimLyrics(string(body)), nil
}
func (p *Qianqian) SearchAlbums(ctx context.Context, title, artist string) ([]AlbumCandidate, error) {
	v := url.Values{"word": {query(title, artist)}, "type": {"3"}, "pageNo": {"1"}, "pageSize": {"10"}, "appid": {qianqianAppID}}
	signQQian(v)
	var resp struct {
		Data struct {
			TypeAlbum []struct {
				AlbumAssetCode, Title, Pic, Introduce, ReleaseDate string
				Artist                                             []struct {
					Name       string `json:"name"`
					ArtistType int    `json:"artistType"`
				} `json:"artist"`
				TrackList []any `json:"trackList"`
			} `json:"typeAlbum"`
		} `json:"data"`
	}
	if err := p.getJSON(ctx, "https://music.91q.com/v1/search?"+v.Encode(), map[string]string{"User-Agent": defaultUA, "Referer": "https://music.91q.com/player"}, &resp); err != nil {
		return nil, err
	}
	out := []AlbumCandidate{}
	for _, it := range resp.Data.TypeAlbum {
		ar := joinQQianArtists(it.Artist)
		name := clean(it.Title)
		if !matchTitle(title, name) || !matchArtist(artist, ar) {
			continue
		}
		out = append(out, AlbumCandidate{Source: p.Name(), ID: it.AlbumAssetCode, Title: name, Artist: ar, Cover: it.Pic, ReleaseDate: it.ReleaseDate, Year: parseYear(it.ReleaseDate), Description: it.Introduce, TrackCount: len(it.TrackList), Link: "https://music.91q.com/album/" + it.AlbumAssetCode})
	}
	return out, nil
}
func (p *Qianqian) AlbumInfo(ctx context.Context, id string) (AlbumInfo, error) {
	return AlbumInfo{AlbumCandidate: AlbumCandidate{Source: p.Name(), ID: id}}, nil
}
func (p *Qianqian) SearchArtists(context.Context, string) ([]ArtistCandidate, error) { return nil, nil }

// Soda, Joox, Fivesing, Jamendo, iTunes and Last.fm are implemented in extras.go.
