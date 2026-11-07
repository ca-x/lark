package pluginapp

import (
	"context"
	"errors"
	"testing"
)

type memoryStore struct {
	values map[string][]byte
	fail   bool
}

func (s *memoryStore) Get(_ context.Context, key string) ([]byte, error) { return s.values[key], nil }
func (s *memoryStore) Put(_ context.Context, key string, value []byte) error {
	if s.fail {
		return errors.New("unavailable")
	}
	s.values[key] = value
	return nil
}

type lifecycleFixture struct {
	suspended  bool
	closed     bool
	cleanupErr error
}

func (f *lifecycleFixture) Resume(context.Context) error {
	if f.closed {
		return errors.New("closed")
	}
	f.suspended = false
	return nil
}
func (f *lifecycleFixture) Suspend(context.Context) error { f.suspended = true; return f.cleanupErr }
func (f *lifecycleFixture) Close(context.Context) error   { f.closed = true; return nil }

func TestIndependentSwitchesAndPersistence(t *testing.T) {
	store := &memoryStore{values: map[string][]byte{}}
	songloft, mygo := &lifecycleFixture{}, &lifecycleFixture{}
	service := New(store, songloft, mygo)
	if err := service.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	if songloft.suspended || !mygo.suspended {
		t.Fatal("incorrect defaults")
	}
	for _, state := range []State{{false, false}, {false, true}, {true, true}, {true, false}} {
		if err := service.Set(t.Context(), state); err != nil {
			t.Fatal(err)
		}
		if service.State() != state || songloft.suspended == state.Songloft || mygo.suspended == state.MyGo {
			t.Fatalf("incorrect state: %+v", state)
		}
	}
	restored := New(store, &lifecycleFixture{}, &lifecycleFixture{})
	if err := restored.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	if restored.State() != service.State() {
		t.Fatal("state not persisted")
	}
	store.fail = true
	if err := service.Set(t.Context(), State{false, true}); err == nil {
		t.Fatal("expected storage failure")
	}
	if service.State() != (State{true, false}) || songloft.suspended || !mygo.suspended {
		t.Fatal("failed save changed effective state")
	}
}

func TestCleanupFailureCannotReenableEcosystem(t *testing.T) {
	store := &memoryStore{values: map[string][]byte{}}
	songloft := &lifecycleFixture{cleanupErr: errors.New("onDeinit failed")}
	service := New(store, songloft, &lifecycleFixture{})
	if err := service.Set(t.Context(), State{}); err == nil {
		t.Fatal("cleanup failure was hidden")
	}
	if !songloft.suspended || service.State().Songloft {
		t.Fatal("cleanup failure reenabled disabled ecosystem")
	}
	restored := New(store, &lifecycleFixture{}, &lifecycleFixture{})
	if err := restored.Start(t.Context()); err != nil || restored.State().Songloft {
		t.Fatalf("disable not persisted: %v", err)
	}
}

func TestIndependentPatchesDoNotOverwriteOtherSwitch(t *testing.T) {
	service := New(&memoryStore{values: map[string][]byte{}}, &lifecycleFixture{}, &lifecycleFixture{})
	if err := service.Patch(t.Context(), Patch{Songloft: new(false)}); err != nil {
		t.Fatal(err)
	}
	if err := service.Patch(t.Context(), Patch{MyGo: new(true)}); err != nil {
		t.Fatal(err)
	}
	if service.State() != (State{false, true}) {
		t.Fatal("independent patch overwrote another switch")
	}
}
