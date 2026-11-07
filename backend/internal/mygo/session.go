package mygo

import (
	"context"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"lark/backend/internal/pluginapp"

	"github.com/MoeForge/moejs"
	"github.com/MoeForge/moejs/eventloop"
	"github.com/MoeForge/moejs/webapi"
)

type userData struct {
	Settings map[string]string         `json:"settings"`
	Storage  map[string]jsontext.Value `json:"storage"`
}

type answer struct {
	data []byte
	err  error
}

type Session struct {
	ctx        context.Context
	cancel     context.CancelFunc
	once       sync.Once
	closed     atomic.Bool
	calls      chan struct{}
	lastUsed   atomic.Int64
	mediaUsers atomic.Int64
	dataMu     sync.Mutex
	runtime    *moejs.Runtime
	loop       *eventloop.Loop
	web        *webapi.API
	helper     moejs.Value
	manifest   Manifest
	exports    []string
	store      pluginapp.Store
	key        string
	data       userData
	prompt     jsontext.Value
	httpClient *http.Client
}

func compileModule(ctx context.Context, name string, source []byte) (*moejs.Module, error) {
	if len(source) == 0 || len(source) > maxSource {
		return nil, errors.New("missing or oversized module")
	}
	return moejs.CompileWith(name, string(source), moejs.CompileOptions{TypeScript: strings.HasSuffix(name, ".ts"), Context: ctx})
}

func newSession(ctx context.Context, pkg Package, store pluginapp.Store, key string, client *http.Client) (*Session, error) {
	compileCtx, stopCompile := context.WithTimeout(ctx, 10*time.Second)
	defer stopCompile()
	modules := map[string]*moejs.Module{}
	resolve := func(referrer moejs.Referrer, specifier string) (*moejs.Module, error) {
		if referrer == nil || (!strings.HasPrefix(specifier, "./") && !strings.HasPrefix(specifier, "../")) {
			return nil, errors.New("only packaged relative modules are supported")
		}
		name := path.Clean(path.Join(path.Dir(referrer.Name()), specifier))
		if !safeName(name) {
			return nil, errors.New("module escapes package")
		}
		if module := modules[name]; module != nil {
			return module, nil
		}
		module, err := compileModule(compileCtx, name, pkg.Files[name])
		if err != nil {
			return nil, err
		}
		modules[name] = module
		if len(modules) > 100 {
			return nil, errors.New("too many modules")
		}
		return module, nil
	}
	module, err := compileModule(compileCtx, pkg.Manifest.Main, pkg.Files[pkg.Manifest.Main])
	if err != nil {
		return nil, err
	}
	modules[pkg.Manifest.Main] = module
	module, err = moejs.Link(module, resolve)
	if err != nil {
		return nil, err
	}
	lifetime, cancel := context.WithCancel(context.Background())
	session := &Session{ctx: lifetime, cancel: cancel, manifest: pkg.Manifest, store: store, key: key, httpClient: client, calls: make(chan struct{}, 1), data: userData{Settings: map[string]string{}, Storage: map[string]jsontext.Value{}}}
	session.lastUsed.Store(time.Now().UnixNano())
	contents, err := store.Get(ctx, key)
	if err != nil {
		cancel()
		return nil, err
	}
	if len(contents) > 0 {
		if err := json.Unmarshal(contents, &session.data); err != nil {
			cancel()
			return nil, err
		}
	}
	if session.data.Settings == nil {
		session.data.Settings = map[string]string{}
	}
	if session.data.Storage == nil {
		session.data.Storage = map[string]jsontext.Value{}
	}
	session.runtime = moejs.NewRuntime(moejs.Options{MemoryLimit: 64 << 20})
	session.loop, err = eventloop.New(session.runtime, eventloop.Options{})
	if err != nil {
		cancel()
		return nil, err
	}
	session.web, err = webapi.Install(session.loop, session.webOptions())
	if err != nil {
		cancel()
		return nil, err
	}
	if err := session.installHost(); err != nil {
		session.Close()
		return nil, err
	}
	helper, err := moejs.CompileFunction("lark-mygo-call", "fn,arg,ok,bad", `try { Promise.resolve(fn(arg)).then(value => ok(value === undefined ? null : value), error => bad(String(error?.code || ""), String(error?.message || error))); } catch(error) { bad(String(error?.code || ""), String(error?.message || error)); }`, moejs.FunctionOptions{})
	if err != nil {
		session.Close()
		return nil, err
	}
	session.helper, err = session.runtime.RunScript(helper)
	if err != nil {
		session.Close()
		return nil, err
	}
	if err := session.loop.Start(); err != nil {
		session.Close()
		return nil, err
	}
	loaded := make(chan error, 1)
	session.loop.RunOnLoop(func(runtime *moejs.Runtime) { loaded <- runtime.Load(module) })
	select {
	case err = <-loaded:
		if err != nil && !errors.Is(err, moejs.ErrModulePending) {
			session.Close()
			return nil, fmt.Errorf("initialize mygo: %w", err)
		}
	case <-compileCtx.Done():
		session.Close()
		return nil, compileCtx.Err()
	}
	session.exports = module.Exports()
	return session, nil
}

func (s *Session) Close() {
	s.once.Do(func() {
		s.closed.Store(true)
		s.cancel()
		s.runtime.Interrupt(ErrDisabled)
		if s.web != nil {
			s.web.Close()
		}
		if s.loop != nil {
			s.loop.Terminate()
		}
		if s.httpClient != nil {
			s.httpClient.CloseIdleConnections()
		}
	})
}

func (s *Session) leaseMedia() func() {
	s.mediaUsers.Add(1)
	return sync.OnceFunc(func() { s.lastUsed.Store(time.Now().UnixNano()); s.mediaUsers.Add(-1) })
}

func (s *Session) Call(ctx context.Context, method string, params []byte) ([]byte, error) {
	if s.closed.Load() {
		return nil, ErrDisabled
	}
	timeout := 30 * time.Second
	if method == "signIn" {
		timeout = 5 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	select {
	case s.calls <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.ctx.Done():
		return nil, ErrDisabled
	}
	defer func() { <-s.calls }()
	s.lastUsed.Store(time.Now().UnixNano())
	result := make(chan answer, 1)
	queued := s.loop.RunOnLoop(func(runtime *moejs.Runtime) {
		function, exists := runtime.Export(method)
		if !exists {
			result <- answer{err: ErrUnsupported}
			return
		}
		argument := moejs.Undefined()
		var err error
		if len(params) > 0 {
			argument, err = runtime.ParseJSON(params)
			if err != nil {
				result <- answer{err: err}
				return
			}
		}
		finish := func(value answer) {
			select {
			case result <- value:
			default:
			}
			s.loop.RunOnLoop(func(runtime *moejs.Runtime) { runtime.ReleaseCallData() })
		}
		success := runtime.Function("ok", 1, func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
			contents, err := runtime.AppendJSON(nil, moejs.Arg(args, 0))
			if len(contents) > maxSource {
				contents = nil
				err = errors.New("plugin response exceeds 2 MiB")
			}
			finish(answer{contents, err})
			return moejs.Undefined(), nil
		})
		failure := runtime.Function("bad", 2, func(_ *moejs.Realm, _ moejs.Value, args []moejs.Value) (moejs.Value, error) {
			finish(answer{err: fmt.Errorf("%s: %s", moejs.Arg(args, 0).String(), moejs.Arg(args, 1).String())})
			return moejs.Undefined(), nil
		})
		if _, err := runtime.CallFunction(s.helper, moejs.Undefined(), function, argument, success, failure); err != nil {
			finish(answer{err: err})
		}
	})
	if !queued {
		return nil, ErrDisabled
	}
	select {
	case response := <-result:
		return response.data, response.err
	case <-ctx.Done():
		s.Close()
		return nil, ctx.Err()
	case <-s.ctx.Done():
		return nil, ErrDisabled
	}
}

func (s *Session) persistLocked() error {
	contents, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	if len(contents) > 10<<20 {
		return errors.New("mygo user storage quota exceeded")
	}
	ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
	defer cancel()
	return s.store.Put(ctx, s.key, contents)
}
