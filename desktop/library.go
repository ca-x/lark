package main

import (
	"context"
	"time"

	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
)

type Song struct {
	ID                    int64   `json:"id"`
	Title                 string  `json:"title"`
	Artist                string  `json:"artist"`
	ArtistID              int64   `json:"artist_id"`
	Album                 string  `json:"album"`
	AlbumID               int64   `json:"album_id"`
	Format                string  `json:"format"`
	DurationSeconds       float64 `json:"duration_seconds"`
	Year                  int32   `json:"year"`
	Favorite              bool    `json:"favorite"`
	HasLyrics             bool    `json:"has_lyrics"`
	CoverVersion          int64   `json:"cover_version"`
	ResumePositionSeconds float64 `json:"resume_position_seconds"`
	Mime                  string  `json:"mime"`
}

type Artist struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	SongCount  int32  `json:"song_count"`
	AlbumCount int32  `json:"album_count"`
	Favorite   bool   `json:"favorite"`
}

type Album struct {
	ID           int64  `json:"id"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	ArtistID     int64  `json:"artist_id"`
	Year         int32  `json:"year"`
	SongCount    int32  `json:"song_count"`
	Favorite     bool   `json:"favorite"`
	CoverVersion int64  `json:"cover_version"`
}

type SongPage struct {
	Items  []Song `json:"items"`
	Total  int32  `json:"total"`
	Limit  int32  `json:"limit"`
	Offset int32  `json:"offset"`
}

type ArtistPage struct {
	Items  []Artist `json:"items"`
	Total  int32    `json:"total"`
	Limit  int32    `json:"limit"`
	Offset int32    `json:"offset"`
}

type AlbumPage struct {
	Items  []Album `json:"items"`
	Total  int32   `json:"total"`
	Limit  int32   `json:"limit"`
	Offset int32   `json:"offset"`
}

func fromSong(item *desktopv1.Song) Song {
	return Song{ID: item.GetId(), Title: item.GetTitle(), Artist: item.GetArtist(), ArtistID: item.GetArtistId(), Album: item.GetAlbum(), AlbumID: item.GetAlbumId(), Format: item.GetFormat(), DurationSeconds: item.GetDurationSeconds(), Year: item.GetYear(), Favorite: item.GetFavorite(), HasLyrics: item.GetHasLyrics(), CoverVersion: item.GetCoverVersion(), ResumePositionSeconds: item.GetResumePositionSeconds(), Mime: item.GetMime()}
}

func fromSongPage(page *desktopv1.SongPage) SongPage {
	result := SongPage{Items: []Song{}, Total: page.GetTotal(), Limit: page.GetLimit(), Offset: page.GetOffset()}
	for _, item := range page.GetItems() {
		result.Items = append(result.Items, fromSong(item))
	}
	return result
}

func fromArtist(item *desktopv1.Artist) Artist {
	return Artist{ID: item.GetId(), Name: item.GetName(), SongCount: item.GetSongCount(), AlbumCount: item.GetAlbumCount(), Favorite: item.GetFavorite()}
}

func fromAlbum(item *desktopv1.Album) Album {
	return Album{ID: item.GetId(), Title: item.GetTitle(), Artist: item.GetArtist(), ArtistID: item.GetArtistId(), Year: item.GetYear(), SongCount: item.GetSongCount(), Favorite: item.GetFavorite(), CoverVersion: item.GetCoverVersion()}
}

func (d *Desktop) Songs(ctx context.Context, query string, favorites bool, limit, offset int32) (SongPage, error) {
	client, token, err := d.rpc()
	if err != nil {
		return SongPage{}, err
	}
	ctx, cancel := context.WithTimeout(withToken(ctx, token), 20*time.Second)
	defer cancel()
	response, err := client.ListSongs(ctx, &desktopv1.ListSongsRequest{Query: query, FavoritesOnly: favorites, Limit: limit, Offset: offset})
	if err != nil {
		return SongPage{}, err
	}
	return fromSongPage(response.GetPage()), nil
}

func (d *Desktop) Song(ctx context.Context, id int64) (Song, error) {
	client, token, err := d.rpc()
	if err != nil {
		return Song{}, err
	}
	response, err := client.GetSong(withToken(ctx, token), &desktopv1.GetSongRequest{Id: id})
	if err != nil {
		return Song{}, err
	}
	return fromSong(response.GetSong()), nil
}

func (d *Desktop) Artists(ctx context.Context, favorites bool, limit, offset int32) (ArtistPage, error) {
	client, token, err := d.rpc()
	if err != nil {
		return ArtistPage{}, err
	}
	ctx, cancel := context.WithTimeout(withToken(ctx, token), 20*time.Second)
	defer cancel()
	response, err := client.ListArtists(ctx, &desktopv1.ListArtistsRequest{FavoritesOnly: favorites, Limit: limit, Offset: offset})
	if err != nil {
		return ArtistPage{}, err
	}
	page := response.GetPage()
	result := ArtistPage{Items: []Artist{}, Total: page.GetTotal(), Limit: page.GetLimit(), Offset: page.GetOffset()}
	for _, item := range page.GetItems() {
		result.Items = append(result.Items, fromArtist(item))
	}
	return result, nil
}

func (d *Desktop) Artist(ctx context.Context, id int64) (Artist, error) {
	client, token, err := d.rpc()
	if err != nil {
		return Artist{}, err
	}
	response, err := client.GetArtist(withToken(ctx, token), &desktopv1.GetArtistRequest{Id: id})
	if err != nil {
		return Artist{}, err
	}
	return fromArtist(response.GetArtist()), nil
}

func (d *Desktop) ArtistSongs(ctx context.Context, id int64) (SongPage, error) {
	client, token, err := d.rpc()
	if err != nil {
		return SongPage{}, err
	}
	response, err := client.ListArtistSongs(withToken(ctx, token), &desktopv1.ListArtistSongsRequest{ArtistId: id, Limit: 500})
	if err != nil {
		return SongPage{}, err
	}
	return fromSongPage(response.GetPage()), nil
}

func (d *Desktop) Albums(ctx context.Context, favorites bool, artistID int64, limit, offset int32) (AlbumPage, error) {
	client, token, err := d.rpc()
	if err != nil {
		return AlbumPage{}, err
	}
	ctx, cancel := context.WithTimeout(withToken(ctx, token), 20*time.Second)
	defer cancel()
	response, err := client.ListAlbums(ctx, &desktopv1.ListAlbumsRequest{FavoritesOnly: favorites, ArtistId: artistID, Limit: limit, Offset: offset})
	if err != nil {
		return AlbumPage{}, err
	}
	page := response.GetPage()
	result := AlbumPage{Items: []Album{}, Total: page.GetTotal(), Limit: page.GetLimit(), Offset: page.GetOffset()}
	for _, item := range page.GetItems() {
		result.Items = append(result.Items, fromAlbum(item))
	}
	return result, nil
}

func (d *Desktop) Album(ctx context.Context, id int64) (Album, error) {
	client, token, err := d.rpc()
	if err != nil {
		return Album{}, err
	}
	response, err := client.GetAlbum(withToken(ctx, token), &desktopv1.GetAlbumRequest{Id: id})
	if err != nil {
		return Album{}, err
	}
	return fromAlbum(response.GetAlbum()), nil
}

func (d *Desktop) AlbumSongs(ctx context.Context, id int64) (SongPage, error) {
	client, token, err := d.rpc()
	if err != nil {
		return SongPage{}, err
	}
	response, err := client.ListAlbumSongs(withToken(ctx, token), &desktopv1.ListAlbumSongsRequest{AlbumId: id, Limit: 500})
	if err != nil {
		return SongPage{}, err
	}
	return fromSongPage(response.GetPage()), nil
}

func (d *Desktop) Favorite(ctx context.Context, kind string, id int64, favorite bool) (bool, error) {
	client, token, err := d.rpc()
	if err != nil {
		return false, err
	}
	value := desktopv1.FavoriteKind_FAVORITE_KIND_UNSPECIFIED
	switch kind {
	case "song":
		value = desktopv1.FavoriteKind_FAVORITE_KIND_SONG
	case "album":
		value = desktopv1.FavoriteKind_FAVORITE_KIND_ALBUM
	case "artist":
		value = desktopv1.FavoriteKind_FAVORITE_KIND_ARTIST
	}
	response, err := client.SetFavorite(withToken(ctx, token), &desktopv1.SetFavoriteRequest{Kind: value, Id: id, Favorite: favorite})
	if err != nil {
		return false, err
	}
	return response.GetFavorite(), nil
}

func (d *Desktop) Lyrics(ctx context.Context, songID int64) (string, error) {
	client, token, err := d.rpc()
	if err != nil {
		return "", err
	}
	response, err := client.GetLyrics(withToken(ctx, token), &desktopv1.GetLyricsRequest{SongId: songID})
	if err != nil {
		return "", err
	}
	return response.GetLyrics().GetText(), nil
}

func (d *Desktop) MarkPlayed(ctx context.Context, songID int64) error {
	client, token, err := d.rpc()
	if err != nil {
		return err
	}
	_, err = client.MarkPlayed(withToken(ctx, token), &desktopv1.MarkPlayedRequest{SongId: songID})
	return err
}

func (d *Desktop) SaveProgress(ctx context.Context, songID int64, position, duration float64, completed bool) error {
	client, token, err := d.rpc()
	if err != nil {
		return err
	}
	_, err = client.SaveProgress(withToken(ctx, token), &desktopv1.SaveProgressRequest{SongId: songID, PositionSeconds: position, DurationSeconds: duration, Completed: completed})
	return err
}
