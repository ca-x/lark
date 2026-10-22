package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/ca-x/lark/desktop/locales"
	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
	"github.com/egoist/mygo/audio"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type desktopConfig struct {
	ServerURL     string `json:"server_url"`
	AllowInsecure bool   `json:"allow_insecure"`
	Theme         string `json:"theme"`
	CloseBehavior string `json:"close_behavior"`
	Transport     string `json:"transport,omitempty"`
}

type desktopAuth struct {
	Token     string `json:"token"`
	Username  string `json:"username"`
	ServerURL string `json:"server_url"`
}

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Nickname string `json:"nickname"`
	Role     string `json:"role"`
}

type ConnectionStatus struct {
	Connected     bool   `json:"connected"`
	HasSession    bool   `json:"has_session"`
	ServerURL     string `json:"server_url"`
	Theme         string `json:"theme"`
	CloseBehavior string `json:"close_behavior"`
	User          *User  `json:"user,omitempty"`
	Error         string `json:"error,omitempty"`
	Transport     string `json:"transport,omitempty"`
}

type Desktop struct {
	mu               sync.Mutex
	dataDir          string
	config           desktopConfig
	auth             desktopAuth
	conn             io.Closer
	client           desktopv1.DesktopServiceClient
	activeTransport  string
	pendingLink      *DeepLink
	nativeMu         sync.Mutex
	nativePlayer     *audio.Player
	nativeSongID     int64
	nativeGeneration uint64
}

func newDesktopClient(dir string) (*Desktop, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(dir, 0o700); err != nil {
			return nil, err
		}
	}
	d := &Desktop{dataDir: dir}
	if err := readJSON(filepath.Join(dir, "config.json"), &d.config); err != nil {
		return nil, err
	}
	if err := readJSON(filepath.Join(dir, "auth.json"), &d.auth); err != nil {
		return nil, err
	}
	if d.auth.ServerURL != d.config.ServerURL {
		d.auth = desktopAuth{}
		_ = os.Remove(filepath.Join(dir, "auth.json"))
	}
	return d, nil
}

func readJSON(path string, value any) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, value)
}

func (d *Desktop) saveJSON(name string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(d.dataDir, "."+name+"-*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	path := filepath.Join(d.dataDir, name)
	if err := os.Rename(temp.Name(), path); err != nil {
		if runtime.GOOS != "windows" {
			return err
		}
		if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return removeErr
		}
		return os.Rename(temp.Name(), path)
	}
	return nil
}

func normalizeServerURL(raw string, allowInsecure bool) (string, string, grpc.DialOption, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", "", nil, errors.New(locales.InvalidServerURL())
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", "", nil, errors.New(locales.ServerSchemeRequired())
	}
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	if u.Scheme == "http" {
		host := strings.ToLower(u.Hostname())
		ip := net.ParseIP(host)
		local := host == "localhost" || strings.HasSuffix(host, ".local") || (ip != nil && (ip.IsLoopback() || ip.IsPrivate()))
		if !local || !allowInsecure {
			return "", "", nil, errors.New(locales.LocalHttpRestricted())
		}
	}
	u.Path = ""
	u.RawPath = ""
	var transport grpc.DialOption
	if u.Scheme == "https" {
		transport = grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12, ServerName: u.Hostname()}))
	} else {
		transport = grpc.WithTransportCredentials(insecure.NewCredentials())
	}
	return u.String(), net.JoinHostPort(u.Hostname(), port), transport, nil
}

func (d *Desktop) Connect(ctx context.Context, serverURL, username, password string, allowInsecure bool) (ConnectionStatus, error) {
	normalized, _, _, err := normalizeServerURL(serverURL, allowInsecure)
	if err != nil {
		return ConnectionStatus{}, err
	}
	checkCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	conn, client, protocol, err := dialDesktop(checkCtx, normalized, allowInsecure, "")
	if err != nil {
		return ConnectionStatus{}, fmt.Errorf("%s: %w", locales.ConnectFailed(), err)
	}
	defer func() {
		if conn != nil {
			_ = conn.Close()
		}
	}()
	login, err := client.Login(checkCtx, &desktopv1.LoginRequest{Username: username, Password: password})
	if err != nil {
		return ConnectionStatus{}, fmt.Errorf("%s: %w", locales.LoginFailed(), err)
	}
	d.mu.Lock()
	config := desktopConfig{ServerURL: normalized, AllowInsecure: allowInsecure, Theme: d.config.Theme, CloseBehavior: d.config.CloseBehavior, Transport: protocol}
	if config.CloseBehavior == "" {
		config.CloseBehavior = "tray"
	}
	auth := desktopAuth{Token: login.GetSessionToken(), Username: login.GetUser().GetUsername(), ServerURL: normalized}
	if err := d.saveJSON("config.json", config); err != nil {
		d.mu.Unlock()
		return ConnectionStatus{}, err
	}
	if err := d.saveJSON("auth.json", auth); err != nil {
		d.mu.Unlock()
		return ConnectionStatus{}, err
	}
	old := d.conn
	d.config, d.auth, d.conn, d.client = config, auth, conn, client
	d.activeTransport = protocol
	d.mu.Unlock()
	conn = nil
	if old != nil {
		_ = old.Close()
	}
	return ConnectionStatus{Connected: true, HasSession: true, ServerURL: normalized, Theme: config.Theme, CloseBehavior: config.CloseBehavior, Transport: protocol, User: desktopUser(login.GetUser())}, nil
}

func (d *Desktop) Status(ctx context.Context) ConnectionStatus {
	d.mu.Lock()
	config, auth := d.config, d.auth
	d.mu.Unlock()
	result := ConnectionStatus{ServerURL: config.ServerURL, Theme: config.Theme, CloseBehavior: d.closeBehavior(), Transport: config.Transport}
	if config.ServerURL == "" || auth.Token == "" {
		return result
	}
	result.HasSession = true
	checkCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, token, err := d.rpc(checkCtx)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	session, err := client.GetSession(withToken(checkCtx, token), &desktopv1.GetSessionRequest{})
	if err != nil && canNegotiateTransport(err) && checkCtx.Err() == nil {
		d.mu.Lock()
		old := d.conn
		d.conn, d.client = nil, nil
		d.config.Transport = ""
		d.mu.Unlock()
		if old != nil {
			_ = old.Close()
		}
		client, token, err = d.rpc(checkCtx)
		if err == nil {
			session, err = client.GetSession(withToken(checkCtx, token), &desktopv1.GetSessionRequest{})
		}
	}
	if err != nil {
		if status.Code(err) == codes.Unauthenticated {
			d.mu.Lock()
			d.auth = desktopAuth{}
			d.mu.Unlock()
			_ = os.Remove(filepath.Join(d.dataDir, "auth.json"))
			result.HasSession = false
		}
		result.Error = err.Error()
		return result
	}
	d.mu.Lock()
	result.Transport = d.activeTransport
	d.mu.Unlock()
	result.Connected, result.User = true, desktopUser(session.GetUser())
	return result
}

func (d *Desktop) Disconnect(ctx context.Context) error {
	d.NativeStop()
	client, token, err := d.rpc(ctx)
	if err == nil {
		checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		_, _ = client.Logout(withToken(checkCtx, token), &desktopv1.LogoutRequest{})
		cancel()
	}
	d.mu.Lock()
	old := d.conn
	d.auth, d.conn, d.client = desktopAuth{}, nil, nil
	d.activeTransport = ""
	d.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	if err := os.Remove(filepath.Join(d.dataDir, "auth.json")); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (d *Desktop) SetTheme(theme string) error {
	switch theme {
	case "classic", "vinyl", "cassette":
	default:
		return errors.New("unknown player theme")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	config := d.config
	config.Theme = theme
	if err := d.saveJSON("config.json", config); err != nil {
		return err
	}
	d.config = config
	return nil
}

func (d *Desktop) SetCloseBehavior(value string) error {
	if value != "tray" && value != "quit" {
		return errors.New("unknown close behavior")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	config := d.config
	config.CloseBehavior = value
	if err := d.saveJSON("config.json", config); err != nil {
		return err
	}
	d.config = config
	return nil
}

func (d *Desktop) closeBehavior() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.config.CloseBehavior == "quit" {
		return "quit"
	}
	return "tray"
}

func (d *Desktop) rpc(ctx context.Context) (desktopv1.DesktopServiceClient, string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.config.ServerURL == "" || d.auth.Token == "" {
		return nil, "", errors.New(locales.NotConnected())
	}
	if d.client == nil {
		conn, client, protocol, err := dialDesktop(ctx, d.config.ServerURL, d.config.AllowInsecure, d.config.Transport)
		if err != nil {
			return nil, "", err
		}
		config := d.config
		config.Transport = protocol
		if err := d.saveJSON("config.json", config); err != nil {
			_ = conn.Close()
			return nil, "", err
		}
		d.config = config
		d.conn, d.client = conn, client
		d.activeTransport = protocol
	}
	return d.client, d.auth.Token, nil
}

func (d *Desktop) close() {
	d.NativeStop()
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.conn != nil {
		_ = d.conn.Close()
	}
}

func withToken(ctx context.Context, token string) context.Context {
	return metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+token)
}

func desktopUser(user *desktopv1.User) *User {
	if user == nil {
		return nil
	}
	return &User{ID: user.GetId(), Username: user.GetUsername(), Nickname: user.GetNickname(), Role: user.GetRole()}
}
