package kv

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestMemoryStoreSetNXRespectsTTL(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	defer store.Close()

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

func TestMemoryStoreCloseIsConcurrentSafe(t *testing.T) {
	store := NewMemoryStore()
	var wg sync.WaitGroup
	for range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 16 {
				if err := store.Close(); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	wg.Wait()
}
