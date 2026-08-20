package plugin

import (
	"fmt"
	"io"
	"net"
	"strings"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/plugin/larkhost"

	_ "github.com/lib-x/entsqlite"
)

func TestManagerRunsSongLoftUDPAndTCPBridges(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	serverReceived := make(chan string, 1)
	serverErrors := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			serverErrors <- err
			return
		}
		defer connection.Close()
		request := make([]byte, 4)
		if _, err := io.ReadFull(connection, request); err != nil {
			serverErrors <- err
			return
		}
		serverReceived <- string(request)
		if _, err := connection.Write([]byte("pong")); err != nil {
			serverErrors <- err
			return
		}
		_, _ = io.Copy(io.Discard, connection)
	}()

	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	pluginDataDir := t.TempDir()
	adapter := larkhost.New(nil, nil, larkhost.Config{DataDir: pluginDataDir})
	manager := NewManager(NewEntRepository(client), t.TempDir(), pluginDataDir, adapter)
	t.Cleanup(func() { _ = manager.Close() })

	port := listener.Addr().(*net.TCPAddr).Port
	manifest := validManifest("network-plugin")
	manifest.Permissions = []string{PermNet}
	mainCode := []byte(fmt.Sprintf(`
globalThis.onHTTPRequest = async function(req) {
  if (req.path === '/udp') {
    var bound = await songloft.net.udpBind({address: '127.0.0.1:0'});
    var received = new Promise(function(resolve) { songloft.net.onData(bound.socketId, resolve); });
    await songloft.net.udpSend(bound.socketId, 'hello', bound.localAddr);
    var event = await received;
    await songloft.net.udpClose(bound.socketId);
    return {statusCode: 200, headers: {}, body: JSON.stringify(event)};
  }
  if (req.path === '/tcp') {
    var socket = await songloft.net.tcpConnect('127.0.0.1', %d, {timeout: 2000});
    var received = new Promise(function(resolve) { socket.onData(resolve); });
    await socket.send('ping');
    var data = await received;
    await socket.close();
    return {statusCode: 200, headers: {}, body: data};
  }
  return {statusCode: 404, headers: {}, body: ''};
};`, port))
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: mainCode}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}

	udpResponse, err := manager.InvokeHTTP(t.Context(), manifest.EntryPath, HTTPRequest{Method: "GET", Path: "/udp", Headers: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(udpResponse.Body, `"data":"aGVsbG8="`) || !strings.Contains(udpResponse.Body, `"remoteAddr":"127.0.0.1:`) {
		t.Fatalf("UDP response = %s", udpResponse.Body)
	}

	tcpResponse, err := manager.InvokeHTTP(t.Context(), manifest.EntryPath, HTTPRequest{Method: "GET", Path: "/tcp", Headers: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	if tcpResponse.Body != "cG9uZw==" {
		t.Fatalf("TCP response = %q", tcpResponse.Body)
	}
	select {
	case received := <-serverReceived:
		if received != "ping" {
			t.Fatalf("TCP server received %q", received)
		}
	case err := <-serverErrors:
		t.Fatal(err)
	}
}

func TestManagerCleansUpSongLoftNetworkSocketsOnDisable(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	connectionClosed := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			connectionClosed <- err
			return
		}
		defer connection.Close()
		buffer := make([]byte, 1)
		_, err = connection.Read(buffer)
		connectionClosed <- err
	}()

	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	pluginDataDir := t.TempDir()
	adapter := larkhost.New(nil, nil, larkhost.Config{DataDir: pluginDataDir})
	manager := NewManager(NewEntRepository(client), t.TempDir(), pluginDataDir, adapter)
	t.Cleanup(func() { _ = manager.Close() })
	manifest := validManifest("network-cleanup")
	manifest.Permissions = []string{PermNet}
	port := listener.Addr().(*net.TCPAddr).Port
	mainCode := []byte(fmt.Sprintf(`
globalThis.onHTTPRequest = async function() {
  var udp = await songloft.net.udpBind({address: '127.0.0.1:0'});
  var tcp = await songloft.net.tcpConnect('127.0.0.1', %d, {timeout: 2000});
  return {statusCode: 200, headers: {}, body: JSON.stringify({udp: udp.socketId, tcp: tcp.socketId})};
};`, port))
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: mainCode}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.InvokeHTTP(t.Context(), manifest.EntryPath, HTTPRequest{Method: "GET", Path: "/", Headers: map[string]string{}}); err != nil {
		t.Fatal(err)
	}
	if err := manager.Disable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}
	if err := <-connectionClosed; err == nil {
		t.Fatal("TCP connection remained open after plugin disable")
	}
}
