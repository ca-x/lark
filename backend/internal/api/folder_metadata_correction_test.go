package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/library"
	"lark/backend/internal/models"

	_ "github.com/lib-x/entsqlite"
)

func TestFolderMetadataCorrectionAPIRequiresAdminPreviewAndConfirmation(t *testing.T) {
	ctx := t.Context()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	libraryDir := t.TempDir()
	audioPath := filepath.Join(libraryDir, "Artist", "Album", "Track.flac")
	if err := os.MkdirAll(filepath.Dir(audioPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(audioPath, []byte("fixture"), 0o644); err != nil {
		t.Fatal(err)
	}
	service := library.New(client, t.TempDir(), libraryDir, "", "", nil, nil)
	if _, _, err := service.SetupAdmin(ctx, "admin", "password"); err != nil {
		t.Fatal(err)
	}
	artistItem, err := client.Artist.Create().SetName("Old Artist").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	albumItem, err := client.Album.Create().SetTitle("Album").SetArtist(artistItem).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Song.Create().SetTitle("Track").SetPath(audioPath).SetFileName(filepath.Base(audioPath)).SetArtist(artistItem).SetAlbum(albumItem).Save(ctx); err != nil {
		t.Fatal(err)
	}
	server := New(client, service, "*")

	previewBody := `{"path":"Artist","field":"artist","value":"New Artist","write_files":false,"update_database":true}`
	unauthorized := performFolderMetadataRequest(server, "/api/folders/metadata-correction/preview", previewBody, nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized preview status=%d body=%s", unauthorized.Code, unauthorized.Body.String())
	}

	login := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"admin","password":"password"}`))
	login.Header.Set("Content-Type", "application/json")
	loginResponse := httptest.NewRecorder()
	server.echo.ServeHTTP(loginResponse, login)
	if loginResponse.Code != http.StatusOK {
		t.Fatalf("login status=%d body=%s", loginResponse.Code, loginResponse.Body.String())
	}
	cookies := loginResponse.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("login did not return a session cookie")
	}

	previewResponse := performFolderMetadataRequest(server, "/api/folders/metadata-correction/preview", previewBody, cookies[0])
	if previewResponse.Code != http.StatusOK {
		t.Fatalf("preview status=%d body=%s", previewResponse.Code, previewResponse.Body.String())
	}
	var preview models.FolderMetadataCorrectionPreview
	if err := json.Unmarshal(previewResponse.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.SongCount != 1 || preview.FileCount != 1 || preview.Snapshot == "" {
		t.Fatalf("unexpected preview: %#v", preview)
	}

	unconfirmed := fmt.Sprintf(`{"path":"Artist","field":"artist","value":"New Artist","write_files":false,"update_database":true,"expected_song_count":1,"expected_file_count":1,"expected_snapshot":%q}`, preview.Snapshot)
	unconfirmedResponse := performFolderMetadataRequest(server, "/api/folders/metadata-correction", unconfirmed, cookies[0])
	if unconfirmedResponse.Code != http.StatusBadRequest {
		t.Fatalf("unconfirmed correction status=%d body=%s", unconfirmedResponse.Code, unconfirmedResponse.Body.String())
	}
	changedIntent := fmt.Sprintf(`{"path":"Artist","field":"album","value":"Unpreviewed Album","write_files":false,"update_database":true,"expected_song_count":1,"expected_file_count":1,"expected_snapshot":%q,"confirm":true}`, preview.Snapshot)
	changedIntentResponse := performFolderMetadataRequest(server, "/api/folders/metadata-correction", changedIntent, cookies[0])
	if changedIntentResponse.Code != http.StatusBadRequest {
		t.Fatalf("changed-intent correction status=%d body=%s", changedIntentResponse.Code, changedIntentResponse.Body.String())
	}

	confirmed := strings.TrimSuffix(unconfirmed, "}") + `,"confirm":true}`
	confirmedResponse := performFolderMetadataRequest(server, "/api/folders/metadata-correction", confirmed, cookies[0])
	if confirmedResponse.Code != http.StatusOK {
		t.Fatalf("confirmed correction status=%d body=%s", confirmedResponse.Code, confirmedResponse.Body.String())
	}
	var result models.FolderMetadataCorrectionResult
	if err := json.Unmarshal(confirmedResponse.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.DatabaseUpdated != 1 || result.Failed != 0 {
		t.Fatalf("unexpected correction result: %#v", result)
	}
}

func performFolderMetadataRequest(server *Server, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	server.echo.ServeHTTP(response, request)
	return response
}
