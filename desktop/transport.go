package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/ca-x/lark/desktop/locales"
	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type desktopHTTPClient struct {
	baseURL string
	http    *http.Client
	options []connect.ClientOption
}

type desktopHTTPConnection struct {
	transport *http.Transport
	ctx       context.Context
	cancel    context.CancelFunc
}

type desktopHTTPBody struct {
	io.ReadCloser
	release context.CancelFunc
}

func (body *desktopHTTPBody) Close() error {
	body.release()
	return body.ReadCloser.Close()
}

var errDesktopDisabled = errors.New("desktop client API is disabled")
var errDesktopRedirect = errors.New("server redirected the connection; check the root URL and Cloudflare Access policies")
var errDesktopRateLimited = errors.New("server rate limit reached; wait before checking the connection again")

func (connection *desktopHTTPConnection) RoundTrip(request *http.Request) (*http.Response, error) {
	ctx, cancel := context.WithCancel(request.Context())
	stop := context.AfterFunc(connection.ctx, cancel)
	release := func() {
		stop()
		cancel()
	}
	if connection.ctx.Err() != nil {
		release()
		return nil, context.Canceled
	}
	response, err := connection.transport.RoundTrip(request.Clone(ctx))
	if err != nil {
		release()
		return nil, err
	}
	switch {
	case response.Header.Get("Lark-Desktop-Disabled") == "true":
		err = errDesktopDisabled
	case response.StatusCode >= 300 && response.StatusCode < 400:
		err = errDesktopRedirect
	case response.StatusCode == http.StatusTooManyRequests:
		err = errDesktopRateLimited
	}
	if err != nil {
		release()
		_ = response.Body.Close()
		return nil, err
	}
	response.Body = &desktopHTTPBody{ReadCloser: response.Body, release: release}
	return response, nil
}

func (connection *desktopHTTPConnection) Close() error {
	connection.cancel()
	connection.transport.CloseIdleConnections()
	return nil
}

func newDesktopHTTPClient(baseURL, protocol string) (io.Closer, desktopv1.DesktopServiceClient) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	transport.ResponseHeaderTimeout = 8 * time.Second
	transport.TLSHandshakeTimeout = 8 * time.Second
	ctx, cancel := context.WithCancel(context.Background())
	connection := &desktopHTTPConnection{transport: transport, ctx: ctx, cancel: cancel}
	client := &desktopHTTPClient{
		baseURL: baseURL,
		http: &http.Client{Transport: connection, CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
		options: []connect.ClientOption{connect.WithReadMaxBytes(8 << 20)},
	}
	if protocol == "grpc-web" {
		client.options = append(client.options, connect.WithGRPCWeb())
	}
	return connection, client
}

func dialDesktop(ctx context.Context, serverURL string, allowInsecure bool, preferred string) (io.Closer, desktopv1.DesktopServiceClient, string, error) {
	normalized, target, transport, err := normalizeServerURL(serverURL, allowInsecure)
	if err != nil {
		return nil, nil, "", err
	}
	protocols := []string{"connect", "grpc-web", "grpc"}
	if preferred == "grpc" || preferred == "grpc-web" {
		protocols = []string{preferred, "connect"}
		if preferred == "grpc" {
			protocols = append(protocols, "grpc-web")
		} else {
			protocols = append(protocols, "grpc")
		}
	}
	var failures []error
	for _, protocol := range protocols {
		if err := ctx.Err(); err != nil {
			return nil, nil, "", err
		}
		var connection io.Closer
		var client desktopv1.DesktopServiceClient
		if protocol == "grpc" {
			grpcConnection, err := grpc.NewClient(target, transport)
			if err != nil {
				return nil, nil, "", err
			}
			connection, client = grpcConnection, desktopv1.NewDesktopServiceClient(grpcConnection)
		} else {
			connection, client = newDesktopHTTPClient(normalized, protocol)
		}
		probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		probeCtx = metadata.NewOutgoingContext(probeCtx, metadata.MD{})
		info, err := client.GetServerInfo(probeCtx, &desktopv1.GetServerInfoRequest{})
		cancel()
		if err == nil {
			if info.GetProtocolVersion() != 1 {
				_ = connection.Close()
				return nil, nil, "", fmt.Errorf("%s: %d / 1", locales.ProtocolMismatch(), info.GetProtocolVersion())
			}
			return connection, client, protocol, nil
		}
		_ = connection.Close()
		failures = append(failures, fmt.Errorf("%s: %w", protocol, err))
		if ctx.Err() != nil {
			return nil, nil, "", ctx.Err()
		}
		if !canNegotiateTransport(err) {
			break
		}
	}
	return nil, nil, "", errors.Join(failures...)
}

func canNegotiateTransport(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, errDesktopDisabled) || errors.Is(err, errDesktopRedirect) || errors.Is(err, errDesktopRateLimited) {
		return false
	}
	if _, ok := errors.AsType[*tls.CertificateVerificationError](err); ok {
		return false
	}
	if _, ok := errors.AsType[x509.UnknownAuthorityError](err); ok {
		return false
	}
	if _, ok := errors.AsType[tls.RecordHeaderError](err); ok {
		return false
	}
	if connectError, ok := errors.AsType[*connect.Error](err); ok && connectError.Meta().Get("Lark-Desktop-Disabled") == "true" {
		return false
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "tls:") || strings.Contains(message, "x509:") {
		return false
	}
	switch status.Code(err) {
	case codes.Unimplemented, codes.Unavailable, codes.DeadlineExceeded, codes.Unknown:
		return true
	default:
		return false
	}
}

type desktopHTTPError struct{ cause error }

func (err *desktopHTTPError) Error() string { return err.cause.Error() }
func (err *desktopHTTPError) Unwrap() error { return err.cause }
func (err *desktopHTTPError) GRPCStatus() *status.Status {
	if grpcStatus, ok := status.FromError(err.cause); ok {
		return grpcStatus
	}
	return status.New(codes.Code(connect.CodeOf(err.cause)), err.cause.Error())
}

func desktopClientError(err error) error {
	if err == nil {
		return nil
	}
	return &desktopHTTPError{cause: err}
}

func desktopRequest[Request any](ctx context.Context, message *Request) *connect.Request[Request] {
	request := connect.NewRequest(message)
	if headers, ok := metadata.FromOutgoingContext(ctx); ok {
		for key, values := range headers {
			for _, value := range values {
				request.Header().Add(key, value)
			}
		}
	}
	return request
}

func desktopCall[Request, Response any](ctx context.Context, client *desktopHTTPClient, procedure string, message *Request) (*Response, error) {
	rpc := connect.NewClient[Request, Response](client.http, client.baseURL+procedure, client.options...)
	response, err := rpc.CallUnary(ctx, desktopRequest(ctx, message))
	if err != nil {
		return nil, desktopClientError(err)
	}
	return response.Msg, nil
}

func (client *desktopHTTPClient) GetServerInfo(ctx context.Context, request *desktopv1.GetServerInfoRequest, _ ...grpc.CallOption) (*desktopv1.GetServerInfoResponse, error) {
	return desktopCall[desktopv1.GetServerInfoRequest, desktopv1.GetServerInfoResponse](ctx, client, desktopv1.DesktopService_GetServerInfo_FullMethodName, request)
}
func (client *desktopHTTPClient) Login(ctx context.Context, request *desktopv1.LoginRequest, _ ...grpc.CallOption) (*desktopv1.LoginResponse, error) {
	return desktopCall[desktopv1.LoginRequest, desktopv1.LoginResponse](ctx, client, desktopv1.DesktopService_Login_FullMethodName, request)
}
func (client *desktopHTTPClient) GetSession(ctx context.Context, request *desktopv1.GetSessionRequest, _ ...grpc.CallOption) (*desktopv1.GetSessionResponse, error) {
	return desktopCall[desktopv1.GetSessionRequest, desktopv1.GetSessionResponse](ctx, client, desktopv1.DesktopService_GetSession_FullMethodName, request)
}
func (client *desktopHTTPClient) Logout(ctx context.Context, request *desktopv1.LogoutRequest, _ ...grpc.CallOption) (*desktopv1.LogoutResponse, error) {
	return desktopCall[desktopv1.LogoutRequest, desktopv1.LogoutResponse](ctx, client, desktopv1.DesktopService_Logout_FullMethodName, request)
}
func (client *desktopHTTPClient) ListSongs(ctx context.Context, request *desktopv1.ListSongsRequest, _ ...grpc.CallOption) (*desktopv1.ListSongsResponse, error) {
	return desktopCall[desktopv1.ListSongsRequest, desktopv1.ListSongsResponse](ctx, client, desktopv1.DesktopService_ListSongs_FullMethodName, request)
}
func (client *desktopHTTPClient) GetSong(ctx context.Context, request *desktopv1.GetSongRequest, _ ...grpc.CallOption) (*desktopv1.GetSongResponse, error) {
	return desktopCall[desktopv1.GetSongRequest, desktopv1.GetSongResponse](ctx, client, desktopv1.DesktopService_GetSong_FullMethodName, request)
}
func (client *desktopHTTPClient) ListArtists(ctx context.Context, request *desktopv1.ListArtistsRequest, _ ...grpc.CallOption) (*desktopv1.ListArtistsResponse, error) {
	return desktopCall[desktopv1.ListArtistsRequest, desktopv1.ListArtistsResponse](ctx, client, desktopv1.DesktopService_ListArtists_FullMethodName, request)
}
func (client *desktopHTTPClient) GetArtist(ctx context.Context, request *desktopv1.GetArtistRequest, _ ...grpc.CallOption) (*desktopv1.GetArtistResponse, error) {
	return desktopCall[desktopv1.GetArtistRequest, desktopv1.GetArtistResponse](ctx, client, desktopv1.DesktopService_GetArtist_FullMethodName, request)
}
func (client *desktopHTTPClient) ListArtistSongs(ctx context.Context, request *desktopv1.ListArtistSongsRequest, _ ...grpc.CallOption) (*desktopv1.ListArtistSongsResponse, error) {
	return desktopCall[desktopv1.ListArtistSongsRequest, desktopv1.ListArtistSongsResponse](ctx, client, desktopv1.DesktopService_ListArtistSongs_FullMethodName, request)
}
func (client *desktopHTTPClient) ListAlbums(ctx context.Context, request *desktopv1.ListAlbumsRequest, _ ...grpc.CallOption) (*desktopv1.ListAlbumsResponse, error) {
	return desktopCall[desktopv1.ListAlbumsRequest, desktopv1.ListAlbumsResponse](ctx, client, desktopv1.DesktopService_ListAlbums_FullMethodName, request)
}
func (client *desktopHTTPClient) GetAlbum(ctx context.Context, request *desktopv1.GetAlbumRequest, _ ...grpc.CallOption) (*desktopv1.GetAlbumResponse, error) {
	return desktopCall[desktopv1.GetAlbumRequest, desktopv1.GetAlbumResponse](ctx, client, desktopv1.DesktopService_GetAlbum_FullMethodName, request)
}
func (client *desktopHTTPClient) ListAlbumSongs(ctx context.Context, request *desktopv1.ListAlbumSongsRequest, _ ...grpc.CallOption) (*desktopv1.ListAlbumSongsResponse, error) {
	return desktopCall[desktopv1.ListAlbumSongsRequest, desktopv1.ListAlbumSongsResponse](ctx, client, desktopv1.DesktopService_ListAlbumSongs_FullMethodName, request)
}
func (client *desktopHTTPClient) SetFavorite(ctx context.Context, request *desktopv1.SetFavoriteRequest, _ ...grpc.CallOption) (*desktopv1.SetFavoriteResponse, error) {
	return desktopCall[desktopv1.SetFavoriteRequest, desktopv1.SetFavoriteResponse](ctx, client, desktopv1.DesktopService_SetFavorite_FullMethodName, request)
}
func (client *desktopHTTPClient) GetLyrics(ctx context.Context, request *desktopv1.GetLyricsRequest, _ ...grpc.CallOption) (*desktopv1.GetLyricsResponse, error) {
	return desktopCall[desktopv1.GetLyricsRequest, desktopv1.GetLyricsResponse](ctx, client, desktopv1.DesktopService_GetLyrics_FullMethodName, request)
}
func (client *desktopHTTPClient) MarkPlayed(ctx context.Context, request *desktopv1.MarkPlayedRequest, _ ...grpc.CallOption) (*desktopv1.MarkPlayedResponse, error) {
	return desktopCall[desktopv1.MarkPlayedRequest, desktopv1.MarkPlayedResponse](ctx, client, desktopv1.DesktopService_MarkPlayed_FullMethodName, request)
}
func (client *desktopHTTPClient) SaveProgress(ctx context.Context, request *desktopv1.SaveProgressRequest, _ ...grpc.CallOption) (*desktopv1.SaveProgressResponse, error) {
	return desktopCall[desktopv1.SaveProgressRequest, desktopv1.SaveProgressResponse](ctx, client, desktopv1.DesktopService_SaveProgress_FullMethodName, request)
}

func (client *desktopHTTPClient) StreamMedia(ctx context.Context, request *desktopv1.StreamMediaRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[desktopv1.StreamMediaResponse], error) {
	rpc := connect.NewClient[desktopv1.StreamMediaRequest, desktopv1.StreamMediaResponse](client.http, client.baseURL+desktopv1.DesktopService_StreamMedia_FullMethodName, client.options...)
	stream, err := rpc.CallServerStream(ctx, desktopRequest(ctx, request))
	if err != nil {
		return nil, desktopClientError(err)
	}
	return &desktopHTTPStream{ctx: ctx, stream: stream}, nil
}

type desktopHTTPStream struct {
	ctx    context.Context
	stream *connect.ServerStreamForClient[desktopv1.StreamMediaResponse]
}

func (stream *desktopHTTPStream) Recv() (*desktopv1.StreamMediaResponse, error) {
	if stream.stream.Receive() {
		return stream.stream.Msg(), nil
	}
	err := stream.stream.Err()
	_ = stream.stream.Close()
	if err != nil {
		return nil, desktopClientError(err)
	}
	return nil, io.EOF
}
func (stream *desktopHTTPStream) Header() (metadata.MD, error) {
	return metadata.MD(stream.stream.ResponseHeader()), nil
}
func (stream *desktopHTTPStream) Trailer() metadata.MD {
	return metadata.MD(stream.stream.ResponseTrailer())
}
func (stream *desktopHTTPStream) Context() context.Context { return stream.ctx }
func (stream *desktopHTTPStream) CloseSend() error         { return nil }
func (stream *desktopHTTPStream) SendMsg(any) error {
	return errors.New("server stream request already sent")
}
func (stream *desktopHTTPStream) RecvMsg(message any) error {
	target, ok := message.(*desktopv1.StreamMediaResponse)
	if !ok {
		return errors.New("unexpected media response type")
	}
	response, err := stream.Recv()
	if err == nil {
		proto.Reset(target)
		proto.Merge(target, response)
	}
	return err
}
