package jsruntime

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchURLSearchParamsPreservesSpaces(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte(request.URL.Query().Get("artist_name")))
	}))
	t.Cleanup(server.Close)

	result := runFetchProbe(t, "url-search-params-space", fmt.Sprintf(`
		var params = new URLSearchParams();
		params.set('artist_name', 'John Lennon');
		fetch(%q + '/api/get?' + params.toString()).then(function(response) {
			return response.text();
		}).then(function(value) {
			__out = value;
		}).catch(function(error) {
			__out = 'error:' + String(error);
		});
	`, server.URL))
	if result != "John Lennon" {
		t.Fatalf("decoded artist_name = %q, want %q", result, "John Lennon")
	}
}
