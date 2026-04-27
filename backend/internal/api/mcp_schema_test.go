package api

import "testing"

func TestBuildMCPServerRegistersTools(t *testing.T) {
	server := (&Server{}).buildMCPServer(1)
	if server == nil {
		t.Fatal("expected MCP server")
	}
}

func TestTranscodeQualityClampsForWeakNetworkProfiles(t *testing.T) {
	quality, err := transcodeQuality("64")
	if err != nil {
		t.Fatal(err)
	}
	if quality != 96 {
		t.Fatalf("expected low quality to clamp to 96, got %d", quality)
	}
	quality, err = transcodeQuality("999")
	if err != nil {
		t.Fatal(err)
	}
	if quality != 320 {
		t.Fatalf("expected high quality to clamp to 320, got %d", quality)
	}
	quality, err = transcodeQuality("128")
	if err != nil {
		t.Fatal(err)
	}
	if quality != 128 {
		t.Fatalf("expected 128 to pass through, got %d", quality)
	}
}

func TestTranscodeQualityRejectsInvalidInput(t *testing.T) {
	if _, err := transcodeQuality("bad"); err == nil {
		t.Fatal("expected invalid quality to fail")
	}
}
