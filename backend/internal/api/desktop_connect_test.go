package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/library"

	"connectrpc.com/connect"
	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
)

func TestDesktopHTTP1Protocols(t *testing.T) {
	for _, protocol := range []string{"connect", "grpc-web"} {
		t.Run(protocol, func(t *testing.T) {
			database := enttest.Open(t, "sqlite3", "file:"+protocol+"?mode=memory&cache=shared&_pragma=foreign_keys(1)")
			t.Cleanup(func() { _ = database.Close() })
			libraryDir := t.TempDir()
			path := filepath.Join(libraryDir, "fixture.mp3")
			if err := os.WriteFile(path, []byte("0123456789"), 0o600); err != nil {
				t.Fatal(err)
			}
			lib := library.New(database, t.TempDir(), libraryDir, "", "", nil, nil)
			if _, _, err := lib.SetupAdmin(t.Context(), "admin", "password"); err != nil {
				t.Fatal(err)
			}
			song, err := database.Song.Create().SetTitle("Fixture").SetSourceType("local").SetPath(path).
				SetFileName("fixture.mp3").SetFormat("mp3").SetSizeBytes(10).SetDurationSeconds(12).Save(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			service := New(database, lib, "*")
			handler := service.desktopHandler()
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				requests.Add(1)
				if request.ProtoMajor != 1 {
					t.Errorf("expected HTTP/1.1, got %s", request.Proto)
				}
				handler.ServeHTTP(writer, request)
			}))
			t.Cleanup(server.Close)
			var options []connect.ClientOption
			if protocol == "grpc-web" {
				options = append(options, connect.WithGRPCWeb())
			}
			loginClient := connect.NewClient[desktopv1.LoginRequest, desktopv1.LoginResponse](server.Client(), server.URL+desktopv1.DesktopService_Login_FullMethodName, options...)
			login, err := loginClient.CallUnary(t.Context(), connect.NewRequest(&desktopv1.LoginRequest{Username: "admin", Password: "password"}))
			if err != nil {
				t.Fatal(err)
			}
			listClient := connect.NewClient[desktopv1.ListSongsRequest, desktopv1.ListSongsResponse](server.Client(), server.URL+desktopv1.DesktopService_ListSongs_FullMethodName, options...)
			if _, err := listClient.CallUnary(t.Context(), connect.NewRequest(&desktopv1.ListSongsRequest{})); connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("anonymous request: %v", err)
			}
			listRequest := connect.NewRequest(&desktopv1.ListSongsRequest{Limit: 20})
			listRequest.Header().Set("Authorization", "Bearer "+login.Msg.GetSessionToken())
			list, err := listClient.CallUnary(t.Context(), listRequest)
			if err != nil || list.Msg.GetPage().GetTotal() != 1 {
				t.Fatalf("list = %v, %v", list, err)
			}
			favoriteClient := connect.NewClient[desktopv1.SetFavoriteRequest, desktopv1.SetFavoriteResponse](server.Client(), server.URL+desktopv1.DesktopService_SetFavorite_FullMethodName, options...)
			favoriteRequest := connect.NewRequest(&desktopv1.SetFavoriteRequest{Kind: desktopv1.FavoriteKind_FAVORITE_KIND_SONG, Id: int64(song.ID), Favorite: true})
			favoriteRequest.Header().Set("Authorization", "Bearer "+login.Msg.GetSessionToken())
			favorite, err := favoriteClient.CallUnary(t.Context(), favoriteRequest)
			if err != nil || !favorite.Msg.GetFavorite() {
				t.Fatalf("favorite = %v, %v", favorite, err)
			}
			mediaClient := connect.NewClient[desktopv1.StreamMediaRequest, desktopv1.StreamMediaResponse](server.Client(), server.URL+desktopv1.DesktopService_StreamMedia_FullMethodName, options...)
			mediaRequest := connect.NewRequest(&desktopv1.StreamMediaRequest{Kind: desktopv1.MediaKind_MEDIA_KIND_SONG_AUDIO, Id: int64(song.ID), Range: "bytes=2-5", Mode: "raw"})
			mediaRequest.Header().Set("Authorization", "Bearer "+login.Msg.GetSessionToken())
			stream, err := mediaClient.CallServerStream(t.Context(), mediaRequest)
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			if !stream.Receive() || stream.Msg().GetHeader().GetStatus() != 206 || stream.Msg().GetHeader().GetContentRange() != "bytes 2-5/10" {
				t.Fatalf("media header: %v, %v", stream.Msg(), stream.Err())
			}
			var body []byte
			for stream.Receive() {
				body = append(body, stream.Msg().GetData()...)
			}
			if stream.Err() != nil || string(body) != "2345" {
				t.Fatalf("media body = %q, %v", body, stream.Err())
			}
			service.desktopGRPCEnabled.Store(false)
			_, err = listClient.CallUnary(t.Context(), listRequest)
			if connect.CodeOf(err) != connect.CodeUnavailable {
				t.Fatalf("disabled service: %v", err)
			}
			health, err := server.Client().Get(server.URL + "/api/health")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = io.Copy(io.Discard, health.Body)
			_ = health.Body.Close()
			if health.StatusCode != http.StatusOK || requests.Load() < 6 {
				t.Fatalf("health=%d requests=%d", health.StatusCode, requests.Load())
			}
		})
	}
}
