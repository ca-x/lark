package plugin

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"lark/backend/internal/plugin/host"

	"github.com/gorilla/websocket"
)

const (
	webSocketOpenTimeout  = 10 * time.Second
	webSocketEventTimeout = 30 * time.Second
	maxWebSocketMessage   = 10 << 20
	maxCloseReasonBytes   = 123
)

type managedInboundWebSocket struct {
	conn   *websocket.Conn
	mu     sync.Mutex
	closed bool
}

type websocketPayload struct {
	ConnID   string      `json:"connId"`
	Request  HTTPRequest `json:"request,omitempty"`
	DataHex  string      `json:"dataHex,omitempty"`
	IsBinary bool        `json:"isBinary,omitempty"`
	Code     int         `json:"code,omitempty"`
	Reason   string      `json:"reason,omitempty"`
	WasClean bool        `json:"wasClean,omitempty"`
}

type websocketBridgeRequest struct {
	ConnID   string `json:"connId"`
	DataHex  string `json:"dataHex"`
	IsBinary bool   `json:"isBinary"`
	Code     int    `json:"code"`
	Reason   string `json:"reason"`
}

func (m *Manager) ServeWebSocket(ctx context.Context, writer http.ResponseWriter, request *http.Request, entryPath string, pluginRequest HTTPRequest) error {
	if err := m.EnsureLoaded(ctx, entryPath); err != nil {
		return err
	}
	m.mu.RLock()
	service := m.services[entryPath]
	m.mu.RUnlock()
	if service == nil {
		return fmt.Errorf("plugin %q is not loaded", entryPath)
	}
	if !CheckPermission(service.plugin.Permissions, PermWebSocket) {
		return &host.Error{Code: host.CodePermissionDenied, Message: "inbound WebSocket requires websocket permission"}
	}

	upgrader := websocket.Upgrader{
		ReadBufferSize: 4096, WriteBufferSize: 4096,
		CheckOrigin: sameWebSocketOrigin,
	}
	conn, err := upgrader.Upgrade(writer, request, nil)
	if err != nil {
		return err
	}
	conn.SetReadLimit(maxWebSocketMessage)
	connID, socket := service.registerWebSocket(conn)
	defer service.unregisterWebSocket(connID, websocket.CloseGoingAway, "connection closed")

	if err := m.dispatchWebSocketEvent(service, "__handleInboundWebSocketOpen", websocketPayload{
		ConnID: connID, Request: pluginRequest,
	}, webSocketOpenTimeout); err != nil {
		return err
	}

	for {
		messageType, data, err := conn.ReadMessage()
		if err != nil {
			code, reason, clean := websocketCloseInfo(err)
			_ = m.dispatchWebSocketEvent(service, "__handleInboundWebSocketClose", websocketPayload{
				ConnID: connID, Code: code, Reason: reason, WasClean: clean,
			}, webSocketEventTimeout)
			return nil
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}
		if err := m.dispatchWebSocketEvent(service, "__handleInboundWebSocketMessage", websocketPayload{
			ConnID: connID, DataHex: hex.EncodeToString(data), IsBinary: messageType == websocket.BinaryMessage,
		}, webSocketEventTimeout); err != nil {
			socket.close(websocket.CloseInternalServerErr, "plugin message handler failed")
			return err
		}
	}
}

func (m *Manager) dispatchWebSocketEvent(service *Service, function string, payload websocketPayload, timeout time.Duration) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	callCtx, cancel := context.WithTimeout(service.lifecycleCtx, timeout)
	defer cancel()
	_, err = m.runtime.ExecuteJSCall(callCtx, service.envID, function, timeout.Milliseconds(), string(data))
	return err
}

func (m *Manager) handleWebSocket(service *Service, action, data string) (string, error) {
	var input websocketBridgeRequest
	if err := json.Unmarshal([]byte(data), &input); err != nil {
		return "", &host.Error{Code: host.CodeInvalidArgument, Message: err.Error()}
	}
	service.websocketMu.Lock()
	socket := service.websockets[input.ConnID]
	service.websocketMu.Unlock()
	if socket == nil {
		return "", fmt.Errorf("WebSocket %q is not connected", input.ConnID)
	}
	switch action {
	case "websocket.send":
		payload, err := hex.DecodeString(input.DataHex)
		if err != nil {
			return "", &host.Error{Code: host.CodeInvalidArgument, Message: "invalid WebSocket payload"}
		}
		messageType := websocket.TextMessage
		if input.IsBinary {
			messageType = websocket.BinaryMessage
		} else if !utf8.Valid(payload) {
			return "", &host.Error{Code: host.CodeInvalidArgument, Message: "text WebSocket payload must be UTF-8"}
		}
		return "", socket.write(messageType, payload)
	case "websocket.close":
		return "", socket.close(sanitizeWebSocketCloseCode(input.Code), truncateWebSocketReason(input.Reason))
	default:
		return "", fmt.Errorf("unknown websocket action %q", action)
	}
}

func (service *Service) registerWebSocket(conn *websocket.Conn) (string, *managedInboundWebSocket) {
	service.websocketMu.Lock()
	defer service.websocketMu.Unlock()
	service.websocketSeq++
	id := fmt.Sprintf("inbound-ws-%d", service.websocketSeq)
	socket := &managedInboundWebSocket{conn: conn}
	service.websockets[id] = socket
	return id, socket
}

func (service *Service) unregisterWebSocket(id string, code int, reason string) {
	service.websocketMu.Lock()
	socket := service.websockets[id]
	delete(service.websockets, id)
	service.websocketMu.Unlock()
	if socket != nil {
		_ = socket.close(code, reason)
	}
}

func (service *Service) closeWebSockets() {
	service.websocketMu.Lock()
	sockets := service.websockets
	service.websockets = make(map[string]*managedInboundWebSocket)
	service.websocketMu.Unlock()
	for _, socket := range sockets {
		_ = socket.close(websocket.CloseGoingAway, "plugin stopped")
	}
}

func (socket *managedInboundWebSocket) write(messageType int, payload []byte) error {
	socket.mu.Lock()
	defer socket.mu.Unlock()
	if socket.closed {
		return errors.New("WebSocket is closed")
	}
	return socket.conn.WriteMessage(messageType, payload)
}

func (socket *managedInboundWebSocket) close(code int, reason string) error {
	socket.mu.Lock()
	defer socket.mu.Unlock()
	if socket.closed {
		return nil
	}
	socket.closed = true
	_ = socket.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason), time.Now().Add(time.Second))
	return socket.conn.Close()
}

func sameWebSocketOrigin(request *http.Request) bool {
	origin := strings.TrimSpace(request.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && strings.EqualFold(parsed.Host, request.Host) && (parsed.Scheme == "http" || parsed.Scheme == "https")
}

func websocketCloseInfo(err error) (int, string, bool) {
	if closeErr, ok := errors.AsType[*websocket.CloseError](err); ok {
		return closeErr.Code, closeErr.Text, closeErr.Code == websocket.CloseNormalClosure || closeErr.Code == websocket.CloseGoingAway
	}
	return websocket.CloseAbnormalClosure, err.Error(), false
}

func sanitizeWebSocketCloseCode(code int) int {
	if code < 1000 || code >= 5000 || code == websocket.CloseNoStatusReceived || code == websocket.CloseAbnormalClosure || code == websocket.CloseTLSHandshake {
		return websocket.CloseNormalClosure
	}
	return code
}

func truncateWebSocketReason(reason string) string {
	for len(reason) > maxCloseReasonBytes {
		_, size := utf8.DecodeLastRuneInString(reason)
		reason = reason[:len(reason)-size]
	}
	return reason
}
