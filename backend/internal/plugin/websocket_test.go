package plugin

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"lark/backend/ent/enttest"

	"github.com/gorilla/websocket"
	_ "github.com/lib-x/entsqlite"
)

func TestManagerServesInboundSongLoftWebSocket(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	manager := NewManager(NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })

	manifest := validManifest("ws-echo")
	manifest.Permissions = []string{PermWebSocket}
	code := []byte(`
globalThis.onWebSocket = async function(req, socket) {
  if (req.path !== '/echo') throw new Error('unexpected path: ' + req.path);
  socket.onMessage(async function(event) { await socket.send(event.data); });
};`)
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: code}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}

	handlerDone := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		handlerDone <- manager.ServeWebSocket(request.Context(), writer, request, manifest.EntryPath, HTTPRequest{
			Method: request.Method, Path: "/echo", Headers: map[string]string{}, RemoteAddr: request.RemoteAddr,
		})
	}))
	t.Cleanup(server.Close)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, response, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		if response != nil {
			t.Fatalf("dial status=%d: %v", response.StatusCode, err)
		}
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.WriteMessage(websocket.TextMessage, []byte("songloft-compatible")); err != nil {
		t.Fatal(err)
	}
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	if messageType != websocket.TextMessage || string(payload) != "songloft-compatible" {
		t.Fatalf("echo type=%d payload=%q", messageType, payload)
	}
	if err := conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "")); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-handlerDone:
		if err != nil {
			t.Fatalf("ServeWebSocket: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ServeWebSocket did not finish after the close frame")
	}
}
