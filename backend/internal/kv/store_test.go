package kv

import (
	"context"
	"testing"
	"time"
)

func TestMemoryStoreSetNXRespectsTTL(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()

	ok, err := store.SetNX(ctx, "lease", []byte("first"), 200*time.Millisecond)
	if err != nil || !ok {
		t.Fatalf("expected first SetNX to acquire lease, ok=%v err=%v", ok, err)
	}
	ok, err = store.SetNX(ctx, "lease", []byte("second"), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected live lease to reject second SetNX")
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		ok, err = store.SetNX(ctx, "lease", []byte("second"), time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if ok {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("expected expired lease to be acquirable")
}
