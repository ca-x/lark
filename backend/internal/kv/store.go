package kv

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

var ErrNotFound = errors.New("kv: key not found")

type Store interface {
	Get(ctx context.Context, key string) ([]byte, bool, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error)
	Delete(ctx context.Context, key string) error
	DeletePrefix(ctx context.Context, prefix string) error
	Close() error
}

type entry struct {
	value     []byte
	expiresAt time.Time
}

type MemoryStore struct {
	mu     sync.RWMutex
	values map[string]entry
	stopCh chan struct{}
}

func NewMemoryStore() *MemoryStore {
	s := &MemoryStore{values: make(map[string]entry), stopCh: make(chan struct{})}
	go s.cleanupLoop()
	return s
}

func (s *MemoryStore) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.cleanExpired()
		case <-s.stopCh:
			return
		}
	}
}

func (s *MemoryStore) cleanExpired() {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, item := range s.values {
		if !item.expiresAt.IsZero() && now.After(item.expiresAt) {
			delete(s.values, key)
		}
	}
}

func (s *MemoryStore) Get(ctx context.Context, key string) ([]byte, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	s.mu.RLock()
	item, ok := s.values[key]
	s.mu.RUnlock()
	if !ok {
		return nil, false, nil
	}
	if !item.expiresAt.IsZero() && time.Now().After(item.expiresAt) {
		_ = s.Delete(ctx, key)
		return nil, false, nil
	}
	value := append([]byte(nil), item.value...)
	return value, true, nil
}

func (s *MemoryStore) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	item := entry{value: append([]byte(nil), value...)}
	if ttl > 0 {
		item.expiresAt = time.Now().Add(ttl)
	}
	s.mu.Lock()
	s.values[key] = item
	s.mu.Unlock()
	return nil
}

func (s *MemoryStore) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	item := entry{value: append([]byte(nil), value...)}
	if ttl > 0 {
		item.expiresAt = time.Now().Add(ttl)
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.values[key]; ok {
		if existing.expiresAt.IsZero() || now.Before(existing.expiresAt) {
			return false, nil
		}
	}
	s.values[key] = item
	return true, nil
}

func (s *MemoryStore) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	delete(s.values, key)
	s.mu.Unlock()
	return nil
}

func (s *MemoryStore) DeletePrefix(ctx context.Context, prefix string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	for key := range s.values {
		if strings.HasPrefix(key, prefix) {
			delete(s.values, key)
		}
	}
	s.mu.Unlock()
	return nil
}

func (s *MemoryStore) Close() error {
	select {
	case <-s.stopCh:
	default:
		close(s.stopCh)
	}
	return nil
}

type NoopStore struct{}

func (NoopStore) Get(context.Context, string) ([]byte, bool, error)        { return nil, false, nil }
func (NoopStore) Set(context.Context, string, []byte, time.Duration) error { return nil }
func (NoopStore) SetNX(context.Context, string, []byte, time.Duration) (bool, error) {
	return true, nil
}
func (NoopStore) Delete(context.Context, string) error       { return nil }
func (NoopStore) DeletePrefix(context.Context, string) error { return nil }
func (NoopStore) Close() error                               { return nil }
