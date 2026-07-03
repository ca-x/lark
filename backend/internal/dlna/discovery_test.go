package dlna

import (
	"context"
	"testing"
	"time"
)

func TestParseRendererDeviceDescription(t *testing.T) {
	xmlData := []byte(`<?xml version="1.0"?>
<root>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>Living Room TV</friendlyName>
    <manufacturer>Acme</manufacturer>
    <modelName>Renderer</modelName>
    <UDN>uuid:abc</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/upnp/control/avtransport1</controlURL>
      </service>
    </serviceList>
  </device>
</root>`)
	device, err := parseDeviceDescription("http://192.168.1.30:1400/device.xml", xmlData)
	if err != nil {
		t.Fatalf("parseDeviceDescription: %v", err)
	}
	if device.ID != "uuid:abc" || device.Name != "Living Room TV" || device.AVTransportURL != "http://192.168.1.30:1400/upnp/control/avtransport1" {
		t.Fatalf("unexpected device: %+v", device)
	}
}

func TestUpdateOptionsRefreshesBaseURL(t *testing.T) {
	service := NewService(fakeLibrary{}, Options{CastEnabled: true})
	if err := service.Start(context.Background(), "http://10.0.0.2:8080"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := service.Shutdown(ctx); err != nil {
			t.Fatalf("Shutdown: %v", err)
		}
	}()

	service.UpdateOptions(Options{CastEnabled: true, MediaBaseURL: "http://192.168.1.8:8080/"})
	if service.baseURL != "http://192.168.1.8:8080" {
		t.Fatalf("expected media base URL, got %q", service.baseURL)
	}

	service.UpdateOptions(Options{CastEnabled: true})
	if service.baseURL != "http://10.0.0.2:8080" {
		t.Fatalf("expected server base URL fallback, got %q", service.baseURL)
	}
}
