package library

import (
	"fmt"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/models"
)

func TestToasterStudioPreferenceIsOptInAndUserScoped(t *testing.T) {
	ctx := t.Context()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	for _, userID := range []int{71, 72} {
		preferences, err := service.GetUserPreferences(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		if preferences.ToasterStudioEnabled {
			t.Fatalf("studio must default off for user %d", userID)
		}
	}
	if err := service.setSetting(ctx, userPreferencesKey(73), `{"home_player_style":"cassette"}`); err != nil {
		t.Fatal(err)
	}
	legacy, err := service.GetUserPreferences(ctx, 73)
	if err != nil || legacy.ToasterStudioEnabled {
		t.Fatalf("legacy preferences must leave studio disabled: %#v, %v", legacy, err)
	}

	if _, err := service.SaveUserPreferences(ctx, 71, models.UserPreferences{ToasterStudioEnabled: true}); err != nil {
		t.Fatal(err)
	}
	loaded, err := service.GetUserPreferences(ctx, 71)
	if err != nil || !loaded.ToasterStudioEnabled {
		t.Fatalf("enabled studio did not persist: %#v, %v", loaded, err)
	}
	other, err := service.GetUserPreferences(ctx, 72)
	if err != nil || other.ToasterStudioEnabled {
		t.Fatalf("studio preference leaked to another user: %#v, %v", other, err)
	}
	if _, err := service.SaveUserPreferences(ctx, 71, models.UserPreferences{ToasterStudioEnabled: false}); err != nil {
		t.Fatal(err)
	}
	loaded, err = service.GetUserPreferences(ctx, 71)
	if err != nil || loaded.ToasterStudioEnabled {
		t.Fatalf("studio could not be disabled: %#v, %v", loaded, err)
	}
}
