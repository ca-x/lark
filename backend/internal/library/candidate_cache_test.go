package library

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"lark/backend/ent/enttest"

	_ "github.com/lib-x/entsqlite"
)

func TestCandidateCacheLifecycle(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	now := time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	service := &Service{client: client, candidateNow: func() time.Time { return now }}
	request := CandidateCacheRequest{UserID: 1, TargetType: "song", TargetID: 7, Kind: candidateQueryKindLyrics, Snapshot: "song snapshot", TTL: 24 * time.Hour}
	calls := 0
	loader := func(context.Context) ([]byte, error) { calls++; return []byte("[]"), nil }
	first, err := service.loadCandidateJSON(ctx, request, loader)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.loadCandidateJSON(ctx, request, loader)
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != "[]" || string(second) != "[]" || calls != 1 {
		t.Fatalf("first=%s second=%s calls=%d", first, second, calls)
	}

	request.Refresh = true
	refreshed, err := service.loadCandidateJSON(ctx, request, func(context.Context) ([]byte, error) { calls++; return []byte(`[1]`), nil })
	if err != nil {
		t.Fatal(err)
	}
	if string(refreshed) != `[1]` || calls != 2 {
		t.Fatalf("refresh=%s calls=%d", refreshed, calls)
	}
	if _, err := service.loadCandidateJSON(ctx, request, func(context.Context) ([]byte, error) { return nil, errors.New("offline") }); err == nil {
		t.Fatal("expected refresh error")
	}
	request.Refresh = false
	kept, err := service.loadCandidateJSON(ctx, request, loader)
	if err != nil {
		t.Fatal(err)
	}
	if string(kept) != `[1]` {
		t.Fatalf("failed refresh cleared cached result: %s", kept)
	}

	now = now.Add(25 * time.Hour)
	_, err = service.loadCandidateJSON(ctx, request, loader)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("expired cache calls=%d", calls)
	}
}

func TestCandidateCacheCollapsesConcurrentLoadsAndIsolatesUsers(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}
	request := CandidateCacheRequest{UserID: 1, TargetType: "song", TargetID: 9, Kind: candidateQueryKindMetadataOnline, Snapshot: "snapshot", TTL: time.Hour}
	var calls atomic.Int32
	ready := make(chan struct{})
	loader := func(context.Context) ([]byte, error) { calls.Add(1); <-ready; return []byte(`["ok"]`), nil }
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := service.loadCandidateJSON(ctx, request, loader); err != nil {
				t.Error(err)
			}
		}()
	}
	for calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	close(ready)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("calls=%d", calls.Load())
	}
	request.UserID = 2
	if _, err := service.loadCandidateJSON(ctx, request, func(context.Context) ([]byte, error) { calls.Add(1); return []byte(`["other"]`), nil }); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("user cache was not isolated, calls=%d", calls.Load())
	}
}
