package dlna

import (
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/http"
	"strconv"
	"strings"
)

func (s *Service) handleSOAP(w http.ResponseWriter, r *http.Request) {
	if !s.options.LibraryEnabled {
		writeSOAPFault(w, 501, "DLNA library is disabled")
		return
	}
	if !s.options.AllowsIP(r.RemoteAddr) {
		writeSOAPFault(w, 401, "Forbidden")
		return
	}
	action := soapAction(r.Header.Get("SOAPACTION"))
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeSOAPFault(w, 501, "Invalid request")
		return
	}
	switch action {
	case "Browse":
		req := parseBrowseRequest(body)
		result, err := s.Browse(r.Context(), req.ObjectID, req.BrowseFlag, req.StartingIndex, req.RequestedCount, requestBaseURL(r))
		if err != nil {
			writeSOAPFault(w, 701, err.Error())
			return
		}
		writeSOAPBody(w, fmt.Sprintf(`<u:BrowseResponse xmlns:u="%s"><Result>%s</Result><NumberReturned>%d</NumberReturned><TotalMatches>%d</TotalMatches><UpdateID>%d</UpdateID></u:BrowseResponse>`,
			contentDirectoryServiceType,
			html.EscapeString(result.Result),
			result.NumberReturned,
			result.TotalMatches,
			result.UpdateID,
		))
	case "GetProtocolInfo":
		writeSOAPBody(w, fmt.Sprintf(`<u:GetProtocolInfoResponse xmlns:u="%s"><Source>%s</Source><Sink></Sink></u:GetProtocolInfoResponse>`, connectionManagerServiceType, html.EscapeString(protocolInfoSource)))
	case "GetCurrentConnectionIDs":
		writeSOAPBody(w, fmt.Sprintf(`<u:GetCurrentConnectionIDsResponse xmlns:u="%s"><ConnectionIDs>0</ConnectionIDs></u:GetCurrentConnectionIDsResponse>`, connectionManagerServiceType))
	case "IsAuthorized", "IsValidated":
		writeSOAPBody(w, fmt.Sprintf(`<u:%sResponse xmlns:u="%s"><Result>1</Result></u:%sResponse>`, action, mediaReceiverRegistrarType, action))
	default:
		writeSOAPFault(w, 401, "Invalid Action")
	}
}

type browseRequest struct {
	ObjectID       string
	BrowseFlag     string
	StartingIndex  int
	RequestedCount int
}

func parseBrowseRequest(data []byte) browseRequest {
	req := browseRequest{ObjectID: "0", BrowseFlag: "BrowseDirectChildren", RequestedCount: 100}
	decoder := xml.NewDecoder(strings.NewReader(string(data)))
	var current string
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := token.(type) {
		case xml.StartElement:
			current = t.Name.Local
		case xml.CharData:
			value := strings.TrimSpace(string(t))
			if value == "" {
				continue
			}
			switch current {
			case "ObjectID":
				req.ObjectID = value
			case "BrowseFlag":
				req.BrowseFlag = value
			case "StartingIndex":
				req.StartingIndex, _ = strconv.Atoi(value)
			case "RequestedCount":
				req.RequestedCount, _ = strconv.Atoi(value)
			}
		case xml.EndElement:
			current = ""
		}
	}
	return req
}

func soapAction(header string) string {
	header = strings.Trim(header, `"`)
	if idx := strings.LastIndex(header, "#"); idx >= 0 {
		return strings.TrimSpace(header[idx+1:])
	}
	return strings.TrimSpace(header)
}

func writeSOAPBody(w http.ResponseWriter, responseXML string) {
	w.Header().Set("Content-Type", `text/xml; charset="utf-8"`)
	_, _ = w.Write([]byte(fmt.Sprintf(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>%s</s:Body></s:Envelope>`, responseXML)))
}

func writeSOAPFault(w http.ResponseWriter, code int, description string) {
	w.Header().Set("Content-Type", `text/xml; charset="utf-8"`)
	w.WriteHeader(http.StatusInternalServerError)
	_, _ = w.Write([]byte(fmt.Sprintf(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>%d</errorCode><errorDescription>%s</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`, code, html.EscapeString(description))))
}
