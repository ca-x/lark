package mygo

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTopicCatalogPaginationAndCache(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests++
		if request.URL.Query().Get("q") != "topic:mygo-music-plugin archived:false" {
			t.Error("incorrect topic query")
		}
		if request.URL.Query().Get("page") == "2" {
			fmt.Fprint(writer, `{"total_count":101,"items":[{"full_name":"owner/last","name":"Last"}]}`)
			return
		}
		fmt.Fprint(writer, `{"total_count":101,"items":[`)
		for index := range 100 {
			if index > 0 {
				fmt.Fprint(writer, ",")
			}
			fmt.Fprintf(writer, `{"full_name":"owner/plugin%d","name":"Plugin"}`, index)
		}
		fmt.Fprint(writer, `]}`)
	}))
	defer server.Close()
	catalog := NewCatalog(server.Client())
	catalog.baseURL = server.URL
	for range 2 {
		entries, err := catalog.Search(t.Context())
		if err != nil || len(entries) != 101 {
			t.Fatalf("catalog entries: %d %v", len(entries), err)
		}
	}
	if requests != 2 {
		t.Fatalf("requests = %d", requests)
	}
	if catalog.Status().UpdatedAt.IsZero() {
		t.Fatal("cache freshness unavailable")
	}
}
