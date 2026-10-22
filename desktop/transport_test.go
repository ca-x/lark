package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestAutomaticHTTPTransportNegotiation(t *testing.T) {
	for _, protocol := range []string{"connect", "grpc-web"} {
		t.Run(protocol, func(t *testing.T) {
			var probes, logins atomic.Int32
			var accepted atomic.Value
			accepted.Store(protocol)
			mux := http.NewServeMux()
			mux.Handle(desktopv1.DesktopService_GetServerInfo_FullMethodName, connect.NewUnaryHandler(desktopv1.DesktopService_GetServerInfo_FullMethodName,
				func(_ context.Context, request *connect.Request[desktopv1.GetServerInfoRequest]) (*connect.Response[desktopv1.GetServerInfoResponse], error) {
					if request.Header().Get("Authorization") != "" {
						t.Error("negotiation sent credentials")
					}
					return connect.NewResponse(&desktopv1.GetServerInfoResponse{ProtocolVersion: 1, Initialized: true}), nil
				}))
			mux.Handle(desktopv1.DesktopService_Login_FullMethodName, connect.NewUnaryHandler(desktopv1.DesktopService_Login_FullMethodName,
				func(_ context.Context, request *connect.Request[desktopv1.LoginRequest]) (*connect.Response[desktopv1.LoginResponse], error) {
					logins.Add(1)
					if request.Msg.GetUsername() != "listener" || request.Msg.GetPassword() != "secret" {
						t.Error("incorrect credentials")
					}
					return connect.NewResponse(&desktopv1.LoginResponse{SessionToken: "session-token", User: &desktopv1.User{Id: 1, Username: "listener"}}), nil
				}))
			mux.Handle(desktopv1.DesktopService_GetSession_FullMethodName, connect.NewUnaryHandler(desktopv1.DesktopService_GetSession_FullMethodName,
				func(_ context.Context, request *connect.Request[desktopv1.GetSessionRequest]) (*connect.Response[desktopv1.GetSessionResponse], error) {
					if request.Header().Get("Authorization") != "Bearer session-token" {
						return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("session required"))
					}
					return connect.NewResponse(&desktopv1.GetSessionResponse{User: &desktopv1.User{Id: 1, Username: "listener"}}), nil
				}))
			mux.Handle(desktopv1.DesktopService_StreamMedia_FullMethodName, connect.NewServerStreamHandler(desktopv1.DesktopService_StreamMedia_FullMethodName,
				func(_ context.Context, request *connect.Request[desktopv1.StreamMediaRequest], stream *connect.ServerStream[desktopv1.StreamMediaResponse]) error {
					if request.Header().Get("Authorization") != "Bearer session-token" || request.Msg.GetRange() != "bytes=2-5" {
						return connect.NewError(connect.CodeInvalidArgument, errors.New("range or session missing"))
					}
					if err := stream.Send(&desktopv1.StreamMediaResponse{Payload: &desktopv1.StreamMediaResponse_Header{Header: &desktopv1.MediaHeader{Status: 206, ContentRange: "bytes 2-5/10", ContentLength: 4}}}); err != nil {
						return err
					}
					return stream.Send(&desktopv1.StreamMediaResponse{Payload: &desktopv1.StreamMediaResponse_Data{Data: []byte("2345")}})
				}))
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.ProtoMajor != 1 {
					t.Errorf("proxy received %s, expected HTTP/1.1", request.Proto)
				}
				if request.URL.Path == desktopv1.DesktopService_GetServerInfo_FullMethodName {
					probes.Add(1)
				}
				isGRPCWeb := strings.HasPrefix(request.Header.Get("Content-Type"), "application/grpc-web")
				if (accepted.Load().(string) == "grpc-web") != isGRPCWeb {
					http.Error(writer, "protocol unsupported", http.StatusUnsupportedMediaType)
					return
				}
				mux.ServeHTTP(writer, request)
			}))
			t.Cleanup(server.Close)
			desktop, err := newDesktopClient(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(desktop.close)
			connected, err := desktop.Connect(withToken(t.Context(), "must-not-be-sent-in-probes"), server.URL, "listener", "secret", true)
			if err != nil || !connected.Connected || connected.Transport != protocol {
				t.Fatalf("connection = %+v, %v", connected, err)
			}
			if logins.Load() != 1 {
				t.Fatalf("login attempts = %d", logins.Load())
			}
			if protocol == "grpc-web" && probes.Load() != 2 {
				t.Fatalf("fallback probes = %d", probes.Load())
			}
			client, token, err := desktop.rpc(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			stream, err := client.StreamMedia(withToken(t.Context(), token), &desktopv1.StreamMediaRequest{Range: "bytes=2-5"})
			if err != nil {
				t.Fatal(err)
			}
			first, err := stream.Recv()
			if err != nil || first.GetHeader().GetContentRange() != "bytes 2-5/10" {
				t.Fatalf("header = %v, %v", first, err)
			}
			data, err := stream.Recv()
			if err != nil || string(data.GetData()) != "2345" {
				t.Fatalf("data = %v, %v", data, err)
			}
			if _, err := stream.Recv(); !errors.Is(err, io.EOF) {
				t.Fatalf("end of stream = %v", err)
			}
			reloaded, err := newDesktopClient(desktop.dataDir)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(reloaded.close)
			if state := reloaded.Status(t.Context()); !state.Connected || state.Transport != protocol {
				t.Fatalf("restored session = %+v", state)
			}
			if logins.Load() != 1 {
				t.Fatal("restoring a session repeated login")
			}
			nextProtocol := "connect"
			if protocol == "connect" {
				nextProtocol = "grpc-web"
			}
			accepted.Store(nextProtocol)
			if state := desktop.Status(t.Context()); !state.Connected || state.Transport != nextProtocol {
				t.Fatalf("renegotiated connection = %+v", state)
			}
			persisted, err := newDesktopClient(desktop.dataDir)
			if err != nil || persisted.config.Transport != nextProtocol || logins.Load() != 1 {
				t.Fatalf("renegotiated config/login = %v, %v, %d", persisted, err, logins.Load())
			}
		})
	}
}

func TestInvalidTLSCertificateDoesNotNegotiateAnotherProtocol(t *testing.T) {
	var connections atomic.Int32
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("request reached an untrusted TLS server")
	}))
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			connections.Add(1)
		}
	}
	server.StartTLS()
	t.Cleanup(server.Close)
	if _, _, _, err := dialDesktop(t.Context(), server.URL, false, ""); err == nil {
		t.Fatal("untrusted TLS certificate was accepted")
	}
	if connections.Load() != 1 {
		t.Fatalf("TLS failure triggered %d connection attempts", connections.Load())
	}
}

func TestHTTPMediaStreamCancellation(t *testing.T) {
	for _, protocol := range []string{"connect", "grpc-web"} {
		for _, reason := range []string{"context", "connection"} {
			t.Run(protocol+"/"+reason, func(t *testing.T) {
				stopped := make(chan struct{})
				handler := connect.NewServerStreamHandler(desktopv1.DesktopService_StreamMedia_FullMethodName,
					func(ctx context.Context, _ *connect.Request[desktopv1.StreamMediaRequest], stream *connect.ServerStream[desktopv1.StreamMediaResponse]) error {
						defer close(stopped)
						if err := stream.Send(&desktopv1.StreamMediaResponse{Payload: &desktopv1.StreamMediaResponse_Header{Header: &desktopv1.MediaHeader{Status: 200}}}); err != nil {
							return err
						}
						<-ctx.Done()
						return ctx.Err()
					})
				server := httptest.NewServer(handler)
				t.Cleanup(server.Close)
				connection, client := newDesktopHTTPClient(server.URL, protocol)
				t.Cleanup(func() { _ = connection.Close() })
				ctx, cancel := context.WithCancel(t.Context())
				t.Cleanup(cancel)
				stream, err := client.StreamMedia(ctx, &desktopv1.StreamMediaRequest{})
				if err != nil {
					t.Fatal(err)
				}
				if _, err := stream.Recv(); err != nil {
					t.Fatal(err)
				}
				if reason == "context" {
					cancel()
				} else if err := connection.Close(); err != nil {
					t.Fatal(err)
				}
				received := make(chan error, 1)
				go func() {
					_, err := stream.Recv()
					received <- err
				}()
				select {
				case err := <-received:
					if status.Code(err) != codes.Canceled {
						t.Fatalf("canceled stream = %v", err)
					}
				case <-time.After(2 * time.Second):
					t.Fatal("media stream survived cancellation")
				}
				select {
				case <-stopped:
				case <-time.After(2 * time.Second):
					t.Fatal("server media stream survived cancellation")
				}
				if reason == "connection" {
					if _, err := client.GetServerInfo(t.Context(), &desktopv1.GetServerInfoRequest{}); status.Code(err) != codes.Canceled {
						t.Fatalf("closed connection accepted another request: %v", err)
					}
				}
			})
		}
	}
}

func TestNegotiationCancellationStopsActiveProbe(t *testing.T) {
	var probes atomic.Int32
	started := make(chan struct{})
	handler := connect.NewUnaryHandler(desktopv1.DesktopService_GetServerInfo_FullMethodName,
		func(ctx context.Context, _ *connect.Request[desktopv1.GetServerInfoRequest]) (*connect.Response[desktopv1.GetServerInfoResponse], error) {
			if probes.Add(1) == 1 {
				close(started)
			}
			<-ctx.Done()
			return nil, ctx.Err()
		})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	result := make(chan error, 1)
	go func() {
		_, _, _, err := dialDesktop(ctx, server.URL, true, "")
		result <- err
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("negotiation probe did not start")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) || probes.Load() != 1 {
			t.Fatalf("canceled negotiation = %v, probes=%d", err, probes.Load())
		}
	case <-time.After(2 * time.Second):
		t.Fatal("negotiation ignored cancellation")
	}
}

func TestNegotiationStopsBeforeSendingCredentials(t *testing.T) {
	for _, reason := range []string{"forbidden", "disabled", "version", "login", "redirect", "rate-limit"} {
		t.Run(reason, func(t *testing.T) {
			var probes, logins atomic.Int32
			info := connect.NewUnaryHandler(desktopv1.DesktopService_GetServerInfo_FullMethodName,
				func(context.Context, *connect.Request[desktopv1.GetServerInfoRequest]) (*connect.Response[desktopv1.GetServerInfoResponse], error) {
					version := uint32(1)
					if reason == "version" {
						version = 2
					}
					return connect.NewResponse(&desktopv1.GetServerInfoResponse{ProtocolVersion: version}), nil
				})
			login := connect.NewUnaryHandler(desktopv1.DesktopService_Login_FullMethodName,
				func(context.Context, *connect.Request[desktopv1.LoginRequest]) (*connect.Response[desktopv1.LoginResponse], error) {
					logins.Add(1)
					return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid credentials"))
				})
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path == desktopv1.DesktopService_Login_FullMethodName {
					login.ServeHTTP(writer, request)
					return
				}
				probes.Add(1)
				switch reason {
				case "forbidden":
					http.Error(writer, "access denied", http.StatusForbidden)
				case "disabled":
					writer.Header().Set("Lark-Desktop-Disabled", "true")
					http.Error(writer, "disabled", http.StatusServiceUnavailable)
				case "redirect":
					http.Redirect(writer, request, "/access/login", http.StatusFound)
				case "rate-limit":
					http.Error(writer, "slow down", http.StatusTooManyRequests)
				default:
					info.ServeHTTP(writer, request)
				}
			}))
			t.Cleanup(server.Close)
			desktop, err := newDesktopClient(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(desktop.close)
			if _, err := desktop.Connect(t.Context(), server.URL, "listener", "secret", true); err == nil {
				t.Fatal("connection unexpectedly succeeded")
			}
			wantLogins := int32(0)
			if reason == "login" {
				wantLogins = 1
			}
			if probes.Load() != 1 || logins.Load() != wantLogins {
				t.Fatalf("probes=%d logins=%d", probes.Load(), logins.Load())
			}
		})
	}
}

func TestNegotiationRejectsSecurityAndCancellationErrors(t *testing.T) {
	for _, err := range []error{
		context.Canceled,
		status.Error(codes.PermissionDenied, "denied"),
		status.Error(codes.Unauthenticated, "expired"),
		&tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}},
	} {
		if canNegotiateTransport(desktopClientError(err)) {
			t.Errorf("fallback allowed after %v", err)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, _, _, err := dialDesktop(ctx, "http://127.0.0.1:1", true, ""); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled negotiation = %v", err)
	}
}
