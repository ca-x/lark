package api

import (
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/library"

	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
	_ "github.com/lib-x/entsqlite"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestDesktopGRPCLoginBrowseFavoriteAndRangeStream(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:desktop-grpc?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	t.Cleanup(func() { _ = client.Close() })
	libraryDir := t.TempDir()
	audioPath := filepath.Join(libraryDir, "fixture.mp3")
	if err := os.WriteFile(audioPath, []byte("0123456789"), 0o600); err != nil {
		t.Fatal(err)
	}
	lib := library.New(client, t.TempDir(), libraryDir, "", "", nil, nil)
	if _, _, err := lib.SetupAdmin(t.Context(), "admin", "password"); err != nil {
		t.Fatal(err)
	}
	item, err := client.Song.Create().SetTitle("Fixture").SetSourceType("local").SetPath(audioPath).
		SetFileName("fixture.mp3").SetFormat("mp3").SetSizeBytes(10).SetDurationSeconds(12).Save(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(New(client, lib, "*").desktopHandler())
	t.Cleanup(server.Close)
	conn, err := grpc.NewClient(strings.TrimPrefix(server.URL, "http://"), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	rpc := desktopv1.NewDesktopServiceClient(conn)
	info, err := rpc.GetServerInfo(t.Context(), &desktopv1.GetServerInfoRequest{})
	if err != nil || info.GetProtocolVersion() != desktopProtocolVersion || !info.GetInitialized() {
		t.Fatalf("info = %v, %v", info, err)
	}
	if _, err := rpc.ListSongs(t.Context(), &desktopv1.ListSongsRequest{Limit: 20}); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("anonymous list error = %v", err)
	}
	login, err := rpc.Login(t.Context(), &desktopv1.LoginRequest{Username: "admin", Password: "password"})
	if err != nil || login.GetSessionToken() == "" {
		t.Fatalf("login = %v, %v", login, err)
	}
	ctx := metadata.AppendToOutgoingContext(t.Context(), "authorization", "Bearer "+login.GetSessionToken())
	page, err := rpc.ListSongs(ctx, &desktopv1.ListSongsRequest{Limit: 20})
	if err != nil || page.GetPage().GetTotal() != 1 || page.GetPage().GetItems()[0].GetId() != int64(item.ID) {
		t.Fatalf("songs = %v, %v", page, err)
	}
	favorite, err := rpc.SetFavorite(ctx, &desktopv1.SetFavoriteRequest{Kind: desktopv1.FavoriteKind_FAVORITE_KIND_SONG, Id: int64(item.ID), Favorite: true})
	if err != nil || !favorite.GetFavorite() {
		t.Fatalf("favorite = %v, %v", favorite, err)
	}
	favorite, err = rpc.SetFavorite(ctx, &desktopv1.SetFavoriteRequest{Kind: desktopv1.FavoriteKind_FAVORITE_KIND_SONG, Id: int64(item.ID), Favorite: true})
	if err != nil || !favorite.GetFavorite() {
		t.Fatalf("repeated favorite = %v, %v", favorite, err)
	}
	media, err := rpc.StreamMedia(ctx, &desktopv1.StreamMediaRequest{Kind: desktopv1.MediaKind_MEDIA_KIND_SONG_AUDIO, Id: int64(item.ID), Range: "bytes=2-5", Mode: "raw"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := media.Recv()
	if err != nil || first.GetHeader().GetStatus() != 206 || first.GetHeader().GetContentRange() != "bytes 2-5/10" {
		t.Fatalf("media header = %v, %v", first, err)
	}
	var body []byte
	for {
		part, err := media.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		body = append(body, part.GetData()...)
	}
	if string(body) != "2345" {
		t.Fatalf("media body = %q", body)
	}
}
