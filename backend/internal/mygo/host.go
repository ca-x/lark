package mygo

import (
	"crypto/aes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"runtime"
	"slices"
	"strings"

	"lark/backend/internal/pluginruntime"

	"github.com/MoeForge/moejs"
	"github.com/MoeForge/moejs/webapi"
	"golang.org/x/net/publicsuffix"
)

var placeholder = regexp.MustCompile(`\{(setting|storage):([^{}]+)\}`)

func (s *Session) installHost() error {
	unsupported := moejs.NativeFunc(func(*moejs.Realm, moejs.Value, []moejs.Value) (moejs.Value, error) {
		return moejs.Undefined(), ErrUnsupported
	})
	noop := moejs.NativeFunc(func(*moejs.Realm, moejs.Value, []moejs.Value) (moejs.Value, error) { return moejs.Undefined(), nil })
	if err := s.runtime.SetGlobal("console", map[string]any{"log": noop, "info": noop, "warn": noop, "error": noop, "debug": noop}); err != nil {
		return err
	}
	return s.runtime.SetGlobal("host", map[string]any{
		"platform": runtime.GOOS, "arch": runtime.GOARCH, "dir": "/package", "dataDir": "/data",
		"storage": map[string]any{
			"get": moejs.NativeFunc(func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
				s.dataMu.Lock()
				defer s.dataMu.Unlock()
				contents, exists := s.data.Storage[moejs.Arg(args, 0).String()]
				if !exists {
					return moejs.Undefined(), nil
				}
				return s.runtime.ParseJSON(contents)
			}),
			"set": moejs.NativeFunc(func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
				key := moejs.Arg(args, 0).String()
				if len(key) > 256 {
					return moejs.Undefined(), errors.New("storage key too long")
				}
				contents, err := s.runtime.AppendJSON(nil, moejs.Arg(args, 1))
				if err != nil {
					return moejs.Undefined(), err
				}
				if len(contents) > 1<<20 {
					return moejs.Undefined(), errors.New("storage value exceeds 1 MiB")
				}
				s.dataMu.Lock()
				defer s.dataMu.Unlock()
				old, existed := s.data.Storage[key]
				s.data.Storage[key] = contents
				err = s.persistLocked()
				if err != nil {
					if existed {
						s.data.Storage[key] = old
					} else {
						delete(s.data.Storage, key)
					}
				}
				return moejs.Undefined(), err
			}),
			"remove": moejs.NativeFunc(func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
				s.dataMu.Lock()
				defer s.dataMu.Unlock()
				key := moejs.Arg(args, 0).String()
				old, exists := s.data.Storage[key]
				delete(s.data.Storage, key)
				err := s.persistLocked()
				if err != nil && exists {
					s.data.Storage[key] = old
				}
				return moejs.Undefined(), err
			}),
		},
		"setting": moejs.NativeFunc(func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
			s.dataMu.Lock()
			defer s.dataMu.Unlock()
			return moejs.String(s.data.Settings[moejs.Arg(args, 0).String()]), nil
		}),
		"language": moejs.NativeFunc(func(*moejs.Realm, moejs.Value, []moejs.Value) (moejs.Value, error) { return moejs.String("zh-CN"), nil }),
		"t": moejs.NativeFunc(func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
			return moejs.Arg(args, 0), nil
		}),
		"signInPrompt": moejs.NativeFunc(func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
			contents, err := s.runtime.AppendJSON(nil, moejs.Arg(args, 0))
			if len(contents) > 64<<10 {
				return moejs.Undefined(), errors.New("sign-in prompt too large")
			}
			s.dataMu.Lock()
			s.prompt = contents
			s.dataMu.Unlock()
			return moejs.Undefined(), err
		}),
		"crypto": map[string]any{
			"md5": moejs.NativeFunc(func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
				sum := md5.Sum([]byte(moejs.Arg(args, 0).String()))
				return moejs.String(hex.EncodeToString(sum[:])), nil
			}),
			"aesEcbEncrypt": moejs.NativeFunc(func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
				key, plain := []byte(moejs.Arg(args, 0).String()), []byte(moejs.Arg(args, 1).String())
				cipher, err := aes.NewCipher(key)
				if err != nil {
					return moejs.Undefined(), err
				}
				padding := aes.BlockSize - len(plain)%aes.BlockSize
				for range padding {
					plain = append(plain, byte(padding))
				}
				out := make([]byte, len(plain))
				for offset := 0; offset < len(plain); offset += aes.BlockSize {
					cipher.Encrypt(out[offset:], plain[offset:])
				}
				return moejs.String(hex.EncodeToString(out)), nil
			}),
		},
		"spawn": unsupported, "webSignIn": unsupported, "waitForRedirect": unsupported, "openURL": unsupported, "removeDataDir": unsupported,
	})
}

func (s *Session) reaches(host string) bool {
	for _, pattern := range s.manifest.Permissions.Network {
		if pluginruntime.HostMatches(host, pattern) {
			return true
		}
	}
	return false
}

func (s *Session) webOptions() webapi.Options {
	clientCopy := *s.httpClient
	client := &clientCopy
	client.Jar, _ = cookiejar.New(&cookiejar.Options{PublicSuffixList: publicsuffix.List})
	s.httpClient = client
	return webapi.Options{Client: client, Context: s.ctx, Allow: func(request *http.Request) error {
		if err := pluginruntime.ValidateURL(request.URL); err != nil {
			return err
		}
		if !s.reaches(request.URL.Hostname()) {
			return errors.New("network permission denied")
		}
		if request.Host != "" && !strings.EqualFold(request.Host, request.URL.Host) {
			return errors.New("custom Host is unavailable")
		}
		return nil
	}}
}

func (s *Session) Headers(address *url.URL, kind string) (http.Header, error) {
	if err := pluginruntime.ValidateURL(address); err != nil {
		return nil, err
	}
	if !s.reaches(address.Hostname()) {
		return nil, errors.New("media host is outside network permission")
	}
	s.dataMu.Lock()
	defer s.dataMu.Unlock()
	out := make(http.Header)
	cookies := []string{}
	for _, cookie := range s.httpClient.Jar.Cookies(address) {
		cookies = append(cookies, cookie.String())
	}
	if len(cookies) > 0 {
		out.Set("Cookie", strings.Join(cookies, "; "))
	}
	for _, rule := range s.manifest.RequestHeaders {
		if len(rule.Kinds) > 0 && !slices.Contains(rule.Kinds, kind) {
			continue
		}
		matches := false
		for _, pattern := range rule.Hosts {
			if key, ok := strings.CutPrefix(pattern, "{setting:"); ok {
				server, _ := url.Parse(s.data.Settings[strings.TrimSuffix(key, "}")])
				if server != nil && strings.EqualFold(server.Hostname(), address.Hostname()) {
					matches = true
				}
			} else if pattern != "*" && pluginruntime.HostMatches(address.Hostname(), pattern) {
				matches = true
			}
		}
		if !matches {
			continue
		}
		for name, value := range rule.Headers {
			valid := true
			value = placeholder.ReplaceAllStringFunc(value, func(token string) string {
				parts := placeholder.FindStringSubmatch(token)
				if parts[1] == "setting" {
					text := s.data.Settings[parts[2]]
					if text == "" {
						valid = false
					}
					return text
				}
				raw, exists := s.data.Storage[parts[2]]
				if !exists {
					valid = false
					return ""
				}
				var text string
				if json.Unmarshal(raw, &text) == nil {
					return text
				}
				return string(raw)
			})
			if !valid {
				continue
			}
			canonical := http.CanonicalHeaderKey(name)
			if slices.Contains([]string{"Host", "Content-Length", "Connection", "Transfer-Encoding", "Proxy-Authorization", "Range", "Cookie2"}, canonical) || strings.ContainsAny(name+value, "\r\n\x00") {
				return nil, fmt.Errorf("invalid media header")
			}
			out.Set(canonical, value)
		}
	}
	return out, nil
}
