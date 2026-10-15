package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
	"github.com/egoist/mygo/audio"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

type fixtureDesktopServer struct {
	desktopv1.UnimplementedDesktopServiceServer
	data []byte
}

func (*fixtureDesktopServer) GetServerInfo(context.Context, *desktopv1.GetServerInfoRequest) (*desktopv1.GetServerInfoResponse, error) {
	return &desktopv1.GetServerInfoResponse{ProtocolVersion: 1, Initialized: true}, nil
}

func (*fixtureDesktopServer) Login(_ context.Context, req *desktopv1.LoginRequest) (*desktopv1.LoginResponse, error) {
	if req.GetUsername() != "listener" || req.GetPassword() != "secret" {
		return nil, context.Canceled
	}
	return &desktopv1.LoginResponse{SessionToken: "session-token", User: &desktopv1.User{Id: 7, Username: "listener"}}, nil
}

func (*fixtureDesktopServer) GetSession(ctx context.Context, _ *desktopv1.GetSessionRequest) (*desktopv1.GetSessionResponse, error) {
	md, _ := metadata.FromIncomingContext(ctx)
	if len(md.Get("authorization")) != 1 || md.Get("authorization")[0] != "Bearer session-token" {
		return nil, context.Canceled
	}
	return &desktopv1.GetSessionResponse{User: &desktopv1.User{Id: 7, Username: "listener"}}, nil
}

func (*fixtureDesktopServer) Logout(context.Context, *desktopv1.LogoutRequest) (*desktopv1.LogoutResponse, error) {
	return &desktopv1.LogoutResponse{}, nil
}

func (s *fixtureDesktopServer) StreamMedia(req *desktopv1.StreamMediaRequest, stream grpc.ServerStreamingServer[desktopv1.StreamMediaResponse]) error {
	if req.GetKind() != desktopv1.MediaKind_MEDIA_KIND_SONG_AUDIO || !strings.HasPrefix(req.GetRange(), "bytes=") {
		return context.Canceled
	}
	data := s.data
	if data == nil {
		data = []byte("0123456789")
	}
	rawStart, rawEnd, ok := strings.Cut(strings.TrimPrefix(req.GetRange(), "bytes="), "-")
	if !ok {
		return context.Canceled
	}
	start, err := strconv.Atoi(rawStart)
	if err != nil || start < 0 || start >= len(data) {
		return context.Canceled
	}
	end := len(data) - 1
	if rawEnd != "" {
		end, err = strconv.Atoi(rawEnd)
		if err != nil || end < start || end >= len(data) {
			return context.Canceled
		}
	}
	body := data[start : end+1]
	if err := stream.Send(&desktopv1.StreamMediaResponse{Payload: &desktopv1.StreamMediaResponse_Header{Header: &desktopv1.MediaHeader{Status: http.StatusPartialContent, ContentType: "audio/mpeg", ContentRange: fmt.Sprintf("bytes %d-%d/%d", start, end, len(data)), AcceptRanges: "bytes", ContentLength: int64(len(body))}}}); err != nil {
		return err
	}
	return stream.Send(&desktopv1.StreamMediaResponse{Payload: &desktopv1.StreamMediaResponse_Data{Data: body}})
}

func TestDesktopConnectAndMediaBridge(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	desktopv1.RegisterDesktopServiceServer(server, &fixtureDesktopServer{})
	t.Cleanup(server.Stop)
	go func() { _ = server.Serve(listener) }()
	dir := t.TempDir()
	d, err := newDesktopClient(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(d.close)
	connected, err := d.Connect(t.Context(), "http://"+listener.Addr().String(), "listener", "secret", true)
	if err != nil || !connected.Connected || connected.User.Username != "listener" {
		t.Fatalf("connect = %+v, %v", connected, err)
	}
	if got := d.Status(t.Context()); !got.Connected || got.User.ID != 7 {
		t.Fatalf("status = %+v", got)
	}
	request := httptest.NewRequest(http.MethodGet, "larkmedia://localhost/song/3", nil)
	request.Header.Set("Range", "bytes=2-4")
	response := httptest.NewRecorder()
	d.serveMedia(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "234" || response.Header().Get("Content-Range") != "bytes 2-4/10" {
		t.Fatalf("media = %d %q %v", response.Code, response.Body.String(), response.Header())
	}
	rpc, token, err := d.rpc()
	if err != nil {
		t.Fatal(err)
	}
	reader, err := newGRPCRangeReader(rpc, token, 3)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reader.Close() })
	buf := make([]byte, 4)
	if _, err := io.ReadFull(reader, buf); err != nil || string(buf) != "0123" {
		t.Fatalf("first native read = %q, %v", buf, err)
	}
	if _, err := reader.Seek(5, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	buf = make([]byte, 3)
	if _, err := io.ReadFull(reader, buf); err != nil || string(buf) != "567" {
		t.Fatalf("seeked native read = %q, %v", buf, err)
	}
	if _, err := reader.Seek(-2, io.SeekEnd); err != nil {
		t.Fatal(err)
	}
	buf = make([]byte, 2)
	if _, err := io.ReadFull(reader, buf); err != nil || string(buf) != "89" {
		t.Fatalf("tail native read = %q, %v", buf, err)
	}
	if err := d.Disconnect(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "auth.json")); !os.IsNotExist(err) {
		t.Fatalf("auth file remains after sign out: %v", err)
	}
}

func TestNativeAudioDecodesSeekableGRPCWAV(t *testing.T) {
	data := make([]byte, 52)
	copy(data[0:], "RIFF")
	binary.LittleEndian.PutUint32(data[4:], 44)
	copy(data[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:], 16)
	binary.LittleEndian.PutUint16(data[20:], 1)
	binary.LittleEndian.PutUint16(data[22:], 1)
	binary.LittleEndian.PutUint32(data[24:], 8000)
	binary.LittleEndian.PutUint32(data[28:], 16000)
	binary.LittleEndian.PutUint16(data[32:], 2)
	binary.LittleEndian.PutUint16(data[34:], 16)
	copy(data[36:], "data")
	binary.LittleEndian.PutUint32(data[40:], 8)
	binary.LittleEndian.PutUint16(data[46:], 1000)
	binary.LittleEndian.PutUint16(data[48:], 64536)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := grpc.NewServer()
	desktopv1.RegisterDesktopServiceServer(server, &fixtureDesktopServer{data: data})
	t.Cleanup(server.Stop)
	go func() { _ = server.Serve(listener) }()
	conn, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	reader, err := newGRPCRangeReader(desktopv1.NewDesktopServiceClient(conn), "session-token", 3)
	if err != nil {
		t.Fatal(err)
	}
	player, err := audio.OpenStream(reader)
	if err != nil {
		_ = reader.Close()
		t.Fatal(err)
	}
	defer player.Close()
	if player.Duration() <= 0 {
		t.Fatal("native WAV decoder returned no duration")
	}
}
