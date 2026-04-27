package online

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Soda / Qishui.
type Soda struct{ baseProvider }

func NewSoda() *Soda         { return &Soda{baseProvider{newHTTP()}} }
func (p *Soda) Name() string { return "soda" }
func sodaCover(urls []string, uri string) string {
	if len(urls) > 0 && uri != "" {
		return urls[0] + uri + "~c5_500x500.jpg"
	}
	return ""
}
func (p *Soda) SearchSongs(ctx context.Context, title, artist string) ([]Song, error) {
	endpoint := "https://api.qishui.com/luna/pc/search/track?" + q(map[string]string{"q": query(title, artist), "cursor": "0", "search_method": "input", "aid": "386088", "device_platform": "web", "channel": "pc_web"})
	var resp struct {
		ResultGroups []struct {
			Data []struct {
				Entity struct {
					Track struct {
						ID, Name string
						Duration int
						Artists  []struct{ Name string }
						Album    struct {
							Name     string
							URLCover struct {
								Urls []string `json:"urls"`
								Uri  string   `json:"uri"`
							} `json:"url_cover"`
						}
					} `json:"track"`
				} `json:"entity"`
			} `json:"data"`
		} `json:"result_groups"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA}, &resp); err != nil {
		return nil, err
	}
	out := []Song{}
	if len(resp.ResultGroups) > 0 {
		for _, it := range resp.ResultGroups[0].Data {
			tr := it.Entity.Track
			names := []string{}
			for _, a := range tr.Artists {
				names = append(names, a.Name)
			}
			out = append(out, Song{Source: p.Name(), ID: tr.ID, Title: clean(tr.Name), Artist: strings.Join(names, " / "), Album: clean(tr.Album.Name), Cover: sodaCover(tr.Album.URLCover.Urls, tr.Album.URLCover.Uri), Duration: secondsFromMS(tr.Duration), Extra: map[string]string{"track_id": tr.ID}})
		}
	}
	return FilterSongs(out, title, artist, 8), nil
}
func (p *Soda) Lyrics(ctx context.Context, song Song) (string, error) {
	id := first(song.Extra["track_id"], song.ID)
	var resp struct {
		Lyric struct {
			Content string `json:"content"`
		} `json:"lyric"`
	}
	endpoint := "https://api.qishui.com/luna/pc/track_v2?" + q(map[string]string{"track_id": id, "media_type": "track", "aid": "386088", "device_platform": "web", "channel": "pc_web"})
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA}, &resp); err != nil {
		return "", err
	}
	return trimLyrics(resp.Lyric.Content), nil
}
func (p *Soda) SearchAlbums(ctx context.Context, title, artist string) ([]AlbumCandidate, error) {
	endpoint := "https://api.qishui.com/luna/pc/search/album?" + q(map[string]string{"q": query(title, artist), "cursor": "0", "search_method": "input", "aid": "386088", "device_platform": "web", "channel": "pc_web"})
	var resp struct {
		ResultGroups []struct {
			Data []struct {
				Entity struct {
					Album struct {
						ID, Name, Company string
						CountTracks       int   `json:"count_tracks"`
						ReleaseDate       int64 `json:"release_date"`
						Artists           []struct{ Name string }
						URLCover          struct {
							Urls []string `json:"urls"`
							Uri  string   `json:"uri"`
						} `json:"url_cover"`
					} `json:"album"`
				} `json:"entity"`
			} `json:"data"`
		} `json:"result_groups"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA}, &resp); err != nil {
		return nil, err
	}
	out := []AlbumCandidate{}
	if len(resp.ResultGroups) > 0 {
		for _, it := range resp.ResultGroups[0].Data {
			al := it.Entity.Album
			names := []string{}
			for _, a := range al.Artists {
				names = append(names, a.Name)
			}
			ar := strings.Join(names, " / ")
			if !matchTitle(title, al.Name) || !matchArtist(artist, ar) {
				continue
			}
			year := unixMillisYear(al.ReleaseDate)
			out = append(out, AlbumCandidate{Source: p.Name(), ID: al.ID, Title: clean(al.Name), Artist: ar, Cover: sodaCover(al.URLCover.Urls, al.URLCover.Uri), Year: year, ReleaseDate: strconv.Itoa(year), TrackCount: al.CountTracks, Description: al.Company, Link: "https://www.qishui.com/album/" + al.ID})
		}
	}
	return out, nil
}
func (p *Soda) AlbumInfo(context.Context, string) (AlbumInfo, error)             { return AlbumInfo{}, nil }
func (p *Soda) SearchArtists(context.Context, string) ([]ArtistCandidate, error) { return nil, nil }

// Joox.
type Joox struct{ baseProvider }

func NewJoox() *Joox         { return &Joox{baseProvider{newHTTP()}} }
func (p *Joox) Name() string { return "joox" }
func jooxImage(items []struct {
	URL  string `json:"url"`
	Type string `json:"type"`
}) string {
	for _, it := range items {
		if it.URL != "" {
			return it.URL
		}
	}
	return ""
}
func (p *Joox) SearchSongs(ctx context.Context, title, artist string) ([]Song, error) {
	endpoint := "https://cache.api.joox.com/openjoox/v3/search?" + q(map[string]string{"country": "sg", "lang": "zh_cn", "keyword": query(title, artist)})
	var resp struct {
		SectionList []struct {
			ItemList []struct {
				Song struct {
					ID, Name  string
					Duration  int
					AlbumName string `json:"album_name"`
					Images    []struct {
						URL  string `json:"url"`
						Type string `json:"type"`
					}
					ArtistList []struct {
						Name string `json:"name"`
					} `json:"artist_list"`
				} `json:"song"`
			} `json:"item_list"`
		} `json:"section_list"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA, "X-Forwarded-For": "8.8.8.8"}, &resp); err != nil {
		return nil, err
	}
	out := []Song{}
	for _, sec := range resp.SectionList {
		for _, it := range sec.ItemList {
			s := it.Song
			if s.ID == "" {
				continue
			}
			names := []string{}
			for _, a := range s.ArtistList {
				names = append(names, a.Name)
			}
			out = append(out, Song{Source: p.Name(), ID: s.ID, Title: clean(s.Name), Artist: strings.Join(names, " / "), Album: clean(s.AlbumName), Cover: jooxImage(s.Images), Duration: s.Duration, Extra: map[string]string{"songid": s.ID}})
		}
	}
	return FilterSongs(out, title, artist, 8), nil
}
func (p *Joox) Lyrics(ctx context.Context, song Song) (string, error) {
	id := first(song.Extra["songid"], song.ID)
	body, err := p.get(ctx, "https://api.joox.com/web-fcgi-bin/web_lyric?"+q(map[string]string{"musicid": id, "country": "sg", "lang": "zh_cn"}), map[string]string{"User-Agent": defaultUA, "X-Forwarded-For": "8.8.8.8"})
	if err != nil {
		return "", err
	}
	text := string(body)
	text = strings.TrimPrefix(strings.TrimSuffix(text, ")"), "MusicJsonCallback(")
	var resp struct {
		Lyric string `json:"lyric"`
	}
	if err := json.Unmarshal([]byte(text), &resp); err != nil {
		return "", err
	}
	return trimLyrics(resp.Lyric), nil
}
func (p *Joox) SearchAlbums(ctx context.Context, title, artist string) ([]AlbumCandidate, error) {
	return nil, nil
}
func (p *Joox) AlbumInfo(context.Context, string) (AlbumInfo, error)             { return AlbumInfo{}, nil }
func (p *Joox) SearchArtists(context.Context, string) ([]ArtistCandidate, error) { return nil, nil }

// Fivesing.
type Fivesing struct{ baseProvider }

func NewFivesing() *Fivesing     { return &Fivesing{baseProvider{newHTTP()}} }
func (p *Fivesing) Name() string { return "fivesing" }
func (p *Fivesing) SearchSongs(ctx context.Context, title, artist string) ([]Song, error) {
	endpoint := "http://search.5sing.kugou.com/home/json?" + q(map[string]string{"keyword": query(title, artist), "sort": "1", "page": "1", "filter": "0", "type": "0"})
	var resp struct {
		List []struct {
			SongID                      int64 `json:"songId"`
			SongName, Singer, TypeEname string
			SongSize                    int64 `json:"songSize"`
		} `json:"list"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA}, &resp); err != nil {
		return nil, err
	}
	out := []Song{}
	for _, it := range resp.List {
		id := fmt.Sprintf("%d|%s", it.SongID, it.TypeEname)
		out = append(out, Song{Source: p.Name(), ID: id, Title: clean(it.SongName), Artist: clean(it.Singer), Extra: map[string]string{"songid": strconv.FormatInt(it.SongID, 10), "songtype": it.TypeEname}})
	}
	return FilterSongs(out, title, artist, 8), nil
}
func (p *Fivesing) Lyrics(ctx context.Context, song Song) (string, error) {
	id := first(song.Extra["songid"], strings.Split(song.ID, "|")[0])
	typ := first(song.Extra["songtype"], "yc")
	var resp struct {
		Data struct {
			Lrc    string `json:"lrc"`
			Lyrics string `json:"lyrics"`
		} `json:"data"`
	}
	endpoint := "http://service.5sing.kugou.com/song/getsongurl?" + q(map[string]string{"songid": id, "songtype": typ, "from": "web"})
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA}, &resp); err != nil {
		return "", err
	}
	return trimLyrics(first(resp.Data.Lrc, resp.Data.Lyrics)), nil
}
func (p *Fivesing) SearchAlbums(context.Context, string, string) ([]AlbumCandidate, error) {
	return nil, nil
}
func (p *Fivesing) AlbumInfo(context.Context, string) (AlbumInfo, error)             { return AlbumInfo{}, nil }
func (p *Fivesing) SearchArtists(context.Context, string) ([]ArtistCandidate, error) { return nil, nil }

// Jamendo: useful foreign album cover metadata, no lyrics.
type Jamendo struct{ baseProvider }

func NewJamendo() *Jamendo                                                     { return &Jamendo{baseProvider{newHTTP()}} }
func (p *Jamendo) Name() string                                                { return "jamendo" }
func (p *Jamendo) SearchSongs(context.Context, string, string) ([]Song, error) { return nil, nil }
func (p *Jamendo) Lyrics(context.Context, Song) (string, error)                { return "", nil }
func (p *Jamendo) SearchAlbums(ctx context.Context, title, artist string) ([]AlbumCandidate, error) {
	endpoint := "https://api.jamendo.com/v3.0/albums/?" + q(map[string]string{"client_id": "9873ff31", "format": "json", "limit": "10", "namesearch": title, "artist_name": artist, "imagesize": "600"})
	var resp struct {
		Results []struct {
			ID, Name, ArtistName, Image, ReleaseDate string `json:"id"`
			Tracks                                   []any  `json:"tracks"`
		} `json:"results"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA}, &resp); err != nil {
		return nil, err
	}
	out := []AlbumCandidate{}
	for _, it := range resp.Results {
		if !matchTitle(title, it.Name) || !matchArtist(artist, it.ArtistName) {
			continue
		}
		out = append(out, AlbumCandidate{Source: p.Name(), ID: it.ID, Title: it.Name, Artist: it.ArtistName, Cover: it.Image, ReleaseDate: it.ReleaseDate, Year: parseYear(it.ReleaseDate), TrackCount: len(it.Tracks), Link: "https://www.jamendo.com/album/" + it.ID})
	}
	return out, nil
}
func (p *Jamendo) AlbumInfo(context.Context, string) (AlbumInfo, error)             { return AlbumInfo{}, nil }
func (p *Jamendo) SearchArtists(context.Context, string) ([]ArtistCandidate, error) { return nil, nil }

// iTunes Search API: foreign album covers and artist IDs without API key.
type ITunes struct{ baseProvider }

func NewITunes() *ITunes                                                      { return &ITunes{baseProvider{newHTTP()}} }
func (p *ITunes) Name() string                                                { return "itunes" }
func (p *ITunes) SearchSongs(context.Context, string, string) ([]Song, error) { return nil, nil }
func (p *ITunes) Lyrics(context.Context, Song) (string, error)                { return "", nil }
func (p *ITunes) SearchAlbums(ctx context.Context, title, artist string) ([]AlbumCandidate, error) {
	endpoint := "https://itunes.apple.com/search?" + q(map[string]string{"term": query(title, artist), "entity": "album", "limit": "10"})
	var resp struct {
		Results []struct {
			CollectionID                                                              int    `json:"collectionId"`
			CollectionName, ArtistName, ArtworkURL100, ReleaseDate, CollectionViewURL string `json:"collectionName"`
			TrackCount                                                                int    `json:"trackCount"`
		} `json:"results"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA}, &resp); err != nil {
		return nil, err
	}
	out := []AlbumCandidate{}
	for _, it := range resp.Results {
		if !matchTitle(title, it.CollectionName) || !matchArtist(artist, it.ArtistName) {
			continue
		}
		cover := strings.Replace(it.ArtworkURL100, "100x100bb", "600x600bb", 1)
		out = append(out, AlbumCandidate{Source: p.Name(), ID: strconv.Itoa(it.CollectionID), Title: it.CollectionName, Artist: it.ArtistName, Cover: cover, ReleaseDate: it.ReleaseDate, Year: parseYear(it.ReleaseDate), TrackCount: it.TrackCount, Link: it.CollectionViewURL})
	}
	return out, nil
}
func (p *ITunes) AlbumInfo(context.Context, string) (AlbumInfo, error) { return AlbumInfo{}, nil }
func (p *ITunes) SearchArtists(ctx context.Context, name string) ([]ArtistCandidate, error) {
	endpoint := "https://itunes.apple.com/search?" + q(map[string]string{"term": name, "entity": "musicArtist", "limit": "5"})
	var resp struct {
		Results []struct {
			ArtistID                  int    `json:"artistId"`
			ArtistName, ArtistLinkURL string `json:"artistName"`
		} `json:"results"`
	}
	if err := p.getJSON(ctx, endpoint, map[string]string{"User-Agent": defaultUA}, &resp); err != nil {
		return nil, err
	}
	out := []ArtistCandidate{}
	for _, it := range resp.Results {
		if !matchArtist(name, it.ArtistName) {
			continue
		}
		out = append(out, ArtistCandidate{Source: p.Name(), ID: strconv.Itoa(it.ArtistID), Name: it.ArtistName, Link: it.ArtistLinkURL})
	}
	return out, nil
}

// LastFM disabled unless API is available in env in future. Kept as a channel slot.
type LastFM struct{ baseProvider }

func NewLastFM() *LastFM                                                      { return &LastFM{baseProvider{newHTTP()}} }
func (p *LastFM) Name() string                                                { return "lastfm" }
func (p *LastFM) SearchSongs(context.Context, string, string) ([]Song, error) { return nil, nil }
func (p *LastFM) Lyrics(context.Context, Song) (string, error)                { return "", nil }
func (p *LastFM) SearchAlbums(context.Context, string, string) ([]AlbumCandidate, error) {
	return nil, nil
}
func (p *LastFM) AlbumInfo(context.Context, string) (AlbumInfo, error)             { return AlbumInfo{}, nil }
func (p *LastFM) SearchArtists(context.Context, string) ([]ArtistCandidate, error) { return nil, nil }

// Bilibili is a music-lib channel but does not expose useful lyrics/album metadata for Lark's use-case.
var _ = regexp.MustCompile
var _ = url.QueryEscape
