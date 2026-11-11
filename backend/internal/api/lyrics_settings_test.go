package api

import (
	"encoding/json/v2"
	"fmt"
	"net/http"
	"testing"
)

func TestOnlineLyricsSettingsPermissionsAndCompatibility(t *testing.T) {
	fixture := newSharingFixture(t)
	for _, enabled := range []bool{true, false, true} {
		response := performShareRequest(fixture.server, http.MethodPut, "/api/settings", fmt.Sprintf(`{"online_lyrics_enabled":%v}`, enabled), fixture.admin)
		if response.Code != http.StatusOK {
			t.Fatalf("save: %d %s", response.Code, response.Body)
		}
		response = performShareRequest(fixture.server, http.MethodPut, "/api/settings", `{"language":"zh-CN"}`, fixture.admin)
		if response.Code != http.StatusOK {
			t.Fatalf("legacy save: %d %s", response.Code, response.Body)
		}
		response = performShareRequest(fixture.server, http.MethodGet, "/api/settings", "", fixture.member)
		var settings map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &settings); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusOK || settings["online_lyrics_enabled"] != enabled {
			t.Fatalf("member settings lost capability/legacy value: %d %s", response.Code, response.Body)
		}
		if _, exists := settings["library_path"]; exists {
			t.Fatal("admin settings leaked")
		}
		response = performShareRequest(fixture.server, http.MethodPut, "/api/settings", `{"online_lyrics_enabled":false}`, fixture.member)
		if response.Code != http.StatusForbidden {
			t.Fatalf("member changed global switch: %d", response.Code)
		}
		if !enabled {
			path := fmt.Sprintf("/api/songs/%d/lyrics", fixture.songIDs[0])
			response = performShareRequest(fixture.server, http.MethodGet, path+"/candidates", "", fixture.member)
			if response.Code != http.StatusOK || response.Body.String() != "[]\n" {
				t.Fatalf("disabled candidates: %d %s", response.Code, response.Body)
			}
			response = performShareRequest(fixture.server, http.MethodPost, path+"/select", `{"source":"netease","id":"42"}`, fixture.member)
			if response.Code != http.StatusConflict {
				t.Fatalf("disabled selection: %d %s", response.Code, response.Body)
			}
			response = performShareRequest(fixture.server, http.MethodGet, path+"?source_id=netease:42", "", fixture.member)
			if response.Code != http.StatusConflict {
				t.Fatalf("disabled explicit fetch: %d %s", response.Code, response.Body)
			}
		}
	}
}
