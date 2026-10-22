package api

import (
	"context"
	"net/http"

	"connectrpc.com/connect"
	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func newDesktopHTTPHandler(service *desktopRPC) http.Handler {
	mux := http.NewServeMux()
	desktopUnary(mux, desktopv1.DesktopService_GetServerInfo_FullMethodName, service.GetServerInfo)
	desktopUnary(mux, desktopv1.DesktopService_Login_FullMethodName, service.Login)
	desktopUnary(mux, desktopv1.DesktopService_GetSession_FullMethodName, service.GetSession)
	desktopUnary(mux, desktopv1.DesktopService_Logout_FullMethodName, service.Logout)
	desktopUnary(mux, desktopv1.DesktopService_ListSongs_FullMethodName, service.ListSongs)
	desktopUnary(mux, desktopv1.DesktopService_GetSong_FullMethodName, service.GetSong)
	desktopUnary(mux, desktopv1.DesktopService_ListArtists_FullMethodName, service.ListArtists)
	desktopUnary(mux, desktopv1.DesktopService_GetArtist_FullMethodName, service.GetArtist)
	desktopUnary(mux, desktopv1.DesktopService_ListArtistSongs_FullMethodName, service.ListArtistSongs)
	desktopUnary(mux, desktopv1.DesktopService_ListAlbums_FullMethodName, service.ListAlbums)
	desktopUnary(mux, desktopv1.DesktopService_GetAlbum_FullMethodName, service.GetAlbum)
	desktopUnary(mux, desktopv1.DesktopService_ListAlbumSongs_FullMethodName, service.ListAlbumSongs)
	desktopUnary(mux, desktopv1.DesktopService_SetFavorite_FullMethodName, service.SetFavorite)
	desktopUnary(mux, desktopv1.DesktopService_GetLyrics_FullMethodName, service.GetLyrics)
	desktopUnary(mux, desktopv1.DesktopService_MarkPlayed_FullMethodName, service.MarkPlayed)
	desktopUnary(mux, desktopv1.DesktopService_SaveProgress_FullMethodName, service.SaveProgress)
	mux.Handle(desktopv1.DesktopService_StreamMedia_FullMethodName, connect.NewServerStreamHandler(
		desktopv1.DesktopService_StreamMedia_FullMethodName,
		func(ctx context.Context, request *connect.Request[desktopv1.StreamMediaRequest], stream *connect.ServerStream[desktopv1.StreamMediaResponse]) error {
			return desktopConnectError(service.streamMedia(desktopIncomingContext(ctx, request.Header()), request.Msg, stream.Send))
		}, connect.WithReadMaxBytes(1<<20),
	))
	return mux
}

func desktopUnary[Request, Response any](mux *http.ServeMux, procedure string, method func(context.Context, *Request) (*Response, error)) {
	mux.Handle(procedure, connect.NewUnaryHandler(procedure, func(ctx context.Context, request *connect.Request[Request]) (*connect.Response[Response], error) {
		response, err := method(desktopIncomingContext(ctx, request.Header()), request.Msg)
		if err != nil {
			return nil, desktopConnectError(err)
		}
		return connect.NewResponse(response), nil
	}, connect.WithReadMaxBytes(1<<20)))
}

func desktopIncomingContext(ctx context.Context, header http.Header) context.Context {
	return metadata.NewIncomingContext(ctx, metadata.MD{"authorization": header.Values("Authorization")})
}

func desktopConnectError(err error) error {
	if err == nil {
		return nil
	}
	grpcStatus := status.Convert(err)
	return connect.NewError(connect.Code(grpcStatus.Code()), grpcStatus.Err())
}
