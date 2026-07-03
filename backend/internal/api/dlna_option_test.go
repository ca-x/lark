package api

import (
	"testing"

	"lark/backend/internal/models"
)

func TestApplyDLNAOptionPolicyHidesAndDisablesDLNA(t *testing.T) {
	server := &Server{noDLNAOption: true}
	settings := server.applyDLNAOptionPolicy(models.Settings{
		DLNACastEnabled:    true,
		DLNALibraryEnabled: true,
		DLNAServerName:     "Living Room",
		DLNAMediaBaseURL:   "http://192.168.1.8:8080",
	})

	if settings.DLNACastEnabled || settings.DLNALibraryEnabled {
		t.Fatalf("expected dlna switches forced off, got %+v", settings)
	}
	if !settings.NoDLNAOption {
		t.Fatal("expected no_dlna_option to be exposed")
	}
	if settings.DLNAServerName != "Living Room" || settings.DLNAMediaBaseURL == "" {
		t.Fatalf("expected dlna text settings to be preserved, got %+v", settings)
	}
}

func TestApplyDLNAOptionPolicyLeavesSettingsWhenVisible(t *testing.T) {
	server := &Server{}
	settings := server.applyDLNAOptionPolicy(models.Settings{DLNACastEnabled: true, DLNALibraryEnabled: true})
	if !settings.DLNACastEnabled || !settings.DLNALibraryEnabled || settings.NoDLNAOption {
		t.Fatalf("expected dlna settings unchanged, got %+v", settings)
	}
}
