package dlna

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Service struct {
	lib     Library
	options Options
	tokens  *TokenManager

	mu      sync.RWMutex
	devices map[string]rendererDevice
	outputs map[int]activeOutput

	httpClient httpClient
	now        func() time.Time

	runCancel context.CancelFunc
	runDone   chan struct{}
	baseURL   string
	serverURL string
}

type serviceOption func(*Service)

func WithTokenSecret(secret []byte) serviceOption {
	return func(s *Service) {
		s.tokens = NewTokenManager(secret, s.now)
	}
}

func NewService(lib Library, options Options, opts ...serviceOption) *Service {
	s := &Service{
		lib:        lib,
		options:    options,
		devices:    map[string]rendererDevice{},
		outputs:    map[int]activeOutput{},
		httpClient: defaultHTTPClient(),
		now:        time.Now,
	}
	s.tokens = NewTokenManager(nil, s.now)
	for _, opt := range opts {
		if opt != nil {
			opt(s)
		}
	}
	if s.tokens == nil {
		s.tokens = NewTokenManager(nil, s.now)
	}
	return s
}

func (s *Service) UpdateOptions(options Options) {
	if s == nil {
		return
	}
	s.mu.Lock()
	wasLibraryEnabled := s.options.LibraryEnabled
	s.options = options
	s.baseURL = strings.TrimRight(strings.TrimSpace(firstNonEmpty(options.MediaBaseURL, s.serverURL)), "/")
	isLibraryEnabled := s.options.LibraryEnabled
	s.mu.Unlock()
	if !wasLibraryEnabled && isLibraryEnabled {
		s.sendSSDPNotify("ssdp:alive")
	}
	if wasLibraryEnabled && !isLibraryEnabled {
		s.sendSSDPNotify("ssdp:byebye")
	}
}

func (s *Service) Status(userID int) Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	status := Status{
		CastEnabled:    s.options.CastEnabled,
		LibraryEnabled: s.options.LibraryEnabled,
		Output:         "local",
		State:          "idle",
	}
	if output, ok := s.outputs[userID]; ok && output.DeviceID != "" {
		status.Output = "dlna"
		status.DeviceID = output.DeviceID
		status.DeviceName = output.DeviceName
		status.State = output.State
	}
	return status
}

type httpClient interface {
	Do(req *http.Request) (*http.Response, error)
}

func defaultHTTPClient() httpClient {
	return &http.Client{Timeout: 8 * time.Second}
}

type rendererDevice struct {
	ID             string
	Name           string
	Manufacturer   string
	Model          string
	Location       string
	AVTransportURL string
	LastSeenAt     time.Time
}

type activeOutput struct {
	UserID     int
	DeviceID   string
	DeviceName string
	SongID     int
	State      string
	UpdatedAt  time.Time
}
