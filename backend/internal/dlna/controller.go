package dlna

import (
	"bytes"
	"context"
	"fmt"
	"html"
	"io"
	"net/http"
	"strings"
	"time"
)

const avTransportServiceType = "urn:schemas-upnp-org:service:AVTransport:1"

func (s *Service) PlaySong(ctx context.Context, userID int, deviceID string, songID int, host string) (Status, error) {
	if !s.options.CastEnabled {
		return s.Status(userID), ErrDisabled
	}
	device, err := s.renderer(deviceID)
	if err != nil {
		return s.Status(userID), err
	}
	song, err := s.lib.Song(ctx, userID, songID)
	if err != nil {
		return s.Status(userID), err
	}
	base := baseURLFromHost(host)
	audioURL, err := s.AudioURL(base, userID, songID, castMediaTokenTTL)
	if err != nil {
		return s.Status(userID), err
	}
	coverURL, _ := s.CoverURL(base, userID, songID, castMediaTokenTTL)
	metadata, err := BuildSongDIDL(song, MediaResource{
		AudioURL: audioURL,
		CoverURL: coverURL,
		Mime:     firstNonEmpty(song.Mime, mimeFromFormat(song.Format)),
		Size:     song.SizeBytes,
		BitRate:  song.BitRate,
		Duration: time.Duration(song.DurationSeconds * float64(time.Second)),
	})
	if err != nil {
		return s.Status(userID), err
	}
	if err := s.avTransport(ctx, device, "SetAVTransportURI", fmt.Sprintf(`<InstanceID>0</InstanceID><CurrentURI>%s</CurrentURI><CurrentURIMetaData>%s</CurrentURIMetaData>`, html.EscapeString(audioURL), html.EscapeString(metadata))); err != nil {
		return s.Status(userID), err
	}
	if err := s.avTransport(ctx, device, "Play", `<InstanceID>0</InstanceID><Speed>1</Speed>`); err != nil {
		return s.Status(userID), err
	}
	s.setOutput(userID, activeOutput{UserID: userID, DeviceID: device.ID, DeviceName: device.Name, SongID: songID, State: "playing", UpdatedAt: s.now()})
	return s.Status(userID), nil
}

func (s *Service) Pause(ctx context.Context, userID int, deviceID string) (Status, error) {
	return s.transportCommand(ctx, userID, deviceID, "Pause", "paused")
}

func (s *Service) Resume(ctx context.Context, userID int, deviceID string) (Status, error) {
	return s.transportCommand(ctx, userID, deviceID, "Play", "playing")
}

func (s *Service) Stop(ctx context.Context, userID int, deviceID string) (Status, error) {
	status, err := s.transportCommand(ctx, userID, deviceID, "Stop", "stopped")
	if err != nil {
		return status, err
	}
	s.mu.Lock()
	delete(s.outputs, userID)
	s.mu.Unlock()
	return s.Status(userID), nil
}

func (s *Service) Local(userID int) Status {
	s.mu.Lock()
	delete(s.outputs, userID)
	s.mu.Unlock()
	return s.Status(userID)
}

func (s *Service) transportCommand(ctx context.Context, userID int, deviceID string, action string, state string) (Status, error) {
	if !s.options.CastEnabled {
		return s.Status(userID), ErrDisabled
	}
	device, err := s.renderer(deviceID)
	if err != nil {
		return s.Status(userID), err
	}
	body := `<InstanceID>0</InstanceID>`
	if action == "Play" {
		body += `<Speed>1</Speed>`
	}
	if err := s.avTransport(ctx, device, action, body); err != nil {
		return s.Status(userID), err
	}
	s.mu.Lock()
	output := s.outputs[userID]
	output.UserID = userID
	output.DeviceID = device.ID
	output.DeviceName = device.Name
	output.State = state
	output.UpdatedAt = s.now()
	s.outputs[userID] = output
	s.mu.Unlock()
	return s.Status(userID), nil
}

func (s *Service) renderer(deviceID string) (rendererDevice, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	device, ok := s.devices[deviceID]
	if !ok || strings.TrimSpace(device.AVTransportURL) == "" {
		return rendererDevice{}, ErrDeviceNotFound
	}
	return device, nil
}

func (s *Service) setOutput(userID int, output activeOutput) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.outputs[userID] = output
}

func (s *Service) avTransport(ctx context.Context, device rendererDevice, action string, inner string) error {
	envelope := fmt.Sprintf(`<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:%s xmlns:u="%s">%s</u:%s></s:Body></s:Envelope>`, action, avTransportServiceType, inner, action)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, device.AVTransportURL, bytes.NewBufferString(envelope))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", `text/xml; charset="utf-8"`)
	req.Header.Set("SOAPACTION", `"`+avTransportServiceType+"#"+action+`"`)
	res, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrDeviceUnavailable, err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		return fmt.Errorf("%w: %s %s", ErrDeviceUnavailable, res.Status, strings.TrimSpace(string(data)))
	}
	return nil
}
