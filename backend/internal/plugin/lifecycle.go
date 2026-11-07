package plugin

import (
	"context"
	"errors"
	"time"
)

func (m *Manager) Suspended() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.suspended || m.closed
}

func (m *Manager) Suspend(ctx context.Context) error {
	m.loadMu.Lock()
	defer m.loadMu.Unlock()
	m.mu.Lock()
	m.suspended = true
	services := m.services
	m.services = make(map[string]*Service)
	clear(m.lyrics)
	clear(m.covers)
	clear(m.playEvents)
	m.mu.Unlock()
	for _, service := range services {
		service.cancelContext()
		m.runtime.CancelRequests(service.envID)
		service.closeNetwork()
		service.closeWebSockets()
	}
	var failures []error
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	for _, service := range services {
		failures = append(failures, m.stopService(cleanupCtx, service))
	}
	return errors.Join(failures...)
}

func (m *Manager) Resume(ctx context.Context) error {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return errors.New("plugin manager is closed")
	}
	m.suspended = false
	m.mu.Unlock()
	return m.Start(ctx)
}

type Adapter struct{ Manager *Manager }

func (a Adapter) Resume(ctx context.Context) error  { return a.Manager.Resume(ctx) }
func (a Adapter) Suspend(ctx context.Context) error { return a.Manager.Suspend(ctx) }
func (a Adapter) Close(context.Context) error       { return a.Manager.Close() }
