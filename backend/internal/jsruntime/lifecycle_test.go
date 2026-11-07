package jsruntime

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCancelEnvRequestsStopsInflightFetch(t *testing.T) {
	started, stopped := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		close(started)
		<-request.Context().Done()
		close(stopped)
	}))
	defer server.Close()
	manager := NewJSEnvManager()
	defer manager.Close()
	if err := manager.CreateEnv("cancel-fetch", fmt.Sprintf(`fetch(%q).catch(() => {});`, server.URL), 1); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("request did not start")
	}
	manager.CancelRequests("cancel-fetch")
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("environment cancellation did not stop HTTP request")
	}
}
