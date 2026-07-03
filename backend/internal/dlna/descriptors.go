package dlna

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"html"
	"net/http"
	"strings"
)

const (
	contentDirectoryServiceType  = "urn:schemas-upnp-org:service:ContentDirectory:1"
	connectionManagerServiceType = "urn:schemas-upnp-org:service:ConnectionManager:1"
	mediaReceiverRegistrarType   = "urn:microsoft.com:service:X_MS_MediaReceiverRegistrar:1"
)

func (s *Service) handleRootDescription(w http.ResponseWriter, r *http.Request) {
	if !s.options.LibraryEnabled {
		http.Error(w, "dlna library is disabled", http.StatusNotFound)
		return
	}
	if !s.options.AllowsIP(r.RemoteAddr) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	base := requestBaseURL(r)
	name := html.EscapeString(defaultString(strings.TrimSpace(s.options.ServerName), "Lark"))
	udn := "uuid:" + deviceUUID(name)
	xmlText := fmt.Sprintf(`<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <URLBase>%s/</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>%s</friendlyName>
    <manufacturer>Lark</manufacturer>
    <modelName>Lark DLNA MediaServer</modelName>
    <UDN>%s</UDN>
    <serviceList>
      <service>
        <serviceType>%s</serviceType>
        <serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId>
        <SCPDURL>/dlna/scpd/ContentDirectory</SCPDURL>
        <controlURL>/dlna/control</controlURL>
        <eventSubURL>/dlna/event/ContentDirectory</eventSubURL>
      </service>
      <service>
        <serviceType>%s</serviceType>
        <serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId>
        <SCPDURL>/dlna/scpd/ConnectionManager</SCPDURL>
        <controlURL>/dlna/control</controlURL>
        <eventSubURL>/dlna/event/ConnectionManager</eventSubURL>
      </service>
      <service>
        <serviceType>%s</serviceType>
        <serviceId>urn:microsoft.com:serviceId:X_MS_MediaReceiverRegistrar</serviceId>
        <SCPDURL>/dlna/scpd/X_MS_MediaReceiverRegistrar</SCPDURL>
        <controlURL>/dlna/control</controlURL>
        <eventSubURL>/dlna/event/X_MS_MediaReceiverRegistrar</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`, html.EscapeString(base), name, udn, contentDirectoryServiceType, connectionManagerServiceType, mediaReceiverRegistrarType)
	w.Header().Set("Content-Type", `text/xml; charset="utf-8"`)
	_, _ = w.Write([]byte(xmlText))
}

func (s *Service) handleSCPD(w http.ResponseWriter, r *http.Request) {
	if !s.options.LibraryEnabled {
		http.Error(w, "dlna library is disabled", http.StatusNotFound)
		return
	}
	service := strings.TrimPrefix(r.URL.Path, "/dlna/scpd/")
	var body string
	switch service {
	case "ContentDirectory":
		body = contentDirectorySCPD
	case "ConnectionManager":
		body = connectionManagerSCPD
	case "X_MS_MediaReceiverRegistrar":
		body = mediaReceiverRegistrarSCPD
	default:
		http.Error(w, "service not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", `text/xml; charset="utf-8"`)
	_, _ = w.Write([]byte(body))
}

func requestBaseURL(r *http.Request) string {
	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		proto = "http"
		if r.TLS != nil {
			proto = "https"
		}
	}
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = r.Host
	}
	if host == "" {
		return ""
	}
	return proto + "://" + host
}

func deviceUUID(seed string) string {
	sum := md5.Sum([]byte("lark-dlna:" + seed))
	hexText := hex.EncodeToString(sum[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", hexText[:8], hexText[8:12], hexText[12:16], hexText[16:20], hexText[20:])
}

const contentDirectorySCPD = `<?xml version="1.0"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action><name>Browse</name></action>
    <action><name>GetSearchCapabilities</name></action>
    <action><name>GetSortCapabilities</name></action>
    <action><name>GetSystemUpdateID</name></action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="yes"><name>SystemUpdateID</name><dataType>ui4</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>Result</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_ObjectID</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_BrowseFlag</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Index</name><dataType>ui4</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Count</name><dataType>ui4</dataType></stateVariable>
  </serviceStateTable>
</scpd>`

const connectionManagerSCPD = `<?xml version="1.0"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action><name>GetProtocolInfo</name></action>
    <action><name>GetCurrentConnectionIDs</name></action>
    <action><name>GetCurrentConnectionInfo</name></action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="yes"><name>SourceProtocolInfo</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="yes"><name>SinkProtocolInfo</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_ConnectionID</name><dataType>i4</dataType></stateVariable>
  </serviceStateTable>
</scpd>`

const mediaReceiverRegistrarSCPD = `<?xml version="1.0"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action><name>IsAuthorized</name></action>
    <action><name>IsValidated</name></action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_DeviceID</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Result</name><dataType>int</dataType></stateVariable>
  </serviceStateTable>
</scpd>`
