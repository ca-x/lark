package dlna

import (
	"bufio"
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	ssdpMulticastAddr = "239.255.255.250:1900"
	ssdpMaxAge        = 1800
	deviceStaleAfter  = 10 * time.Minute
)

func (s *Service) Start(ctx context.Context, baseURL string) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	if s.runCancel != nil {
		s.mu.Unlock()
		return nil
	}
	runCtx, cancel := context.WithCancel(ctx)
	s.runCancel = cancel
	s.runDone = make(chan struct{})
	s.baseURL = strings.TrimRight(strings.TrimSpace(firstNonEmpty(s.options.MediaBaseURL, baseURL)), "/")
	s.mu.Unlock()

	go func() {
		defer close(s.runDone)
		s.ssdpNotifyLoop(runCtx)
	}()
	return nil
}

func (s *Service) Shutdown(ctx context.Context) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	cancel := s.runCancel
	done := s.runDone
	s.runCancel = nil
	s.runDone = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done == nil {
		return nil
	}
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) Discover(ctx context.Context) ([]Device, error) {
	if s == nil {
		return []Device{}, nil
	}
	options := s.snapshotOptions()
	if !options.CastEnabled {
		return []Device{}, nil
	}
	conn, err := net.ListenPacket("udp4", ":0")
	if err != nil {
		return s.Devices(), err
	}
	defer conn.Close()
	target, err := net.ResolveUDPAddr("udp4", ssdpMulticastAddr)
	if err != nil {
		return s.Devices(), err
	}
	searches := []string{"urn:schemas-upnp-org:device:MediaRenderer:1", "ssdp:all"}
	for _, st := range searches {
		_, _ = conn.WriteTo([]byte(mSearchMessage(st)), target)
	}
	deadline := time.Now().Add(3 * time.Second)
	if dl, ok := ctx.Deadline(); ok && dl.Before(deadline) {
		deadline = dl
	}
	_ = conn.SetDeadline(deadline)
	buf := make([]byte, 16<<10)
	for {
		n, _, err := conn.ReadFrom(buf)
		if err != nil {
			break
		}
		location := ssdpHeader(buf[:n], "location")
		if location == "" {
			continue
		}
		device, err := s.fetchRendererDescription(ctx, location)
		if err != nil {
			continue
		}
		s.mu.Lock()
		s.devices[device.ID] = device
		s.mu.Unlock()
	}
	return s.Devices(), nil
}

func (s *Service) Devices() []Device {
	s.mu.RLock()
	defer s.mu.RUnlock()
	now := s.now()
	out := make([]Device, 0, len(s.devices))
	for _, device := range s.devices {
		state := DeviceAvailable
		if now.Sub(device.LastSeenAt) > deviceStaleAfter {
			state = DeviceUnavailable
		}
		out = append(out, Device{
			ID:           device.ID,
			Name:         device.Name,
			Protocol:     "DLNA",
			State:        state,
			Manufacturer: device.Manufacturer,
			Model:        device.Model,
			LastSeenAt:   device.LastSeenAt,
		})
	}
	return out
}

func (s *Service) fetchRendererDescription(ctx context.Context, location string) (rendererDevice, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, location, nil)
	if err != nil {
		return rendererDevice{}, err
	}
	res, err := s.httpClient.Do(req)
	if err != nil {
		return rendererDevice{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return rendererDevice{}, fmt.Errorf("device description status %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return rendererDevice{}, err
	}
	device, err := parseDeviceDescription(location, data)
	if err != nil {
		return rendererDevice{}, err
	}
	device.LastSeenAt = s.now()
	return device, nil
}

func parseDeviceDescription(base string, data []byte) (rendererDevice, error) {
	var root deviceDescription
	if err := xml.Unmarshal(data, &root); err != nil {
		return rendererDevice{}, err
	}
	device := root.Device
	if !strings.Contains(device.DeviceType, "MediaRenderer") && device.AVTransportControlURL() == "" {
		return rendererDevice{}, fmt.Errorf("not a media renderer")
	}
	id := strings.TrimSpace(device.UDN)
	if id == "" {
		id = deviceUUID(device.FriendlyName + base)
	}
	out := rendererDevice{
		ID:           id,
		Name:         defaultString(strings.TrimSpace(device.FriendlyName), "DLNA Renderer"),
		Manufacturer: strings.TrimSpace(device.Manufacturer),
		Model:        strings.TrimSpace(device.ModelName),
		Location:     base,
		LastSeenAt:   time.Now(),
	}
	control := device.AVTransportControlURL()
	if control == "" {
		return rendererDevice{}, fmt.Errorf("renderer has no AVTransport control URL")
	}
	out.AVTransportURL = resolveURL(base, control)
	return out, nil
}

func resolveURL(base, ref string) string {
	refURL, err := url.Parse(strings.TrimSpace(ref))
	if err != nil {
		return ref
	}
	baseURL, err := url.Parse(strings.TrimSpace(base))
	if err != nil {
		return ref
	}
	return baseURL.ResolveReference(refURL).String()
}

type deviceDescription struct {
	Device describedDevice `xml:"device"`
}

type describedDevice struct {
	DeviceType   string             `xml:"deviceType"`
	FriendlyName string             `xml:"friendlyName"`
	Manufacturer string             `xml:"manufacturer"`
	ModelName    string             `xml:"modelName"`
	UDN          string             `xml:"UDN"`
	Services     []describedService `xml:"serviceList>service"`
}

func (d describedDevice) AVTransportControlURL() string {
	for _, service := range d.Services {
		if strings.Contains(service.ServiceType, "AVTransport") {
			return strings.TrimSpace(service.ControlURL)
		}
	}
	return ""
}

type describedService struct {
	ServiceType string `xml:"serviceType"`
	ControlURL  string `xml:"controlURL"`
}

func mSearchMessage(st string) string {
	return strings.Join([]string{
		"M-SEARCH * HTTP/1.1",
		"HOST: " + ssdpMulticastAddr,
		`MAN: "ssdp:discover"`,
		"MX: 2",
		"ST: " + st,
		"", "",
	}, "\r\n")
}

func ssdpHeader(data []byte, name string) string {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	prefix := strings.ToLower(name) + ":"
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(strings.ToLower(line), prefix) {
			return strings.TrimSpace(line[len(prefix):])
		}
	}
	return ""
}

func (s *Service) ssdpNotifyLoop(ctx context.Context) {
	if s.snapshotOptions().LibraryEnabled {
		s.sendSSDPNotify("ssdp:alive")
	}
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			if s.snapshotOptions().LibraryEnabled {
				s.sendSSDPNotify("ssdp:byebye")
			}
			return
		case <-ticker.C:
			if s.snapshotOptions().LibraryEnabled {
				s.sendSSDPNotify("ssdp:alive")
			}
		}
	}
}

func (s *Service) sendSSDPNotify(nts string) {
	options, base := s.snapshotOptionsAndBase()
	if base == "" || (!options.LibraryEnabled && nts != "ssdp:byebye") {
		return
	}
	conn, err := net.Dial("udp4", ssdpMulticastAddr)
	if err != nil {
		return
	}
	defer conn.Close()
	location := strings.TrimRight(base, "/") + "/dlna/rootDesc.xml"
	usn := "uuid:" + deviceUUID(defaultString(options.ServerName, "Lark"))
	targets := []string{
		"upnp:rootdevice",
		"urn:schemas-upnp-org:device:MediaServer:1",
		contentDirectoryServiceType,
		connectionManagerServiceType,
	}
	for _, nt := range targets {
		msg := fmt.Sprintf("NOTIFY * HTTP/1.1\r\nHOST: %s\r\nCACHE-CONTROL: max-age=%d\r\nLOCATION: %s\r\nNT: %s\r\nNTS: %s\r\nSERVER: Lark/1.0 UPnP/1.0 DLNADOC/1.50\r\nUSN: %s::%s\r\n\r\n", ssdpMulticastAddr, ssdpMaxAge, location, nt, nts, usn, nt)
		_, _ = conn.Write([]byte(msg))
	}
}

func (s *Service) snapshotOptions() Options {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.options
}

func (s *Service) snapshotOptionsAndBase() (Options, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.options, s.baseURL
}
