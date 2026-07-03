package dlna

import (
	"testing"
	"time"
)

func TestTokenManagerValidatesPurposeSongAndExpiry(t *testing.T) {
	now := time.Date(2026, 7, 3, 10, 0, 0, 0, time.UTC)
	manager := NewTokenManager([]byte("test-secret"), func() time.Time { return now })

	token, err := manager.Issue(42, 7, PurposeAudio, time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	claims, err := manager.Validate(token, 42, PurposeAudio)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if claims.SongID != 42 || claims.UserID != 7 || claims.Purpose != PurposeAudio {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	if _, err := manager.Validate(token, 43, PurposeAudio); err == nil {
		t.Fatal("expected song mismatch to fail")
	}
	if _, err := manager.Validate(token, 42, PurposeCover); err == nil {
		t.Fatal("expected purpose mismatch to fail")
	}

	manager.now = func() time.Time { return now.Add(2 * time.Minute) }
	if _, err := manager.Validate(token, 42, PurposeAudio); err == nil {
		t.Fatal("expected expired token to fail")
	}
}
