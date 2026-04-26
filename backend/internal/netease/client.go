package netease

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	http *http.Client
}

func New() *Client {
	return &Client{http: &http.Client{Timeout: 12 * time.Second}}
}

type songDetailResponse struct {
	Songs []struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"songs"`
	Code int `json:"code"`
}

type searchArtist struct {
	Name string `json:"name"`
}

type searchSong struct {
	ID      int            `json:"id"`
	Name    string         `json:"name"`
	Artists []searchArtist `json:"artists"`
}

type searchResponse struct {
	Code   int `json:"code"`
	Result struct {
		Songs []searchSong `json:"songs"`
	} `json:"result"`
}

type lyricLine struct {
	Lyric string `json:"lyric"`
}

type lyricsResponse struct {
	Lyric       string     `json:"lyric"`
	Lrc         *lyricLine `json:"lrc"`
	Tlyric      *lyricLine `json:"tlyric"`
	Romalrc     *lyricLine `json:"romalrc"`
	Klyric      *lyricLine `json:"klyric"`
	Yrc         *lyricLine `json:"yrc"`
	Nolyric     bool       `json:"nolyric"`
	Uncollected bool       `json:"uncollected"`
	Code        int        `json:"code"`
}

func (c *Client) SongExists(ctx context.Context, id string) (bool, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return false, nil
	}
	urls := []string{
		fmt.Sprintf("https://music.163.com/api/song/detail/?id=%s&ids=%s", id, id),
		fmt.Sprintf("https://music.163.com/api/song/detail/?id=%s&ids=%%5B%s%%5D", id, id),
	}
	var lastErr error
	for _, url := range urls {
		var resp songDetailResponse
		if err := c.getJSON(ctx, url, &resp); err != nil {
			lastErr = err
			continue
		}
		if len(resp.Songs) > 0 {
			return true, nil
		}
	}
	return false, lastErr
}

func (c *Client) SearchSongID(ctx context.Context, title, artist string) (string, error) {
	title = strings.TrimSpace(title)
	artist = strings.TrimSpace(artist)
	if title == "" {
		return "", nil
	}
	queries := []string{strings.TrimSpace(title + " " + artist), title}
	for _, query := range queries {
		if query == "" {
			continue
		}
		url := "https://music.163.com/api/search/get/web?s=" + url.QueryEscape(query) + "&type=1&limit=8&offset=0"
		var resp searchResponse
		if err := c.getJSON(ctx, url, &resp); err != nil {
			continue
		}
		for _, song := range resp.Result.Songs {
			if !sameTitle(title, song.Name) {
				continue
			}
			if artist == "" || artistsContain(song.Artists, artist) {
				return fmt.Sprint(song.ID), nil
			}
		}
		if artist == "" && len(resp.Result.Songs) > 0 {
			return fmt.Sprint(resp.Result.Songs[0].ID), nil
		}
	}
	return "", nil
}

func (c *Client) Lyrics(ctx context.Context, id string) (string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", nil
	}
	// 163MusicLyrics uses the encrypted weapi endpoint to request original,
	// translated, transliterated and word-level lyrics. For a server-side web app
	// we first try NetEase's compatible public lyric endpoint with the same flags,
	// then fall back to the older /api/song/media endpoint from the product brief.
	primary := fmt.Sprintf("https://music.163.com/api/song/lyric?id=%s&lv=-1&kv=-1&tv=-1&rv=-1&yv=-1&ytv=-1&yrv=-1", id)
	var resp lyricsResponse
	if err := c.getJSON(ctx, primary, &resp); err == nil {
		if lyric := composeLyrics(resp); strings.TrimSpace(lyric) != "" {
			return lyric, nil
		}
	}
	fallback := fmt.Sprintf("https://music.163.com/api/song/media?id=%s", id)
	resp = lyricsResponse{}
	if err := c.getJSON(ctx, fallback, &resp); err != nil {
		return "", err
	}
	return strings.TrimSpace(resp.Lyric), nil
}

func composeLyrics(resp lyricsResponse) string {
	parts := make([]string, 0, 3)
	if resp.Lrc != nil && strings.TrimSpace(resp.Lrc.Lyric) != "" {
		parts = append(parts, strings.TrimSpace(resp.Lrc.Lyric))
	}
	if resp.Tlyric != nil && strings.TrimSpace(resp.Tlyric.Lyric) != "" {
		parts = append(parts, "\n[translation]\n"+strings.TrimSpace(resp.Tlyric.Lyric))
	}
	if resp.Romalrc != nil && strings.TrimSpace(resp.Romalrc.Lyric) != "" {
		parts = append(parts, "\n[transliteration]\n"+strings.TrimSpace(resp.Romalrc.Lyric))
	}
	if len(parts) == 0 && resp.Yrc != nil && strings.TrimSpace(resp.Yrc.Lyric) != "" {
		parts = append(parts, strings.TrimSpace(resp.Yrc.Lyric))
	}
	if len(parts) == 0 && strings.TrimSpace(resp.Lyric) != "" {
		parts = append(parts, strings.TrimSpace(resp.Lyric))
	}
	return strings.Join(parts, "\n")
}

func (c *Client) getJSON(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 Lark Music Player")
	req.Header.Set("Referer", "https://music.163.com/")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("netease status %d", res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

func sameTitle(a, b string) bool {
	a = normalizeSongText(a)
	b = normalizeSongText(b)
	return a == b || strings.Contains(b, a) || strings.Contains(a, b)
}

func artistsContain(artists []searchArtist, artist string) bool {
	target := normalizeSongText(artist)
	for _, item := range artists {
		name := normalizeSongText(item.Name)
		if name == target || strings.Contains(name, target) || strings.Contains(target, name) {
			return true
		}
	}
	return false
}

func normalizeSongText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	for _, token := range []string{"（", "(", "[", "【"} {
		if idx := strings.Index(value, token); idx >= 0 {
			value = value[:idx]
		}
	}
	value = strings.NewReplacer(" ", "", "-", "", "_", "", "·", "", "・", "").Replace(value)
	return strings.TrimSpace(value)
}
