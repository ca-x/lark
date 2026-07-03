package dlna

import "testing"

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
