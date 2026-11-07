package mygo

import (
	"context"
	"encoding/json/v2"
	"io"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRealNeteasePackageSignIn(t *testing.T) {
	fixture := os.Getenv("LARK_MYGO_NETEASE_FIXTURE")
	if fixture == "" {
		t.Skip("set LARK_MYGO_NETEASE_FIXTURE to sogud/mygo-music-netease v0.1.3 ZIP")
	}
	contents, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	var polls atomic.Int32
	service, err := New(t.Context(), &memoryStore{values: map[string][]byte{}}, t.TempDir(), WithHTTPClientFactory(func() *http.Client {
		return &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			body := ""
			headers := make(http.Header)
			switch request.URL.Host + request.URL.Path {
			case "interfacepc.music.163.com/eapi/login/qrcode/unikey":
				if err := request.ParseForm(); err != nil || len(request.PostForm.Get("params")) < 32 {
					t.Error("missing encrypted EAPI request", err)
				}
				body = `{"code":200,"unikey":"lark-fixture-qr"}`
			case "interfacepc.music.163.com/eapi/login/qrcode/client/login":
				polls.Add(1)
				body = `{"code":803}`
				headers.Add("Set-Cookie", "MUSIC_U=fixture-session; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/; HttpOnly")
				headers.Add("Set-Cookie", "__csrf=fixture-csrf; Path=/")
			case "music.163.com/api/nuser/account/get":
				if !strings.Contains(request.Header.Get("Cookie"), "MUSIC_U=fixture-session") {
					t.Error("login cookie was not forwarded")
				}
				body = `{"code":200,"profile":{"userId":123,"nickname":"Fixture account","avatarUrl":"https://music.163.com/avatar.jpg"}}`
			default:
				t.Errorf("unexpected plugin request: %s", request.URL)
				body = `{"code":500}`
			}
			return &http.Response{StatusCode: 200, Header: headers, Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
		})}
	}))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close(context.Background()) })
	preview, err := service.Preview(t.Context(), contents, "https://github.com/sogud/mygo-music-netease@v0.1.3")
	if err != nil {
		t.Fatal(err)
	}
	if preview.Manifest.ID != "netease" || preview.Manifest.Version != "0.1.3" {
		t.Fatal("fixture must be the requested NetEase v0.1.3 package")
	}
	installed, err := service.Install(t.Context(), preview.Token)
	if err != nil {
		t.Fatal(err)
	}
	if installed.Enabled {
		t.Fatal("installation must not enable the plugin")
	}
	if err := service.SetEnabled(t.Context(), "netease", true); err != nil {
		t.Fatal(err)
	}
	if err := service.Resume(t.Context()); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		result, err := service.Call(t.Context(), 1, "netease", "signIn", nil)
		if err == nil && !strings.Contains(string(result), "Fixture account") {
			err = io.ErrUnexpectedEOF
		}
		done <- err
	}()
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	qrSeen := false
	for {
		select {
		case <-deadline.C:
			t.Fatal("login timed out")
		case <-ticker.C:
			prompt, err := service.Prompt(t.Context(), 1, "netease")
			if err != nil {
				t.Fatal(err)
			}
			qrSeen = qrSeen || strings.Contains(string(prompt), "login?codekey=lark-fixture-qr")
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
			if !qrSeen || polls.Load() != 1 {
				t.Fatal("QR prompt/poll sequence incomplete")
			}
			account, err := service.Call(t.Context(), 2, "netease", "account", nil)
			if err != nil || string(account) != "null" {
				t.Fatal("account leaked to another user", string(account), err)
			}
			if _, err := service.Call(t.Context(), 1, "netease", "signOut", nil); err != nil {
				t.Fatal(err)
			}
			account, err = service.Call(t.Context(), 1, "netease", "account", nil)
			var signedOut any
			if err != nil || json.Unmarshal(account, &signedOut) != nil || signedOut != nil {
				t.Fatal("sign out did not clear the session", string(account), err)
			}
			return
		}
	}
}
