package api

import (
	"encoding/json/v2"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/library"
	"lark/backend/internal/models"

	_ "github.com/lib-x/entsqlite"
)

func TestToasterPreferenceAPIKeepsOmittedFlagAndAcceptsFalse(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := library.New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	if _, _, err := service.SetupAdmin(t.Context(), "admin", "toaster-test-password"); err != nil {
		t.Fatal(err)
	}
	server := New(client, service, "*")
	login := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"admin","password":"toaster-test-password"}`))
	login.Header.Set("Content-Type", "application/json")
	loginResponse := httptest.NewRecorder()
	server.echo.ServeHTTP(loginResponse, login)
	if loginResponse.Code != http.StatusOK {
		t.Fatalf("login status=%d", loginResponse.Code)
	}
	cookies := loginResponse.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("missing authenticated session")
	}

	for _, check := range []struct {
		name string
		body string
		want bool
	}{
		{"enable", `{"toaster_studio_enabled":true}`, true},
		{"legacy-client-keeps-enabled", `{"home_player_style":"vinyl"}`, true},
		{"disable", `{"toaster_studio_enabled":false}`, false},
		{"legacy-client-keeps-disabled", `{}`, false},
	} {
		t.Run(check.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPut, "/api/me/preferences", strings.NewReader(check.body))
			request.Header.Set("Content-Type", "application/json")
			request.AddCookie(cookies[0])
			response := httptest.NewRecorder()
			server.echo.ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("save preferences status=%d body=%s", response.Code, response.Body.String())
			}
			var preferences models.UserPreferences
			if err := json.Unmarshal(response.Body.Bytes(), &preferences); err != nil {
				t.Fatal(err)
			}
			if preferences.ToasterStudioEnabled != check.want {
				t.Fatalf("studio enabled=%v, want %v", preferences.ToasterStudioEnabled, check.want)
			}
		})
	}
}
