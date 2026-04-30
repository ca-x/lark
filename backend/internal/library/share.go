package library

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/appsetting"
	"lark/backend/ent/artist"
	"lark/backend/ent/playlist"
	"lark/backend/ent/song"
	"lark/backend/ent/user"
	"lark/backend/internal/models"
)

const shareSettingPrefix = "share:"

type storedShare struct {
	Token     string    `json:"token"`
	Type      string    `json:"type"`
	ID        int       `json:"id"`
	Title     string    `json:"title"`
	CreatedBy int       `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Service) CreateShare(ctx context.Context, userID int, targetType string, targetID int, baseURL string) (models.Share, error) {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return models.Share{}, err
	}
	if !settings.SharingEnabled {
		return models.Share{}, ErrForbidden
	}
	targetType = strings.ToLower(strings.TrimSpace(targetType))
	title, err := s.shareTargetTitle(ctx, userID, targetType, targetID)
	if err != nil {
		return models.Share{}, err
	}
	var token string
	for i := 0; i < 8; i++ {
		token, err = randomShareToken()
		if err != nil {
			return models.Share{}, err
		}
		_, err = s.client.AppSetting.Query().Where(appsetting.Key(shareSettingPrefix + token)).Only(ctx)
		if ent.IsNotFound(err) {
			err = nil
			break
		}
		if err != nil {
			return models.Share{}, err
		}
		token = ""
	}
	if token == "" {
		return models.Share{}, fmt.Errorf("failed to generate share token")
	}
	share := storedShare{
		Token:     token,
		Type:      targetType,
		ID:        targetID,
		Title:     title,
		CreatedBy: userID,
		CreatedAt: time.Now().UTC(),
	}
	data, err := json.Marshal(share)
	if err != nil {
		return models.Share{}, err
	}
	if err := s.setSetting(ctx, shareSettingPrefix+token, string(data)); err != nil {
		return models.Share{}, err
	}
	return mapShare(share, baseURL), nil
}

func (s *Service) PublicShare(ctx context.Context, token string, baseURL string) (models.PublicShare, error) {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return models.PublicShare{}, err
	}
	if !settings.SharingEnabled {
		return models.PublicShare{}, ErrForbidden
	}
	share, err := s.loadShare(ctx, token)
	if err != nil {
		return models.PublicShare{}, err
	}
	songs, err := s.shareSongs(ctx, share)
	if err != nil {
		return models.PublicShare{}, err
	}
	return models.PublicShare{Share: mapShare(share, baseURL), Songs: songs}, nil
}

func (s *Service) ShareAllowsSong(ctx context.Context, token string, songID int) error {
	publicShare, err := s.PublicShare(ctx, token, "")
	if err != nil {
		return err
	}
	for _, item := range publicShare.Songs {
		if item.ID == songID {
			return nil
		}
	}
	return &ent.NotFoundError{}
}

func (s *Service) shareTargetTitle(ctx context.Context, userID int, targetType string, targetID int) (string, error) {
	if targetID <= 0 {
		return "", fmt.Errorf("share target id is required")
	}
	switch targetType {
	case "song":
		item, err := s.client.Song.Query().Where(song.ID(targetID)).Only(ctx)
		if err != nil {
			return "", err
		}
		return firstString(item.Title, item.FileName), nil
	case "album":
		item, err := s.client.Album.Query().Where(album.ID(targetID), album.HasSongs()).Only(ctx)
		if err != nil {
			return "", err
		}
		return item.Title, nil
	case "artist":
		item, err := s.client.Artist.Query().Where(artist.ID(targetID), artist.HasSongs()).Only(ctx)
		if err != nil {
			return "", err
		}
		return item.Name, nil
	case "playlist":
		item, err := s.client.Playlist.Query().Where(playlist.ID(targetID), playlist.HasOwnerWith(user.ID(userID))).Only(ctx)
		if err != nil {
			return "", err
		}
		return item.Name, nil
	default:
		return "", fmt.Errorf("share target type must be song, album, artist or playlist")
	}
}

func (s *Service) loadShare(ctx context.Context, token string) (storedShare, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return storedShare{}, &ent.NotFoundError{}
	}
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(shareSettingPrefix + token)).Only(ctx)
	if err != nil {
		return storedShare{}, err
	}
	var share storedShare
	if err := json.Unmarshal([]byte(item.Value), &share); err != nil {
		return storedShare{}, err
	}
	if share.Token == "" {
		share.Token = token
	}
	return share, nil
}

func (s *Service) shareSongs(ctx context.Context, share storedShare) ([]models.Song, error) {
	switch share.Type {
	case "song":
		items, err := s.client.Song.Query().Where(song.ID(share.ID)).WithArtist().WithAlbum().All(ctx)
		if err != nil {
			return nil, err
		}
		return mapSongs(items), nil
	case "album":
		item, err := s.client.Album.Query().Where(album.ID(share.ID)).WithSongs(func(q *ent.SongQuery) {
			q.WithArtist().WithAlbum()
			q.Order(ent.Asc(song.FieldTitle), ent.Asc(song.FieldID))
		}).Only(ctx)
		if err != nil {
			return nil, err
		}
		return mapSongs(item.Edges.Songs), nil
	case "artist":
		item, err := s.client.Artist.Query().Where(artist.ID(share.ID)).WithSongs(func(q *ent.SongQuery) {
			q.WithArtist().WithAlbum().Order(ent.Asc(song.FieldTitle), ent.Asc(song.FieldID))
		}).Only(ctx)
		if err != nil {
			return nil, err
		}
		return mapSongs(item.Edges.Songs), nil
	case "playlist":
		item, err := s.client.Playlist.Query().Where(playlist.ID(share.ID)).WithSongs(func(q *ent.SongQuery) {
			q.WithArtist().WithAlbum().Order(ent.Asc(song.FieldID))
		}).Only(ctx)
		if err != nil {
			return nil, err
		}
		return mapSongs(item.Edges.Songs), nil
	default:
		return nil, fmt.Errorf("unsupported share target type")
	}
}

func mapShare(share storedShare, baseURL string) models.Share {
	out := models.Share{
		Token:     share.Token,
		Type:      share.Type,
		ID:        share.ID,
		Title:     share.Title,
		CreatedBy: share.CreatedBy,
		CreatedAt: share.CreatedAt,
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL != "" {
		out.URL = baseURL + "/share/" + share.Token
	}
	return out
}

func randomShareToken() (string, error) {
	data := make([]byte, 18)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}
