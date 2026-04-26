package qqmusic

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"lark/backend/internal/models"
)

type Client struct {
	http *http.Client
}

func New() *Client {
	return &Client{http: &http.Client{Timeout: 12 * time.Second}}
}

type searchRequest struct {
	Req searchReq `json:"req_1"`
}

type searchReq struct {
	Method string      `json:"method"`
	Module string      `json:"module"`
	Param  searchParam `json:"param"`
}

type searchParam struct {
	NumPerPage string `json:"num_per_page"`
	PageNum    string `json:"page_num"`
	Query      string `json:"query"`
	SearchType int    `json:"search_type"`
}

type searchResponse struct {
	Code int `json:"code"`
	Req  struct {
		Code int `json:"code"`
		Data struct {
			Code int `json:"code"`
			Body struct {
				Song struct {
					List []searchSong `json:"list"`
				} `json:"song"`
			} `json:"body"`
		} `json:"data"`
	} `json:"req_1"`
}

type searchSong struct {
	ID     int    `json:"id"`
	Mid    string `json:"mid"`
	Name   string `json:"name"`
	Title  string `json:"title"`
	Singer []struct {
		Name string `json:"name"`
	} `json:"singer"`
}

type lyricResponse struct {
	RetCode int    `json:"retcode"`
	Code    int    `json:"code"`
	SubCode int    `json:"subcode"`
	Lyric   string `json:"lyric"`
	Trans   string `json:"trans"`
}

func (c *Client) SearchCandidates(ctx context.Context, title, artist string) ([]models.LyricCandidate, error) {
	title = strings.TrimSpace(title)
	artist = strings.TrimSpace(artist)
	if title == "" {
		return nil, nil
	}
	seen := map[string]bool{}
	out := []models.LyricCandidate{}
	queries := []string{strings.TrimSpace(title + " " + artist), title}
	for _, query := range queries {
		if query == "" {
			continue
		}
		resp, err := c.search(ctx, query)
		if err != nil {
			continue
		}
		for _, item := range resp.Req.Data.Body.Song.List {
			name := item.Title
			if strings.TrimSpace(name) == "" {
				name = item.Name
			}
			id := strings.TrimSpace(item.Mid)
			if id == "" {
				id = fmt.Sprint(item.ID)
			}
			if id == "" || seen[id] {
				continue
			}
			if !sameTitle(title, name) && artist != "" && !singersContain(item.Singer, artist) {
				continue
			}
			seen[id] = true
			out = append(out, models.LyricCandidate{ID: id, Source: "qq", Title: name, Artist: joinSingers(item.Singer)})
		}
	}
	return out, nil
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
		resp, err := c.search(ctx, query)
		if err != nil {
			continue
		}
		for _, item := range resp.Req.Data.Body.Song.List {
			name := item.Title
			if strings.TrimSpace(name) == "" {
				name = item.Name
			}
			if !sameTitle(title, name) {
				continue
			}
			if artist == "" || singersContain(item.Singer, artist) {
				return item.Mid, nil
			}
		}
		if artist == "" && len(resp.Req.Data.Body.Song.List) > 0 {
			return resp.Req.Data.Body.Song.List[0].Mid, nil
		}
	}
	return "", nil
}

func (c *Client) Lyrics(ctx context.Context, songMid string) (string, error) {
	songMid = strings.TrimSpace(songMid)
	if songMid == "" {
		return "", nil
	}
	params := url.Values{}
	params.Set("songmid", songMid)
	params.Set("format", "json")
	params.Set("nobase64", "1")
	params.Set("g_tk", "5381")
	endpoint := "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?" + params.Encode()
	var resp lyricResponse
	if err := c.getJSON(ctx, endpoint, &resp); err != nil {
		return "", err
	}
	if resp.Code != 0 || resp.RetCode != 0 {
		return "", nil
	}
	parts := []string{}
	if strings.TrimSpace(resp.Lyric) != "" {
		parts = append(parts, strings.TrimSpace(resp.Lyric))
	}
	if strings.TrimSpace(resp.Trans) != "" {
		parts = append(parts, "\n[translation]\n"+strings.TrimSpace(resp.Trans))
	}
	return strings.Join(parts, "\n"), nil
}

func (c *Client) search(ctx context.Context, query string) (searchResponse, error) {
	payload := searchRequest{Req: searchReq{Method: "DoSearchForQQMusicDesktop", Module: "music.search.SearchCgiService", Param: searchParam{NumPerPage: "8", PageNum: "1", Query: query, SearchType: 0}}}
	body, err := json.Marshal(payload)
	if err != nil {
		return searchResponse{}, err
	}
	var resp searchResponse
	if err := c.postJSON(ctx, "https://u.y.qq.com/cgi-bin/musicu.fcg", body, &resp); err != nil {
		return searchResponse{}, err
	}
	return resp, nil
}

func (c *Client) postJSON(ctx context.Context, endpoint string, body []byte, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

func (c *Client) getJSON(ctx context.Context, endpoint string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	return c.do(req, out)
}

func (c *Client) do(req *http.Request, out any) error {
	req.Header.Set("User-Agent", "Mozilla/5.0 Lark Music Player")
	req.Header.Set("Referer", "https://y.qq.com/")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("online lyric status %d", res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

func sameTitle(a, b string) bool {
	a = normalizeSongText(a)
	b = normalizeSongText(b)
	return a == b || strings.Contains(b, a) || strings.Contains(a, b)
}

func joinSingers(singers []struct {
	Name string `json:"name"`
}) string {
	names := make([]string, 0, len(singers))
	for _, item := range singers {
		if strings.TrimSpace(item.Name) != "" {
			names = append(names, strings.TrimSpace(item.Name))
		}
	}
	return strings.Join(names, " / ")
}

func singersContain(singers []struct {
	Name string `json:"name"`
}, artist string) bool {
	target := normalizeSongText(artist)
	for _, item := range singers {
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
