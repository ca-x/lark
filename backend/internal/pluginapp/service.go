package pluginapp

import (
	"context"
	"encoding/json/v2"
	"errors"
	"sync"
)

type Store interface {
	Get(context.Context, string) ([]byte, error)
	Put(context.Context, string, []byte) error
}

type Lifecycle interface {
	Resume(context.Context) error
	Suspend(context.Context) error
	Close(context.Context) error
}

type State struct {
	Songloft bool `json:"songloft"`
	MyGo     bool `json:"mygo"`
}

type Patch struct {
	Songloft *bool `json:"songloft"`
	MyGo     *bool `json:"mygo"`
}

type Status struct {
	State
	Degraded string `json:"degraded,omitempty"`
}

type Service struct {
	mu       sync.Mutex
	store    Store
	songloft Lifecycle
	mygo     Lifecycle
	state    State
	degraded string
}

func New(store Store, songloft, mygo Lifecycle) *Service {
	return &Service{store: store, songloft: songloft, mygo: mygo, state: State{Songloft: true}}
}

func (s *Service) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.store.Get(ctx, "plugin-platform-v1")
	if err != nil {
		return err
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &s.state); err != nil {
			return err
		}
	}
	return s.applyState(ctx, s.state)
}

func (s *Service) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Status{State: s.state, Degraded: s.degraded}
}

func (s *Service) applyState(ctx context.Context, state State) error {
	err := s.apply(ctx, state)
	s.degraded = ""
	if err != nil {
		s.degraded = err.Error()
	}
	return err
}

func (s *Service) apply(ctx context.Context, state State) error {
	var failures []error
	for _, item := range []struct {
		enabled bool
		adapter Lifecycle
	}{{state.Songloft, s.songloft}, {state.MyGo, s.mygo}} {
		if item.enabled {
			failures = append(failures, item.adapter.Resume(ctx))
		} else {
			failures = append(failures, item.adapter.Suspend(ctx))
		}
	}
	return errors.Join(failures...)
}

func (s *Service) Set(ctx context.Context, next State) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.setLocked(ctx, next)
}

func (s *Service) Patch(ctx context.Context, patch Patch) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.state
	if patch.Songloft != nil {
		next.Songloft = *patch.Songloft
	}
	if patch.MyGo != nil {
		next.MyGo = *patch.MyGo
	}
	return s.setLocked(ctx, next)
}

func (s *Service) setLocked(ctx context.Context, next State) error {
	data, err := json.Marshal(next)
	if err == nil {
		err = s.store.Put(ctx, "plugin-platform-v1", data)
	}
	if err != nil {
		return err
	}
	s.state = next
	return s.applyState(context.WithoutCancel(ctx), next)
}

func (s *Service) Close(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return errors.Join(s.mygo.Close(ctx), s.songloft.Close(ctx))
}
