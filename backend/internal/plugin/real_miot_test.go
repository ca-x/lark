package plugin

import (
	"context"
	"encoding/json/v2"
	"fmt"
	"net/http"
	"testing"

	"lark/backend/ent"
	"lark/backend/internal/library"
	"lark/backend/internal/plugin/larkhost"
)

func assertRealMiotFavorites(t *testing.T, ctx context.Context, client *ent.Client, manager *Manager) {
	t.Helper()
	service := library.New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	admin, _, err := service.SetupAdmin(ctx, "miot-fixture", "fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	manager.SetHost(larkhost.New(client, service, larkhost.Config{UserID: admin.ID}))
	ordinary, err := service.CreatePlaylist(ctx, admin.ID, "Keep this playlist", "", "")
	if err != nil || ordinary.ID != 1 {
		t.Fatalf("native playlist fixture=%+v %v", ordinary, err)
	}
	track := client.Song.Create().SetTitle("Miot favorite fixture").SetPath("/miot-fixture.flac").SetFileName("miot-fixture.flac").SaveX(ctx)
	check := func(action string, wanted bool) {
		t.Helper()
		request := HTTPRequest{Method: http.MethodGet, Path: "/player/favorite/status", Query: fmt.Sprintf("song_id=%d", track.ID), Headers: map[string]string{}}
		if action != "" {
			request = HTTPRequest{Method: http.MethodPost, Path: "/player/favorite/toggle", Headers: map[string]string{"Content-Type": "application/json"}, Body: fmt.Sprintf(`{"song_id":%d,"action":%q}`, track.ID, action)}
		}
		response, err := manager.InvokeHTTP(ctx, "miot", request)
		if err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Success bool `json:"success"`
			Data    struct {
				IsFavorited bool `json:"is_favorited"`
			} `json:"data"`
		}
		if err := json.Unmarshal([]byte(response.Body), &payload); err != nil || response.StatusCode != 200 || !payload.Success || payload.Data.IsFavorited != wanted {
			t.Fatalf("Miot %s=%+v body=%s err=%v", action, response, response.Body, err)
		}
		stored, err := service.Song(ctx, admin.ID, track.ID)
		if err != nil || stored.Favorite != wanted {
			t.Fatalf("Miot favorite not persisted: %+v %v", stored, err)
		}
	}
	check("", false)
	check("add", true)
	check("add", true)
	check("", true)
	check("remove", false)
	check("remove", false)
	check("", false)
	items, err := service.PlaylistSongs(ctx, admin.ID, ordinary.ID, 0)
	if err != nil || len(items) != 0 {
		t.Fatalf("Miot changed ordinary playlist: %+v %v", items, err)
	}
}
