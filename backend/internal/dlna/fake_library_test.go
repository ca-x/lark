package dlna

import (
	"context"

	"lark/backend/ent"
	"lark/backend/internal/models"
)

type fakeLibrary struct {
	audioPath string
	coverData []byte
	coverMime string
	song      models.Song
	songsPage models.SongPage
}

func (f fakeLibrary) GetSettings(context.Context) (models.Settings, error) {
	return models.Settings{DLNACastEnabled: true, DLNALibraryEnabled: true, DLNAServerName: "Lark"}, nil
}

func (f fakeLibrary) RawSong(_ context.Context, id int) (*ent.Song, error) {
	path := f.audioPath
	if path == "" {
		path = f.song.Path
	}
	return &ent.Song{
		ID:              id,
		Title:           f.song.Title,
		Path:            path,
		FileName:        f.song.FileName,
		Format:          firstNonEmpty(f.song.Format, "mp3"),
		Mime:            firstNonEmpty(f.song.Mime, "audio/mpeg"),
		SizeBytes:       f.song.SizeBytes,
		DurationSeconds: f.song.DurationSeconds,
		BitRate:         f.song.BitRate,
	}, nil
}

func (f fakeLibrary) Song(_ context.Context, _ int, id int) (models.Song, error) {
	if f.song.ID == 0 {
		f.song.ID = id
	}
	return f.song, nil
}

func (f fakeLibrary) SongCover(context.Context, int) ([]byte, string, error) {
	return f.coverData, firstNonEmpty(f.coverMime, "image/jpeg"), nil
}

func (f fakeLibrary) SongsPage(context.Context, int, string, bool, int, int) (models.SongPage, error) {
	return f.songsPage, nil
}

func (f fakeLibrary) AlbumsPage(context.Context, int, int, int, int) (models.AlbumPage, error) {
	return models.AlbumPage{}, nil
}

func (f fakeLibrary) AlbumSongs(context.Context, int, int, int) ([]models.Song, error) {
	return nil, nil
}

func (f fakeLibrary) Artists(context.Context, int, int) ([]models.Artist, error) {
	return nil, nil
}

func (f fakeLibrary) ArtistSongs(context.Context, int, int, int) ([]models.Song, error) {
	return nil, nil
}

func (f fakeLibrary) Playlists(context.Context, int, int) ([]models.Playlist, error) {
	return nil, nil
}

func (f fakeLibrary) PlaylistSongs(context.Context, int, int, int) ([]models.Song, error) {
	return nil, nil
}

func (f fakeLibrary) Folders(context.Context, int, int) ([]models.Folder, error) {
	return nil, nil
}

func (f fakeLibrary) FolderSongs(context.Context, int, string, int) ([]models.Song, error) {
	return nil, nil
}

func (f fakeLibrary) FFmpegBin() string { return "" }
