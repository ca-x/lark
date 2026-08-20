package plugin

import (
	"strings"
	"testing"
)

func TestValidatePluginHTTPResponseRejectsUnsafeValues(t *testing.T) {
	tests := []HTTPResponse{
		{StatusCode: 999, Headers: map[string]string{}, Body: ""},
		{StatusCode: 200, Headers: map[string]string{"X-Bad": "ok\r\nInjected: yes"}, Body: ""},
		{StatusCode: 200, Headers: map[string]string{"Connection": "keep-alive"}, Body: ""},
		{StatusCode: 200, Headers: map[string]string{}, Body: strings.Repeat("x", maxPluginHTTPResponseBodyBytes+1)},
	}
	for _, response := range tests {
		if err := validatePluginHTTPResponse(response); err == nil {
			t.Fatalf("response unexpectedly accepted: status=%d headers=%v bodyBytes=%d", response.StatusCode, response.Headers, len(response.Body))
		}
	}
}

func TestValidateManifestRequiresAbsoluteExternalPaths(t *testing.T) {
	manifest := validManifest("external-path")
	manifest.ExternalPaths = []string{"relative/path"}
	if err := ValidateManifest(manifest); err == nil || !strings.Contains(err.Error(), "canonical absolute path") {
		t.Fatalf("ValidateManifest error = %v", err)
	}
}
