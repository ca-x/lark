package jsruntime

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestProcessTimers_ReturnsTrue_WhenTimerFires(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-timer-fire"
	pluginID := int64(1)

	// Create environment with a timer that fires immediately
	code := polyfillJS + `
		var fired = false;
		setTimeout(function(){ fired = true; }, 0);
	`
	if err := manager.CreateEnv(envID, code, pluginID); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	// Process timers - should return true because timer fires
	time.Sleep(10 * time.Millisecond) // Give timer a chance to be ready
	didFire := manager.ProcessTimers(envID)

	if !didFire {
		t.Error("Expected ProcessTimers to return true when timer fires")
	}

	// Verify the timer actually executed
	result, err := manager.ExecuteJS(context.Background(), envID, "fired", 1000)
	if err != nil {
		t.Fatalf("Failed to check fired variable: %v", err)
	}

	if result.Result != "true" {
		t.Errorf("Expected timer to have fired, got fired=%s", result.Result)
	}
}

func TestProcessTimers_ReturnsFalse_WhenNoTimerFires(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-no-timer-fire"
	pluginID := int64(1)

	// Create environment with no timers
	code := polyfillJS
	if err := manager.CreateEnv(envID, code, pluginID); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	// Process timers - should return false because no timers exist
	didFire := manager.ProcessTimers(envID)

	if didFire {
		t.Error("Expected ProcessTimers to return false when no timers exist")
	}
}

func TestGetNextTimerDeadline_NoTimers(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-next-empty"
	pluginID := int64(1)

	if err := manager.CreateEnv(envID, polyfillJS, pluginID); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	deadline := manager.GetNextTimerDeadline(envID)
	if !deadline.IsZero() {
		t.Errorf("expected zero time when no timers, got %v", deadline)
	}
}

func TestGetNextTimerDeadline_SingleTimer(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-next-single"
	pluginID := int64(1)

	if err := manager.CreateEnv(envID, polyfillJS, pluginID); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	before := time.Now()
	if _, err := manager.ExecuteJS(context.Background(), envID, "setTimeout(function(){}, 60000);", 1000); err != nil {
		t.Fatalf("setTimeout failed: %v", err)
	}

	deadline := manager.GetNextTimerDeadline(envID)
	if deadline.IsZero() {
		t.Fatal("expected non-zero deadline after setTimeout")
	}

	// 期望 deadline 大约在 before+60s 附近（容差 5s 处理 CI 延迟）
	expectedMin := before.Add(55 * time.Second)
	expectedMax := before.Add(65 * time.Second)
	if deadline.Before(expectedMin) || deadline.After(expectedMax) {
		t.Errorf("deadline %v outside expected range [%v, %v]", deadline, expectedMin, expectedMax)
	}
}

func TestGetNextTimerDeadline_PicksEarliest(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-next-earliest"
	pluginID := int64(1)

	if err := manager.CreateEnv(envID, polyfillJS, pluginID); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	before := time.Now()
	// 先注册一个 60s 的，再注册一个 10s 的，再注册一个 120s 的；期望选 10s 的。
	code := `
		setTimeout(function(){}, 60000);
		setTimeout(function(){}, 10000);
		setTimeout(function(){}, 120000);
	`
	if _, err := manager.ExecuteJS(context.Background(), envID, code, 1000); err != nil {
		t.Fatalf("setTimeout chain failed: %v", err)
	}

	deadline := manager.GetNextTimerDeadline(envID)
	if deadline.IsZero() {
		t.Fatal("expected non-zero deadline")
	}

	expectedMin := before.Add(5 * time.Second)
	expectedMax := before.Add(15 * time.Second)
	if deadline.Before(expectedMin) || deadline.After(expectedMax) {
		t.Errorf("deadline %v not picking the earliest (~10s) timer, expected in [%v, %v]",
			deadline, expectedMin, expectedMax)
	}
}

func TestGetNextTimerDeadline_IncludesInterval(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-next-interval"
	pluginID := int64(1)

	if err := manager.CreateEnv(envID, polyfillJS, pluginID); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	if _, err := manager.ExecuteJS(context.Background(), envID, "setInterval(function(){}, 30000);", 1000); err != nil {
		t.Fatalf("setInterval failed: %v", err)
	}

	deadline := manager.GetNextTimerDeadline(envID)
	if deadline.IsZero() {
		t.Error("expected non-zero deadline for setInterval")
	}
}

func TestProcessTimers_ReturnsFalse_WhenTimerNotYetExpired(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-timer-not-expired"
	pluginID := int64(1)

	// Create environment with a timer that won't fire for a while
	code := polyfillJS + `
		setTimeout(function(){}, 10000);
	`
	if err := manager.CreateEnv(envID, code, pluginID); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	// Process timers immediately - should return false because timer hasn't expired
	didFire := manager.ProcessTimers(envID)

	if didFire {
		t.Error("Expected ProcessTimers to return false when timer hasn't expired yet")
	}
}

func TestFetch_Uint8ArrayBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("ReadAll: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(body)
	}))
	defer server.Close()

	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-fetch-uint8-body"
	if err := manager.CreateEnv(envID, polyfillJS, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	defer manager.DestroyEnv(envID)

	code := fmt.Sprintf(`
		var fetchEcho = '';
		fetch(%q, {
			method: 'POST',
			body: new Uint8Array([0x00, 0x01, 0x02, 0xff])
		}).then(function(resp) {
			return resp.arrayBuffer();
		}).then(function(buf) {
			var bytes = new Uint8Array(buf);
			for (var i = 0; i < bytes.length; i++) {
				fetchEcho += ('0' + bytes[i].toString(16)).slice(-2);
			}
		});
	`, server.URL)
	if _, err := manager.ExecuteJS(context.Background(), envID, code, 5000); err != nil {
		t.Fatalf("ExecuteJS: %v", err)
	}

	for i := 0; i < 20; i++ {
		res, _ := manager.ExecuteJS(context.Background(), envID, "fetchEcho", 1000)
		if res != nil && res.Result == "000102ff" {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	res, _ := manager.ExecuteJS(context.Background(), envID, "fetchEcho", 1000)
	if res == nil || res.Result != "000102ff" {
		t.Fatalf("expected echoed hex 000102ff, got %#v", res)
	}
}

func TestDoHTTPRequest_InternalFetchHeaders(t *testing.T) {
	var gotTimeoutHeader, gotNoRedirectHeader, gotCustomHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTimeoutHeader = r.Header.Get("X-Fetch-Timeout-Ms")
		gotNoRedirectHeader = r.Header.Get("X-Fetch-No-Redirect")
		gotCustomHeader = r.Header.Get("X-Custom")
		_, _ = w.Write([]byte("ok"))
	}))
	defer server.Close()

	result := doHTTPRequest(server.URL, http.MethodGet, `{"X-Fetch-Timeout-Ms":"1000","X-Fetch-No-Redirect":"1","X-Custom":"kept"}`, "")
	if strings.Contains(result, `"error"`) {
		t.Fatalf("doHTTPRequest returned error: %s", result)
	}
	if gotTimeoutHeader != "" {
		t.Errorf("X-Fetch-Timeout-Ms was forwarded to upstream: %q", gotTimeoutHeader)
	}
	if gotNoRedirectHeader != "" {
		t.Errorf("X-Fetch-No-Redirect was forwarded to upstream: %q", gotNoRedirectHeader)
	}
	if gotCustomHeader != "kept" {
		t.Errorf("X-Custom header = %q, want kept", gotCustomHeader)
	}

	slowServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(250 * time.Millisecond)
		_, _ = w.Write([]byte("late"))
	}))
	defer slowServer.Close()

	start := time.Now()
	result = doHTTPRequest(slowServer.URL, http.MethodGet, `{"X-Fetch-Timeout-Ms":"100"}`, "")
	if !strings.Contains(result, `"error"`) {
		t.Fatalf("expected timeout error, got: %s", result)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("custom fetch timeout was not applied quickly enough: %v", elapsed)
	}
}

// TestExecuteJS_CtxCancel 验证客户端取消 ctx 时 ExecuteJS 立即返回（issue #79 的核心）。
// 构造一个永不 resolve 的 Promise（依赖 setTimeout 但 ts 远大于测试时长），
// 然后 cancel ctx，断言 ExecuteJS 在远小于 timeoutMs 的时间内返回 context.Canceled。
func TestExecuteJS_CtxCancel(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-ctx-cancel"
	if err := manager.CreateEnv(envID, polyfillJS, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	defer manager.DestroyEnv(envID)

	ctx, cancel := context.WithCancel(context.Background())

	// 200ms 后取消
	go func() {
		time.Sleep(200 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	// 60s 永不 resolve（实际不会等这么久）
	_, err := manager.ExecuteJS(ctx, envID,
		`new Promise(function(resolve){ setTimeout(resolve, 60000); })`,
		60000)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected error from canceled ctx, got nil")
	}
	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got: %v", err)
	}
	if elapsed > 2*time.Second {
		t.Errorf("ExecuteJS took %v after ctx cancel; expected sub-second", elapsed)
	}

	// 验证 env 仍可用：下一次 ExecuteJS 不应因前一次取消导致 deadlock 或异常
	res, err2 := manager.ExecuteJS(context.Background(), envID, "1+1", 1000)
	if err2 != nil {
		t.Fatalf("post-cancel ExecuteJS failed: %v", err2)
	}
	if res.Result != "2" {
		t.Errorf("post-cancel eval expected 2, got %q", res.Result)
	}
}

// TestExecuteJS_CtxAlreadyCanceled 即使 ctx 进入时已取消，也应快速返回 context.Canceled。
func TestExecuteJS_CtxAlreadyCanceled(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-ctx-pre-cancel"
	if err := manager.CreateEnv(envID, polyfillJS, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	defer manager.DestroyEnv(envID)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	_, err := manager.ExecuteJS(ctx, envID,
		`new Promise(function(resolve){ setTimeout(resolve, 60000); })`,
		60000)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected error from pre-canceled ctx, got nil")
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("ExecuteJS took %v with pre-canceled ctx; expected near-instant", elapsed)
	}
}

// --- URL Polyfill 测试 ---

func TestURLPolyfill_AbsoluteURL(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-url-absolute"
	code := polyfillJS + `
		var u = new URL('https://example.com:8080/path/to?q=1#frag');
		var result = JSON.stringify({
			protocol: u.protocol,
			host: u.host,
			hostname: u.hostname,
			port: u.port,
			pathname: u.pathname,
			search: u.search,
			hash: u.hash,
			origin: u.origin
		});
	`
	if err := manager.CreateEnv(envID, code, 1); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	res, err := manager.ExecuteJS(context.Background(), envID, "result", 1000)
	if err != nil {
		t.Fatalf("ExecuteJS failed: %v", err)
	}

	expected := `{"protocol":"https:","host":"example.com:8080","hostname":"example.com","port":"8080","pathname":"/path/to","search":"?q=1","hash":"#frag","origin":"https://example.com:8080"}`
	if res.Result != expected {
		t.Errorf("got %s\nwant %s", res.Result, expected)
	}
}

func TestURLPolyfill_RelativeWithBase(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-url-relative-base"
	code := polyfillJS + `
		var u1 = new URL('/path', 'https://example.com/dir/file');
		var u2 = new URL('sub', 'https://example.com/dir/');
		var r1 = u1.href;
		var r2 = u2.href;
	`
	if err := manager.CreateEnv(envID, code, 1); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	res1, _ := manager.ExecuteJS(context.Background(), envID, "r1", 1000)
	if res1.Result != "https://example.com/dir/path" {
		t.Errorf("relative with base '/path': got %s", res1.Result)
	}

	res2, _ := manager.ExecuteJS(context.Background(), envID, "r2", 1000)
	if res2.Result != "https://example.com/dir//sub" {
		t.Errorf("relative with base 'sub': got %s", res2.Result)
	}
}

func TestURLPolyfill_RelativeWithoutBase_ThrowsTypeError(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-url-relative-throws"
	code := polyfillJS + `
		var caught = false;
		var errorName = '';
		try {
			new URL('/relative/path');
		} catch(e) {
			caught = true;
			errorName = e.constructor.name || '';
		}
	`
	if err := manager.CreateEnv(envID, code, 1); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	res, _ := manager.ExecuteJS(context.Background(), envID, "caught", 1000)
	if res.Result != "true" {
		t.Error("new URL('/relative/path') should throw, but did not")
	}

	res2, _ := manager.ExecuteJS(context.Background(), envID, "errorName", 1000)
	if res2.Result != "TypeError" {
		t.Errorf("expected TypeError, got %s", res2.Result)
	}
}

// --- WebSocket Polyfill 测试 ---

// echoWSHandler 是一个简单的 WebSocket echo server handler
var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func echoWSHandler(w http.ResponseWriter, r *http.Request) {
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()
	for {
		mt, message, err := c.ReadMessage()
		if err != nil {
			break
		}
		if err := c.WriteMessage(mt, message); err != nil {
			break
		}
	}
}

func startEchoWSServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(echoWSHandler))
	return server
}

func wsURL(server *httptest.Server) string {
	return "ws" + strings.TrimPrefix(server.URL, "http")
}

func TestWebSocket_ConnectAndSendText(t *testing.T) {
	server := startEchoWSServer(t)
	defer server.Close()

	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-ws-text"
	if err := manager.CreateEnv(envID, polyfillJS, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	defer manager.DestroyEnv(envID)

	code := fmt.Sprintf(`
		var wsResult = '';
		var wsOpened = false;
		var wsClosed = false;
		(function() {
			var ws = new WebSocket('%s');
			ws.onopen = function() {
				wsOpened = true;
				ws.send('hello world');
			};
			ws.onmessage = function(e) {
				wsResult = e.data;
				ws.close();
			};
			ws.onclose = function() {
				wsClosed = true;
			};
		})();
	`, wsURL(server))

	_, err := manager.ExecuteJS(context.Background(), envID, code, 5000)
	if err != nil {
		t.Fatalf("ExecuteJS: %v", err)
	}

	// 等待异步回调完成
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		res, _ := manager.ExecuteJS(context.Background(), envID, "wsResult", 1000)
		if res != nil && res.Result == "hello world" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	res, _ := manager.ExecuteJS(context.Background(), envID, "wsResult", 1000)
	if res == nil || res.Result != "hello world" {
		t.Errorf("expected echo 'hello world', got %q", res.Result)
	}

	res, _ = manager.ExecuteJS(context.Background(), envID, "wsOpened", 1000)
	if res == nil || res.Result != "true" {
		t.Errorf("expected wsOpened=true, got %q", res.Result)
	}
}

func TestWebSocket_BinaryEcho(t *testing.T) {
	server := startEchoWSServer(t)
	defer server.Close()

	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-ws-binary"
	if err := manager.CreateEnv(envID, polyfillJS, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	defer manager.DestroyEnv(envID)

	code := fmt.Sprintf(`
		var binaryResult = '';
		var binaryIsBinary = false;
		(function() {
			var ws = new WebSocket('%s');
			ws.onopen = function() {
				var data = new Uint8Array([0x01, 0x02, 0x03, 0xff]);
				ws.send(data);
			};
			ws.onmessage = function(e) {
				if (e.data instanceof Uint8Array) {
					binaryIsBinary = true;
					var hex = '';
					for (var i = 0; i < e.data.length; i++) hex += ('0' + e.data[i].toString(16)).slice(-2);
					binaryResult = hex;
				}
				ws.close();
			};
		})();
	`, wsURL(server))

	_, err := manager.ExecuteJS(context.Background(), envID, code, 5000)
	if err != nil {
		t.Fatalf("ExecuteJS: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		res, _ := manager.ExecuteJS(context.Background(), envID, "binaryResult", 1000)
		if res != nil && res.Result != "" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	res, _ := manager.ExecuteJS(context.Background(), envID, "binaryResult", 1000)
	if res == nil || res.Result != "010203ff" {
		t.Errorf("expected binary echo '010203ff', got %q", res.Result)
	}

	res, _ = manager.ExecuteJS(context.Background(), envID, "binaryIsBinary", 1000)
	if res == nil || res.Result != "true" {
		t.Errorf("expected binaryIsBinary=true, got %q", res.Result)
	}
}

func TestWebSocket_CloseEvent(t *testing.T) {
	server := startEchoWSServer(t)
	defer server.Close()

	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-ws-close"
	if err := manager.CreateEnv(envID, polyfillJS, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	defer manager.DestroyEnv(envID)

	code := fmt.Sprintf(`
		var closeCode = 0;
		(function() {
			var ws = new WebSocket('%s');
			ws.onopen = function() {
				ws.close(1000, 'done');
			};
			ws.onclose = function(e) {
				closeCode = e.code;
			};
		})();
	`, wsURL(server))

	_, err := manager.ExecuteJS(context.Background(), envID, code, 5000)
	if err != nil {
		t.Fatalf("ExecuteJS: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		res, _ := manager.ExecuteJS(context.Background(), envID, "closeCode", 1000)
		if res != nil && res.Result != "0" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	res, _ := manager.ExecuteJS(context.Background(), envID, "closeCode", 1000)
	if res == nil || res.Result != "1000" {
		t.Errorf("expected close code 1000, got %q", res.Result)
	}
}

func TestWebSocket_ConnectError(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-ws-error"
	if err := manager.CreateEnv(envID, polyfillJS, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	defer manager.DestroyEnv(envID)

	// 连接到一个不存在的地址
	code := `
		var wsErrorMsg = '';
		(function() {
			var ws = new WebSocket('ws://127.0.0.1:1');
			ws.onerror = function(e) {
				wsErrorMsg = e.message || 'error';
			};
		})();
	`

	_, err := manager.ExecuteJS(context.Background(), envID, code, 5000)
	if err != nil {
		t.Fatalf("ExecuteJS: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		res, _ := manager.ExecuteJS(context.Background(), envID, "wsErrorMsg", 1000)
		if res != nil && res.Result != "" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	res, _ := manager.ExecuteJS(context.Background(), envID, "wsErrorMsg", 1000)
	if res == nil || res.Result == "" {
		t.Error("expected error message on connect failure, got empty")
	}
}

func TestWebSocket_HasActiveWebSockets(t *testing.T) {
	server := startEchoWSServer(t)
	defer server.Close()

	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-ws-has-active"
	if err := manager.CreateEnv(envID, polyfillJS, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	defer manager.DestroyEnv(envID)

	// 连接前应该没有活跃连接
	if manager.HasActiveWebSockets(envID) {
		t.Error("expected no active WebSockets before connecting")
	}

	code := fmt.Sprintf(`
		var testWs = new WebSocket('%s');
		var testWsReady = false;
		testWs.onopen = function() { testWsReady = true; };
	`, wsURL(server))

	_, err := manager.ExecuteJS(context.Background(), envID, code, 5000)
	if err != nil {
		t.Fatalf("ExecuteJS: %v", err)
	}

	// 等待连接建立
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		res, _ := manager.ExecuteJS(context.Background(), envID, "testWsReady", 1000)
		if res != nil && res.Result == "true" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// 连接后应该有活跃连接
	if !manager.HasActiveWebSockets(envID) {
		t.Error("expected active WebSockets after connecting")
	}

	// 关闭连接
	_, _ = manager.ExecuteJS(context.Background(), envID, "testWs.close()", 1000)

	// 等待关闭
	time.Sleep(200 * time.Millisecond)
	// 让事件循环处理关闭事件
	manager.ProcessTimers(envID)
	time.Sleep(100 * time.Millisecond)

	if manager.HasActiveWebSockets(envID) {
		t.Error("expected no active WebSockets after closing")
	}
}

func TestWebSocket_DestroyEnvClosesConnections(t *testing.T) {
	server := startEchoWSServer(t)
	defer server.Close()

	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-ws-destroy"
	if err := manager.CreateEnv(envID, polyfillJS, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}

	code := fmt.Sprintf(`
		var ws = new WebSocket('%s');
		var wsReady = false;
		ws.onopen = function() { wsReady = true; };
	`, wsURL(server))

	_, err := manager.ExecuteJS(context.Background(), envID, code, 5000)
	if err != nil {
		t.Fatalf("ExecuteJS: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		res, _ := manager.ExecuteJS(context.Background(), envID, "wsReady", 1000)
		if res != nil && res.Result == "true" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if !manager.HasActiveWebSockets(envID) {
		t.Fatal("expected active WebSocket before destroy")
	}

	// DestroyEnv 应该关闭所有 WebSocket 连接
	if err := manager.DestroyEnv(envID); err != nil {
		t.Fatalf("DestroyEnv: %v", err)
	}

	// 验证不再有活跃连接（getEnv 会 error，HasActiveWebSockets 返回 false）
	if manager.HasActiveWebSockets(envID) {
		t.Error("expected no active WebSockets after DestroyEnv")
	}
}

func TestURLPolyfill_WebSocketURL(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-url-ws"
	code := polyfillJS + `
		var u1 = new URL('ws://example.com:8080/path?q=1');
		var u2 = new URL('wss://secure.example.com/ws');
		var r1 = JSON.stringify({protocol: u1.protocol, host: u1.host, pathname: u1.pathname});
		var r2 = JSON.stringify({protocol: u2.protocol, hostname: u2.hostname, pathname: u2.pathname});
	`
	if err := manager.CreateEnv(envID, code, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	defer manager.DestroyEnv(envID)

	res1, _ := manager.ExecuteJS(context.Background(), envID, "r1", 1000)
	expected1 := `{"protocol":"ws:","host":"example.com:8080","pathname":"/path"}`
	if res1.Result != expected1 {
		t.Errorf("ws URL: got %s\nwant %s", res1.Result, expected1)
	}

	res2, _ := manager.ExecuteJS(context.Background(), envID, "r2", 1000)
	expected2 := `{"protocol":"wss:","hostname":"secure.example.com","pathname":"/ws"}`
	if res2.Result != expected2 {
		t.Errorf("wss URL: got %s\nwant %s", res2.Result, expected2)
	}
}

func TestURLPolyfill_TryCatchDetectionPattern(t *testing.T) {
	manager := NewJSEnvManager()
	defer manager.SignalShutdown()

	envID := "test-url-trycatch-pattern"
	code := polyfillJS + `
		function isAbsoluteURL(path) {
			try { new URL(path); return true; }
			catch(e) { return false; }
		}
		var absResult = isAbsoluteURL('https://example.com/file.mp3');
		var relResult = isAbsoluteURL('/music/file.mp3');
		var bareResult = isAbsoluteURL('file.mp3');
	`
	if err := manager.CreateEnv(envID, code, 1); err != nil {
		t.Fatalf("CreateEnv failed: %v", err)
	}
	defer manager.DestroyEnv(envID)

	res1, _ := manager.ExecuteJS(context.Background(), envID, "absResult", 1000)
	if res1.Result != "true" {
		t.Error("absolute URL should return true")
	}
	res2, _ := manager.ExecuteJS(context.Background(), envID, "relResult", 1000)
	if res2.Result != "false" {
		t.Error("relative path should return false")
	}
	res3, _ := manager.ExecuteJS(context.Background(), envID, "bareResult", 1000)
	if res3.Result != "false" {
		t.Error("bare filename should return false")
	}
}

func TestExecuteJS_PromiseAndBuffer(t *testing.T) {
	manager := NewJSEnvManager()
	t.Cleanup(func() { _ = manager.Close() })

	const envID = "test-promise-buffer"
	if err := manager.CreateEnv(envID, "", 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}

	result, err := manager.ExecuteJS(t.Context(), envID, `
		Promise.resolve(Buffer.from('SongLoft', 'utf8'))
			.then(function(buf) { return buf.toString('base64'); })
	`, 1000)
	if err != nil {
		t.Fatalf("ExecuteJS: %v", err)
	}
	if result.Result != "U29uZ0xvZnQ=" {
		t.Fatalf("Result = %q, want U29uZ0xvZnQ=", result.Result)
	}
}

func TestExecuteJSParallel_ReturnsSuccessfulCall(t *testing.T) {
	manager := NewJSEnvManager()
	t.Cleanup(func() { _ = manager.Close() })

	if err := manager.CreateEnv("parallel-fail", "", 1); err != nil {
		t.Fatalf("CreateEnv(parallel-fail): %v", err)
	}
	if err := manager.CreateEnv("parallel-success", "", 1); err != nil {
		t.Fatalf("CreateEnv(parallel-success): %v", err)
	}

	index, result, errs := manager.ExecuteJSParallel([]ParallelCall{
		{EnvID: "parallel-fail", Code: `throw new Error('expected failure')`, TimeoutMs: 1000},
		{EnvID: "parallel-success", Code: `'compatible'`, TimeoutMs: 1000},
	}, 2)
	if index != 1 {
		t.Fatalf("success index = %d, want 1 (errors: %v)", index, errs)
	}
	if result == nil || result.Result != "compatible" {
		t.Fatalf("result = %#v, want compatible", result)
	}
	if errs[0] == "" || errs[1] != "" {
		t.Fatalf("errors = %v, want [non-empty, empty]", errs)
	}
}

func TestSignalShutdown_InterruptsPendingExecution(t *testing.T) {
	manager := NewJSEnvManager()
	t.Cleanup(func() { _ = manager.Close() })

	const envID = "test-shutdown"
	if err := manager.CreateEnv(envID, "", 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := manager.ExecuteJS(t.Context(), envID,
			`new Promise(function(resolve) { setTimeout(resolve, 60000); })`, 60000)
		done <- err
	}()

	time.Sleep(20 * time.Millisecond)
	manager.SignalShutdown()

	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "shutting down") {
			t.Fatalf("ExecuteJS error = %v, want shutdown error", err)
		}
	case <-time.After(time.Second):
		t.Fatal("ExecuteJS did not stop after SignalShutdown")
	}
}

func TestClose_RemovesEnvironments(t *testing.T) {
	manager := NewJSEnvManager()
	if err := manager.CreateEnv("close-env", "", 42); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	if err := manager.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if status := manager.HealthProbe("close-env"); status != ProbeStatusMissing {
		t.Fatalf("HealthProbe after Close = %v, want ProbeStatusMissing", status)
	}
}
