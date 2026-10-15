package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"

	"lark/backend/ent"
	"lark/backend/internal/library"
	"lark/backend/internal/models"
	"lark/backend/pkg/version"

	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

const desktopProtocolVersion = 1

type desktopRPC struct {
	desktopv1.UnimplementedDesktopServiceServer
	lib     *library.Service
	handler http.Handler
}

func (s *Server) desktopHandler() http.Handler {
	rpcServer := grpc.NewServer()
	desktopv1.RegisterDesktopServiceServer(rpcServer, &desktopRPC{lib: s.lib, handler: s.echo})
	return h2c.NewHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ProtoMajor == 2 && strings.HasPrefix(r.Header.Get("Content-Type"), "application/grpc") {
			rpcServer.ServeHTTP(w, r)
			return
		}
		s.echo.ServeHTTP(w, r)
	}), &http2.Server{})
}

func (d *desktopRPC) session(ctx context.Context) (*ent.User, string, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return nil, "", status.Error(codes.Unauthenticated, "session required")
	}
	auth := md.Get("authorization")
	if len(auth) != 1 || !strings.HasPrefix(auth[0], "Bearer ") {
		return nil, "", status.Error(codes.Unauthenticated, "session required")
	}
	token := strings.TrimSpace(strings.TrimPrefix(auth[0], "Bearer "))
	user, err := d.lib.UserBySession(ctx, token)
	if err != nil {
		return nil, "", status.Error(codes.Unauthenticated, "session expired")
	}
	return user, token, nil
}

func desktopError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, library.ErrForbidden):
		return status.Error(codes.PermissionDenied, "forbidden")
	case errors.Is(err, library.ErrUnauthenticated):
		return status.Error(codes.Unauthenticated, "session expired")
	case ent.IsNotFound(err):
		return status.Error(codes.NotFound, "item not found")
	case errors.Is(err, context.Canceled):
		return status.Error(codes.Canceled, "request canceled")
	default:
		return status.Error(codes.Internal, "server error")
	}
}

func desktopPage(limit, offset int32) (int, int) {
	return int(max(1, min(limit, 100))), int(max(0, offset))
}

func (d *desktopRPC) GetServerInfo(ctx context.Context, _ *desktopv1.GetServerInfoRequest) (*desktopv1.GetServerInfoResponse, error) {
	auth, err := d.lib.AuthStatus(ctx, "")
	if err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.GetServerInfoResponse{ProtocolVersion: desktopProtocolVersion, ServerVersion: version.GetVersion(), Initialized: auth.Initialized}, nil
}

func (d *desktopRPC) Login(ctx context.Context, req *desktopv1.LoginRequest) (*desktopv1.LoginResponse, error) {
	if strings.TrimSpace(req.GetUsername()) == "" || req.GetPassword() == "" {
		return nil, status.Error(codes.InvalidArgument, "username and password required")
	}
	user, token, err := d.lib.Login(ctx, req.GetUsername(), req.GetPassword())
	if err != nil {
		if ent.IsNotFound(err) || errors.Is(err, library.ErrForbidden) {
			return nil, status.Error(codes.Unauthenticated, "invalid credentials")
		}
		return nil, desktopError(err)
	}
	return &desktopv1.LoginResponse{SessionToken: token, User: desktopUser(user)}, nil
}

func (d *desktopRPC) GetSession(ctx context.Context, _ *desktopv1.GetSessionRequest) (*desktopv1.GetSessionResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	return &desktopv1.GetSessionResponse{User: &desktopv1.User{Id: int64(user.ID), Username: user.Username, Nickname: user.Nickname, Role: user.Role}}, nil
}

func (d *desktopRPC) Logout(ctx context.Context, _ *desktopv1.LogoutRequest) (*desktopv1.LogoutResponse, error) {
	_, token, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	if err := d.lib.Logout(ctx, token); err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.LogoutResponse{}, nil
}

func (d *desktopRPC) ListSongs(ctx context.Context, req *desktopv1.ListSongsRequest) (*desktopv1.ListSongsResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	limit, offset := desktopPage(req.GetLimit(), req.GetOffset())
	page, err := d.lib.SongsPage(ctx, user.ID, req.GetQuery(), req.GetFavoritesOnly(), limit, offset)
	if err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.ListSongsResponse{Page: desktopSongPage(page)}, nil
}

func (d *desktopRPC) GetSong(ctx context.Context, req *desktopv1.GetSongRequest) (*desktopv1.GetSongResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	song, err := d.lib.Song(ctx, user.ID, int(req.GetId()))
	if err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.GetSongResponse{Song: desktopSong(song)}, nil
}

func (d *desktopRPC) ListArtists(ctx context.Context, req *desktopv1.ListArtistsRequest) (*desktopv1.ListArtistsResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	limit, offset := desktopPage(req.GetLimit(), req.GetOffset())
	var page models.ArtistPage
	if req.GetFavoritesOnly() {
		page, err = d.lib.FavoriteArtistsPage(ctx, user.ID, limit, offset, req.GetInitial())
	} else {
		page, err = d.lib.ArtistsPage(ctx, user.ID, limit, offset, req.GetInitial())
	}
	if err != nil {
		return nil, desktopError(err)
	}
	items := make([]*desktopv1.Artist, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, desktopArtist(item))
	}
	return &desktopv1.ListArtistsResponse{Page: &desktopv1.ArtistPage{Items: items, Total: int32(page.Total), Limit: int32(page.Limit), Offset: int32(page.Offset)}}, nil
}

func (d *desktopRPC) GetArtist(ctx context.Context, req *desktopv1.GetArtistRequest) (*desktopv1.GetArtistResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	item, err := d.lib.Artist(ctx, user.ID, int(req.GetId()))
	if err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.GetArtistResponse{Artist: desktopArtist(item)}, nil
}

func (d *desktopRPC) ListArtistSongs(ctx context.Context, req *desktopv1.ListArtistSongsRequest) (*desktopv1.ListArtistSongsResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	items, err := d.lib.ArtistSongs(ctx, user.ID, int(req.GetArtistId()), int(max(1, min(req.GetLimit(), 500))))
	if err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.ListArtistSongsResponse{Page: desktopSongPage(models.SongPage{Items: items, Total: len(items), Limit: len(items)})}, nil
}

func (d *desktopRPC) ListAlbums(ctx context.Context, req *desktopv1.ListAlbumsRequest) (*desktopv1.ListAlbumsResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	limit, offset := desktopPage(req.GetLimit(), req.GetOffset())
	var page models.AlbumPage
	if req.GetFavoritesOnly() {
		page, err = d.lib.FavoriteAlbumsPage(ctx, user.ID, limit, offset, int(req.GetArtistId()))
	} else {
		page, err = d.lib.AlbumsPage(ctx, user.ID, limit, offset, int(req.GetArtistId()))
	}
	if err != nil {
		return nil, desktopError(err)
	}
	items := make([]*desktopv1.Album, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, desktopAlbum(item))
	}
	return &desktopv1.ListAlbumsResponse{Page: &desktopv1.AlbumPage{Items: items, Total: int32(page.Total), Limit: int32(page.Limit), Offset: int32(page.Offset)}}, nil
}

func (d *desktopRPC) GetAlbum(ctx context.Context, req *desktopv1.GetAlbumRequest) (*desktopv1.GetAlbumResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	item, err := d.lib.Album(ctx, user.ID, int(req.GetId()))
	if err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.GetAlbumResponse{Album: desktopAlbum(item)}, nil
}

func (d *desktopRPC) ListAlbumSongs(ctx context.Context, req *desktopv1.ListAlbumSongsRequest) (*desktopv1.ListAlbumSongsResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	items, err := d.lib.AlbumSongs(ctx, user.ID, int(req.GetAlbumId()), int(max(1, min(req.GetLimit(), 500))))
	if err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.ListAlbumSongsResponse{Page: desktopSongPage(models.SongPage{Items: items, Total: len(items), Limit: len(items)})}, nil
}

func (d *desktopRPC) SetFavorite(ctx context.Context, req *desktopv1.SetFavoriteRequest) (*desktopv1.SetFavoriteResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	var favorite bool
	switch req.GetKind() {
	case desktopv1.FavoriteKind_FAVORITE_KIND_SONG:
		item, e := d.lib.SetSongFavorite(ctx, user.ID, int(req.GetId()), req.GetFavorite())
		err, favorite = e, item.Favorite
	case desktopv1.FavoriteKind_FAVORITE_KIND_ALBUM:
		item, e := d.lib.SetAlbumFavorite(ctx, user.ID, int(req.GetId()), req.GetFavorite())
		err, favorite = e, item.Favorite
	case desktopv1.FavoriteKind_FAVORITE_KIND_ARTIST:
		item, e := d.lib.SetArtistFavorite(ctx, user.ID, int(req.GetId()), req.GetFavorite())
		err, favorite = e, item.Favorite
	default:
		return nil, status.Error(codes.InvalidArgument, "unknown favorite kind")
	}
	if err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.SetFavoriteResponse{Favorite: favorite}, nil
}

func (d *desktopRPC) GetLyrics(ctx context.Context, req *desktopv1.GetLyricsRequest) (*desktopv1.GetLyricsResponse, error) {
	if _, _, err := d.session(ctx); err != nil {
		return nil, err
	}
	item, err := d.lib.Lyrics(ctx, int(req.GetSongId()), "")
	if err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.GetLyricsResponse{Lyrics: &desktopv1.Lyrics{Text: item.Lyrics, Source: item.Source}}, nil
}

func (d *desktopRPC) MarkPlayed(ctx context.Context, req *desktopv1.MarkPlayedRequest) (*desktopv1.MarkPlayedResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	if err := d.lib.MarkPlayed(ctx, user.ID, int(req.GetSongId())); err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.MarkPlayedResponse{}, nil
}

func (d *desktopRPC) SaveProgress(ctx context.Context, req *desktopv1.SaveProgressRequest) (*desktopv1.SaveProgressResponse, error) {
	user, _, err := d.session(ctx)
	if err != nil {
		return nil, err
	}
	ctx = library.WithPlaybackDeviceType(ctx, "pc")
	if err := d.lib.SavePlaybackProgress(ctx, user.ID, int(req.GetSongId()), req.GetPositionSeconds(), req.GetDurationSeconds(), req.GetCompleted()); err != nil {
		return nil, desktopError(err)
	}
	return &desktopv1.SaveProgressResponse{}, nil
}

func desktopUser(item models.User) *desktopv1.User {
	return &desktopv1.User{Id: int64(item.ID), Username: item.Username, Nickname: item.Nickname, Role: item.Role}
}

func desktopSong(item models.Song) *desktopv1.Song {
	return &desktopv1.Song{Id: int64(item.ID), Title: item.Title, Artist: item.Artist, ArtistId: int64(item.ArtistID), Album: item.Album, AlbumId: int64(item.AlbumID), Format: item.Format, DurationSeconds: item.DurationSeconds, Year: int32(item.Year), Favorite: item.Favorite, HasLyrics: item.HasLyrics, CoverVersion: item.CoverVersion, ResumePositionSeconds: item.ResumePosition, Mime: item.Mime, SampleRate: int32(item.SampleRate), BitDepth: int32(item.BitDepth), SizeBytes: item.SizeBytes, Type: item.Type}
}

func desktopSongPage(page models.SongPage) *desktopv1.SongPage {
	items := make([]*desktopv1.Song, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, desktopSong(item))
	}
	return &desktopv1.SongPage{Items: items, Total: int32(page.Total), Limit: int32(page.Limit), Offset: int32(page.Offset)}
}

func desktopArtist(item models.Artist) *desktopv1.Artist {
	return &desktopv1.Artist{Id: int64(item.ID), Name: item.Name, SongCount: int32(item.SongCount), AlbumCount: int32(item.AlbumCount), Favorite: item.Favorite}
}

func desktopAlbum(item models.Album) *desktopv1.Album {
	return &desktopv1.Album{Id: int64(item.ID), Title: item.Title, Artist: item.Artist, ArtistId: int64(item.ArtistID), Year: int32(item.Year), SongCount: int32(item.SongCount), Favorite: item.Favorite, CoverVersion: item.CoverVersion}
}

func (d *desktopRPC) StreamMedia(req *desktopv1.StreamMediaRequest, stream grpc.ServerStreamingServer[desktopv1.StreamMediaResponse]) error {
	_, token, err := d.session(stream.Context())
	if err != nil {
		return err
	}
	if req.GetId() <= 0 {
		return status.Error(codes.InvalidArgument, "media id required")
	}
	var path string
	switch req.GetKind() {
	case desktopv1.MediaKind_MEDIA_KIND_SONG_AUDIO:
		mode := req.GetMode()
		if mode != "auto" && mode != "raw" && mode != "transcode" {
			mode = "auto"
		}
		path = fmt.Sprintf("/api/songs/%d/stream?mode=%s", req.GetId(), mode)
	case desktopv1.MediaKind_MEDIA_KIND_SONG_COVER:
		path = fmt.Sprintf("/api/songs/%d/cover", req.GetId())
	case desktopv1.MediaKind_MEDIA_KIND_ALBUM_COVER:
		path = fmt.Sprintf("/api/albums/%d/cover", req.GetId())
	case desktopv1.MediaKind_MEDIA_KIND_ARTIST_COVER:
		path = fmt.Sprintf("/api/artists/%d/cover", req.GetId())
	default:
		return status.Error(codes.InvalidArgument, "unknown media kind")
	}
	r := httptest.NewRequestWithContext(stream.Context(), http.MethodGet, path, nil)
	r.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
	r.Header.Set("X-Lark-Device-Type", "pc")
	if req.GetRange() != "" {
		r.Header.Set("Range", req.GetRange())
	}
	w := &desktopMediaWriter{header: make(http.Header), stream: stream}
	d.handler.ServeHTTP(w, r)
	if w.sendErr != nil {
		return w.sendErr
	}
	if !w.sentHeader {
		return w.writeHeader(http.StatusNoContent)
	}
	return nil
}

type desktopMediaWriter struct {
	header     http.Header
	stream     grpc.ServerStreamingServer[desktopv1.StreamMediaResponse]
	sentHeader bool
	sendErr    error
}

func (w *desktopMediaWriter) Header() http.Header { return w.header }

func (w *desktopMediaWriter) WriteHeader(code int) {
	if !w.sentHeader {
		w.sendErr = w.writeHeader(code)
	}
}

func (w *desktopMediaWriter) writeHeader(code int) error {
	w.sentHeader = true
	length, _ := strconv.ParseInt(w.header.Get("Content-Length"), 10, 64)
	return w.stream.Send(&desktopv1.StreamMediaResponse{Payload: &desktopv1.StreamMediaResponse_Header{Header: &desktopv1.MediaHeader{
		Status: int32(code), ContentType: w.header.Get("Content-Type"), ContentRange: w.header.Get("Content-Range"), AcceptRanges: w.header.Get("Accept-Ranges"), ContentLength: length,
	}}})
}

func (w *desktopMediaWriter) Write(data []byte) (int, error) {
	written := len(data)
	if !w.sentHeader {
		w.WriteHeader(http.StatusOK)
	}
	if w.sendErr != nil {
		return 0, w.sendErr
	}
	for len(data) > 0 {
		chunk := data[:min(len(data), 64<<10)]
		if err := w.stream.Send(&desktopv1.StreamMediaResponse{Payload: &desktopv1.StreamMediaResponse_Data{Data: chunk}}); err != nil {
			w.sendErr = err
			return 0, err
		}
		data = data[len(chunk):]
	}
	return written, nil
}
