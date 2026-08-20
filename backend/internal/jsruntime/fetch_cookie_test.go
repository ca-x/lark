package jsruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 本文件覆盖 songloft-org/songloft#401：fetch 响应头的多值无损回传
// （Go 侧 headersList）与 JS 侧 Headers 读取方法（get/has/getSetCookie/forEach）。
//
// 关键背景：SDK 把 fetch 声明为返回 DOM Response，而 TS 5.2+ 的 lib.dom 里
// Headers 带 get()/getSetCookie()，于是插件作者照类型声明写就能编译通过、
// 运行时却因为 headers 是裸对象而抛 TypeError。这些测试锁住修复后的契约。

// expiresCookie 的 Expires 属性自带 ", "，正是折叠成单串后无法可靠切分的元凶。
const expiresCookie = "sid=xyz789; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT"
const accessCodeCookie = "os-access-code=abc123; Path=/; HttpOnly"

// newSetCookieServer 返回一个模拟访问码网关的服务：204 且带两条 Set-Cookie。
// 选 204 是因为 issue 作者报告「204 响应的 headers 是空对象」，这里正面锁住它不为空。
func newSetCookieServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Set-Cookie", accessCodeCookie)
		w.Header().Add("Set-Cookie", expiresCookie)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// runFetchProbe 在新建的 env 里跑一段把结果写进全局 __out 的 fetch 代码，
// 轮询直到 __out 非空，返回其内容。
// 轮询而非一次 ExecuteJS：fetch 的 Promise 由后台 goroutine 回投，
// 首次 ExecuteJS 返回时可能尚未 settle（沿用 TestFetch_Uint8ArrayBody 的既有范式）。
func runFetchProbe(t *testing.T, envSuffix, probeJS string) string {
	t.Helper()
	manager := NewJSEnvManager()
	t.Cleanup(manager.SignalShutdown)

	envID := "test-fetch-headers-" + envSuffix
	if err := manager.CreateEnv(envID, polyfillJS, 1); err != nil {
		t.Fatalf("CreateEnv: %v", err)
	}
	t.Cleanup(func() { manager.DestroyEnv(envID) })

	code := "var __out = '';\n" + probeJS
	if _, err := manager.ExecuteJS(context.Background(), envID, code, 5000); err != nil {
		t.Fatalf("ExecuteJS: %v", err)
	}

	for range 40 {
		res, _ := manager.ExecuteJS(context.Background(), envID, "__out", 1000)
		if res != nil && res.Result != "" && res.Result != "undefined" {
			return res.Result
		}
		time.Sleep(50 * time.Millisecond)
	}
	res, _ := manager.ExecuteJS(context.Background(), envID, "__out", 1000)
	got := ""
	if res != nil {
		got = res.Result
	}
	t.Fatalf("probe did not produce output in time, last __out = %q", got)
	return ""
}

// TestFetch_SetCookie_MultiValue 是本 issue 的核心断言：两条 Set-Cookie 必须
// 各自完整可取，且含 ", " 的 Expires 属性不被切断。
func TestFetch_SetCookie_MultiValue(t *testing.T) {
	srv := newSetCookieServer(t)

	out := runFetchProbe(t, "multivalue", fmt.Sprintf(`
		fetch(%q).then(function(r) {
			__out = JSON.stringify({ cookies: r.headers.getSetCookie() });
		}).catch(function(e) { __out = JSON.stringify({ err: String(e) }); });
	`, srv.URL))

	var got struct {
		Cookies []string `json:"cookies"`
		Err     string   `json:"err"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("unmarshal probe output %q: %v", out, err)
	}
	if got.Err != "" {
		t.Fatalf("fetch rejected: %s", got.Err)
	}
	if len(got.Cookies) != 2 {
		t.Fatalf("getSetCookie() len = %d, want 2 (got %#v)", len(got.Cookies), got.Cookies)
	}
	if got.Cookies[0] != accessCodeCookie {
		t.Errorf("cookie[0] = %q, want %q", got.Cookies[0], accessCodeCookie)
	}
	// 这一条是折叠方案必然失败的地方：Expires 里的 ", " 会被当成条目分隔符。
	if got.Cookies[1] != expiresCookie {
		t.Errorf("cookie[1] = %q, want %q (Expires 含 \", \" 被切断了)", got.Cookies[1], expiresCookie)
	}
}

// TestFetch_Headers_204NotEmpty 正面回应 issue 里「204 的 headers 是空对象」的观察。
func TestFetch_Headers_204NotEmpty(t *testing.T) {
	srv := newSetCookieServer(t)

	out := runFetchProbe(t, "204", fmt.Sprintf(`
		fetch(%q).then(function(r) {
			__out = JSON.stringify({
				status: r.status,
				keyCount: Object.keys(r.headers).length,
				hasSetCookie: r.headers.has('set-cookie')
			});
		}).catch(function(e) { __out = JSON.stringify({ err: String(e) }); });
	`, srv.URL))

	var got struct {
		Status       int    `json:"status"`
		KeyCount     int    `json:"keyCount"`
		HasSetCookie bool   `json:"hasSetCookie"`
		Err          string `json:"err"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("unmarshal probe output %q: %v", out, err)
	}
	if got.Err != "" {
		t.Fatalf("fetch rejected: %s", got.Err)
	}
	if got.Status != http.StatusNoContent {
		t.Errorf("status = %d, want 204", got.Status)
	}
	if got.KeyCount == 0 {
		t.Error("204 响应的 headers 是空对象，说明响应头被丢弃了")
	}
	if !got.HasSetCookie {
		t.Error("has('set-cookie') = false, want true")
	}
}

// TestFetch_Headers_BackCompat 守住老插件的行为：新加的方法必须不可枚举，
// 属性式取值照旧可用。这是 C5 敢默认开启的前提。
func TestFetch_Headers_BackCompat(t *testing.T) {
	srv := newSetCookieServer(t)

	out := runFetchProbe(t, "backcompat", fmt.Sprintf(`
		fetch(%q).then(function(r) {
			var forInKeys = [];
			for (var k in r.headers) forInKeys.push(k);
			__out = JSON.stringify({
				objectKeys: Object.keys(r.headers),
				forInKeys: forInKeys,
				serialized: JSON.stringify(r.headers),
				directAccess: r.headers['Content-Type'] || ''
			});
		}).catch(function(e) { __out = JSON.stringify({ err: String(e) }); });
	`, srv.URL))

	var got struct {
		ObjectKeys   []string `json:"objectKeys"`
		ForInKeys    []string `json:"forInKeys"`
		Serialized   string   `json:"serialized"`
		DirectAccess string   `json:"directAccess"`
		Err          string   `json:"err"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("unmarshal probe output %q: %v", out, err)
	}
	if got.Err != "" {
		t.Fatalf("fetch rejected: %s", got.Err)
	}

	methods := []string{"get", "has", "getSetCookie", "forEach"}
	for _, m := range methods {
		for _, k := range got.ObjectKeys {
			if k == m {
				t.Errorf("Object.keys() 含方法名 %q，会污染枚举响应头的老插件", m)
			}
		}
		for _, k := range got.ForInKeys {
			if k == m {
				t.Errorf("for...in 含方法名 %q", m)
			}
		}
		if strings.Contains(got.Serialized, `"`+m+`"`) {
			t.Errorf("JSON.stringify(headers) 含方法名 %q: %s", m, got.Serialized)
		}
	}
	if got.DirectAccess != "application/json" {
		t.Errorf("headers['Content-Type'] = %q, want application/json（属性式取值被破坏）", got.DirectAccess)
	}
}

// TestFetch_Headers_CaseInsensitiveGet 锁住大小写不敏感：Go 侧 key 是 canonical
// 的 Set-Cookie，而插件普遍写小写 set-cookie。
func TestFetch_Headers_CaseInsensitiveGet(t *testing.T) {
	srv := newSetCookieServer(t)

	out := runFetchProbe(t, "caseinsensitive", fmt.Sprintf(`
		fetch(%q).then(function(r) {
			__out = JSON.stringify({
				lower: r.headers.get('set-cookie'),
				canonical: r.headers.get('Set-Cookie'),
				upper: r.headers.get('SET-COOKIE'),
				missing: r.headers.get('X-Absent'),
				missingHas: r.headers.has('X-Absent'),
				ctype: r.headers.get('content-type')
			});
		}).catch(function(e) { __out = JSON.stringify({ err: String(e) }); });
	`, srv.URL))

	var got struct {
		Lower      *string `json:"lower"`
		Canonical  *string `json:"canonical"`
		Upper      *string `json:"upper"`
		Missing    *string `json:"missing"`
		MissingHas bool    `json:"missingHas"`
		Ctype      *string `json:"ctype"`
		Err        string  `json:"err"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("unmarshal probe output %q: %v", out, err)
	}
	if got.Err != "" {
		t.Fatalf("fetch rejected: %s", got.Err)
	}
	if got.Lower == nil || got.Canonical == nil || got.Upper == nil {
		t.Fatalf("get() 大小写不敏感失败: lower=%v canonical=%v upper=%v", got.Lower, got.Canonical, got.Upper)
	}
	if *got.Lower != *got.Canonical || *got.Lower != *got.Upper {
		t.Errorf("三种大小写结果不一致: %q / %q / %q", *got.Lower, *got.Canonical, *got.Upper)
	}
	// get() 按 spec 合并多值为 ", " 串——这是有损的，所以 cookie 场景必须用 getSetCookie()。
	want := accessCodeCookie + ", " + expiresCookie
	if *got.Lower != want {
		t.Errorf("get('set-cookie') = %q, want %q", *got.Lower, want)
	}
	// 缺失的头按 spec 返回 null，不是 undefined、不是空串。
	if got.Missing != nil {
		t.Errorf("get('X-Absent') = %q, want null", *got.Missing)
	}
	if got.MissingHas {
		t.Error("has('X-Absent') = true, want false")
	}
	if got.Ctype == nil || *got.Ctype != "application/json" {
		t.Errorf("get('content-type') = %v, want application/json", got.Ctype)
	}
}

// TestFetch_Headers_ForEach 验证 forEach 只遍历响应头本身（不含新加的方法），
// 且回调签名是 spec 的 (value, name)。
func TestFetch_Headers_ForEach(t *testing.T) {
	srv := newSetCookieServer(t)

	out := runFetchProbe(t, "foreach", fmt.Sprintf(`
		fetch(%q).then(function(r) {
			var seen = [];
			var setCookieValue = '';
			r.headers.forEach(function(value, name) {
				seen.push(name);
				if (String(name).toLowerCase() === 'set-cookie') setCookieValue = value;
			});
			__out = JSON.stringify({ names: seen, setCookieValue: setCookieValue });
		}).catch(function(e) { __out = JSON.stringify({ err: String(e) }); });
	`, srv.URL))

	var got struct {
		Names          []string `json:"names"`
		SetCookieValue string   `json:"setCookieValue"`
		Err            string   `json:"err"`
	}
	if err := json.Unmarshal([]byte(out), &got); err != nil {
		t.Fatalf("unmarshal probe output %q: %v", out, err)
	}
	if got.Err != "" {
		t.Fatalf("fetch rejected: %s", got.Err)
	}
	for _, n := range got.Names {
		switch n {
		case "get", "has", "getSetCookie", "forEach":
			t.Errorf("forEach 遍历到了方法名 %q", n)
		}
	}
	// 同名多值只回调一次，值为合并串。
	count := 0
	for _, n := range got.Names {
		if strings.EqualFold(n, "Set-Cookie") {
			count++
		}
	}
	if count != 1 {
		t.Errorf("Set-Cookie 被回调 %d 次, want 1", count)
	}
	if want := accessCodeCookie + ", " + expiresCookie; got.SetCookieValue != want {
		t.Errorf("forEach 的 Set-Cookie 值 = %q, want %q", got.SetCookieValue, want)
	}
}

// TestDoHTTPRequest_HeadersList 在 Go 层直接断言 headersList 结构：
// 多值必须是数组且逐条完整，同时保留折叠的 headers 字段。
func TestDoHTTPRequest_HeadersList(t *testing.T) {
	srv := newSetCookieServer(t)

	raw := doHTTPRequest(srv.URL, http.MethodGet, "{}", "")
	if strings.Contains(raw, `"error"`) {
		t.Fatalf("doHTTPRequest returned error: %s", raw)
	}

	var got struct {
		Status      int                 `json:"status"`
		Headers     map[string]string   `json:"headers"`
		HeadersList map[string][]string `json:"headersList"`
	}
	if err := json.Unmarshal([]byte(raw), &got); err != nil {
		t.Fatalf("unmarshal doHTTPRequest result: %v\n%s", err, raw)
	}
	if got.Status != http.StatusNoContent {
		t.Errorf("status = %d, want 204", got.Status)
	}
	sc := got.HeadersList["Set-Cookie"]
	if len(sc) != 2 {
		t.Fatalf("headersList[Set-Cookie] len = %d, want 2 (%#v)", len(sc), sc)
	}
	if sc[0] != accessCodeCookie || sc[1] != expiresCookie {
		t.Errorf("headersList[Set-Cookie] = %#v, want [%q %q]", sc, accessCodeCookie, expiresCookie)
	}
	// 折叠字段必须保留，老插件仍按属性取值。
	if got.Headers["Content-Type"] != "application/json" {
		t.Errorf("headers[Content-Type] = %q, want application/json", got.Headers["Content-Type"])
	}
	if want := accessCodeCookie + ", " + expiresCookie; got.Headers["Set-Cookie"] != want {
		t.Errorf("headers[Set-Cookie] = %q, want %q", got.Headers["Set-Cookie"], want)
	}
}
