package plugin

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"lark/backend/internal/plugin/host"

	"golang.org/x/net/ipv4"
)

const (
	maxNetworkSocketsPerPlugin = 8
	maxUDPPayloadBytes         = 65_507
	udpReadBufferBytes         = 65_535
	defaultTCPDialTimeout      = 10 * time.Second
	maxTCPDialTimeout          = 60 * time.Second
)

type networkState struct {
	mu         sync.Mutex
	seq        atomic.Uint64
	ctx        context.Context
	cancel     context.CancelFunc
	closed     bool
	udp        map[string]*managedUDPSocket
	tcp        map[string]*managedTCPSocket
	udpPending int
	tcpPending int
}

type managedUDPSocket struct {
	id        string
	conn      *net.UDPConn
	done      chan struct{}
	closeOnce sync.Once
	opMu      sync.Mutex
}

type managedTCPSocket struct {
	id             string
	conn           net.Conn
	done           chan struct{}
	closeOnce      sync.Once
	suppressNotify atomic.Bool
	sendMu         sync.Mutex
}

type udpDataEvent struct {
	SocketID   string `json:"socketId"`
	Data       string `json:"data"`
	RemoteAddr string `json:"remoteAddr"`
}

type tcpDataEvent struct {
	SocketID string `json:"socketId"`
	Data     string `json:"data"`
}

type tcpCloseEvent struct {
	SocketID string `json:"socketId"`
}

func newNetworkState() *networkState {
	ctx, cancel := context.WithCancel(context.Background())
	return &networkState{ctx: ctx, cancel: cancel, udp: make(map[string]*managedUDPSocket), tcp: make(map[string]*managedTCPSocket)}
}

func (m *Manager) handleNetwork(ctx context.Context, service *Service, action, data string) (string, error) {
	if service.network == nil {
		service.network = newNetworkState()
	}
	m.mu.RLock()
	pluginHost := m.host
	m.mu.RUnlock()
	if pluginHost == nil || pluginHost.Network() == nil || pluginHost.Auth() == nil {
		return "", host.CapabilityUnavailable("network sockets")
	}
	info, err := pluginHost.Auth().PluginInfo(ctx, service.plugin.EntryPath)
	if err != nil {
		return "", err
	}

	switch action {
	case "net.udpBind":
		return m.networkUDPBind(ctx, service, pluginHost.Network(), info, data)
	case "net.udpSend":
		return "", m.networkUDPSend(service, data)
	case "net.udpJoinMulticast":
		return "", m.networkUDPJoinMulticast(service, data)
	case "net.udpLeaveMulticast":
		return "", m.networkUDPLeaveMulticast(service, data)
	case "net.udpGetLocalAddr":
		return m.networkUDPGetLocalAddr(service, data)
	case "net.udpClose":
		return "", m.networkUDPClose(service, data)
	case "net.tcpConnect":
		return m.networkTCPConnect(ctx, service, pluginHost.Network(), info, data)
	case "net.tcpSend":
		return "", m.networkTCPSend(service, data)
	case "net.tcpClose":
		return "", m.networkTCPClose(service, data)
	default:
		return "", fmt.Errorf("unknown network action %q", action)
	}
}

func (m *Manager) networkUDPBind(ctx context.Context, service *Service, policy host.NetworkHost, info host.PluginInfo, data string) (string, error) {
	var request struct {
		Address string `json:"address"`
	}
	if err := json.Unmarshal([]byte(data), &request); err != nil {
		return "", invalidNetworkRequest("net.udpBind", err)
	}
	if request.Address == "" {
		request.Address = ":0"
	}
	if err := policy.AuthorizeBind(ctx, info, "udp4", request.Address); err != nil {
		return "", err
	}
	address, err := net.ResolveUDPAddr("udp4", request.Address)
	if err != nil {
		return "", err
	}
	state := service.network
	if !state.reserveUDP() {
		return "", fmt.Errorf("maximum %d UDP sockets per plugin", maxNetworkSocketsPerPlugin)
	}
	committed := false
	defer func() {
		if !committed {
			state.releaseUDPReservation()
		}
	}()
	connection, err := net.ListenUDP("udp4", address)
	if err != nil {
		return "", fmt.Errorf("bind UDP socket: %w", err)
	}

	socket := &managedUDPSocket{
		id:   "udp-" + strconv.FormatUint(state.seq.Add(1), 10),
		conn: connection,
		done: make(chan struct{}),
	}
	if !state.commitUDP(socket) {
		committed = true
		_ = connection.Close()
		return "", fmt.Errorf("plugin network is closing")
	}
	committed = true
	go m.networkUDPReadLoop(service, socket)

	encoded, _ := json.Marshal(map[string]string{"socketId": socket.id, "localAddr": connection.LocalAddr().String()})
	return string(encoded), nil
}

func (m *Manager) networkUDPReadLoop(service *Service, socket *managedUDPSocket) {
	defer close(socket.done)
	defer socket.conn.Close()
	defer service.network.removeUDP(socket)
	buffer := make([]byte, udpReadBufferBytes)
	for {
		count, remote, err := socket.conn.ReadFromUDP(buffer)
		if err != nil {
			return
		}
		payload, err := json.Marshal(udpDataEvent{
			SocketID: socket.id, Data: base64.StdEncoding.EncodeToString(buffer[:count]), RemoteAddr: remote.String(),
		})
		if err == nil {
			_ = m.runtime.PostHostEvent(service.envID, "net_data", socket.id, string(payload))
		}
	}
}

func (m *Manager) networkUDPSend(service *Service, data string) error {
	var request struct {
		SocketID string `json:"socketId"`
		Data     string `json:"data"`
		Addr     string `json:"addr"`
	}
	if err := json.Unmarshal([]byte(data), &request); err != nil {
		return invalidNetworkRequest("net.udpSend", err)
	}
	socket := service.network.getUDP(request.SocketID)
	if socket == nil {
		return fmt.Errorf("UDP socket %q not found", request.SocketID)
	}
	payload, err := base64.StdEncoding.DecodeString(request.Data)
	if err != nil {
		payload = []byte(request.Data)
	}
	if len(payload) > maxUDPPayloadBytes {
		return fmt.Errorf("UDP payload exceeds %d bytes", maxUDPPayloadBytes)
	}
	remote, err := net.ResolveUDPAddr("udp4", request.Addr)
	if err != nil {
		return fmt.Errorf("resolve UDP destination %q: %w", request.Addr, err)
	}
	socket.opMu.Lock()
	_, err = socket.conn.WriteToUDP(payload, remote)
	socket.opMu.Unlock()
	return err
}

func (m *Manager) networkUDPJoinMulticast(service *Service, data string) error {
	request, socket, group, err := parseMulticastRequest(service, data)
	if err != nil {
		return err
	}
	packet := ipv4.NewPacketConn(socket.conn)
	interfaces, err := net.Interfaces()
	if err != nil {
		return err
	}
	joined := 0
	socket.opMu.Lock()
	defer socket.opMu.Unlock()
	for index := range interfaces {
		iface := &interfaces[index]
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagMulticast == 0 {
			continue
		}
		if packet.JoinGroup(iface, &net.UDPAddr{IP: group}) == nil {
			joined++
		}
	}
	if joined == 0 {
		return fmt.Errorf("failed to join multicast group %q on any interface", request.Group)
	}
	return nil
}

func (m *Manager) networkUDPLeaveMulticast(service *Service, data string) error {
	_, socket, group, err := parseMulticastRequest(service, data)
	if err != nil {
		return err
	}
	packet := ipv4.NewPacketConn(socket.conn)
	interfaces, err := net.Interfaces()
	if err != nil {
		return err
	}
	socket.opMu.Lock()
	defer socket.opMu.Unlock()
	for index := range interfaces {
		iface := &interfaces[index]
		if iface.Flags&net.FlagUp != 0 && iface.Flags&net.FlagMulticast != 0 {
			_ = packet.LeaveGroup(iface, &net.UDPAddr{IP: group})
		}
	}
	return nil
}

type multicastRequest struct {
	SocketID string `json:"socketId"`
	Group    string `json:"group"`
}

func parseMulticastRequest(service *Service, data string) (multicastRequest, *managedUDPSocket, net.IP, error) {
	var request multicastRequest
	if err := json.Unmarshal([]byte(data), &request); err != nil {
		return request, nil, nil, invalidNetworkRequest("multicast", err)
	}
	socket := service.network.getUDP(request.SocketID)
	if socket == nil {
		return request, nil, nil, fmt.Errorf("UDP socket %q not found", request.SocketID)
	}
	group := net.ParseIP(request.Group)
	if group == nil || group.To4() == nil || !group.IsMulticast() {
		return request, nil, nil, fmt.Errorf("invalid IPv4 multicast group %q", request.Group)
	}
	return request, socket, group, nil
}

func (m *Manager) networkUDPGetLocalAddr(service *Service, data string) (string, error) {
	var request struct {
		SocketID string `json:"socketId"`
	}
	if err := json.Unmarshal([]byte(data), &request); err != nil {
		return "", invalidNetworkRequest("net.udpGetLocalAddr", err)
	}
	socket := service.network.getUDP(request.SocketID)
	if socket == nil {
		return "", fmt.Errorf("UDP socket %q not found", request.SocketID)
	}
	encoded, _ := json.Marshal(map[string]string{"localAddr": socket.conn.LocalAddr().String()})
	return string(encoded), nil
}

func (m *Manager) networkUDPClose(service *Service, data string) error {
	var request struct {
		SocketID string `json:"socketId"`
	}
	if err := json.Unmarshal([]byte(data), &request); err != nil {
		return invalidNetworkRequest("net.udpClose", err)
	}
	socket := service.network.takeUDP(request.SocketID)
	if socket != nil {
		socket.close()
	}
	return nil
}

func (m *Manager) networkTCPConnect(ctx context.Context, service *Service, policy host.NetworkHost, info host.PluginInfo, data string) (string, error) {
	var request struct {
		Host    string `json:"host"`
		Port    int    `json:"port"`
		Timeout int    `json:"timeout"`
	}
	if err := json.Unmarshal([]byte(data), &request); err != nil {
		return "", invalidNetworkRequest("net.tcpConnect", err)
	}
	address, err := policy.ResolveDial(ctx, info, request.Host, request.Port)
	if err != nil {
		return "", err
	}
	timeout := defaultTCPDialTimeout
	if request.Timeout > 0 {
		timeout = min(time.Duration(request.Timeout)*time.Millisecond, maxTCPDialTimeout)
	}
	dialCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	state := service.network
	if !state.reserveTCP() {
		return "", fmt.Errorf("maximum %d TCP sockets per plugin", maxNetworkSocketsPerPlugin)
	}
	committed := false
	defer func() {
		if !committed {
			state.releaseTCPReservation()
		}
	}()
	stopCancelPropagation := context.AfterFunc(state.ctx, cancel)
	defer stopCancelPropagation()
	connection, err := (&net.Dialer{}).DialContext(dialCtx, "tcp", address)
	if err != nil {
		return "", fmt.Errorf("connect TCP socket: %w", err)
	}

	socket := &managedTCPSocket{
		id:   "tcp-" + strconv.FormatUint(state.seq.Add(1), 10),
		conn: connection,
		done: make(chan struct{}),
	}
	if !state.commitTCP(socket) {
		committed = true
		_ = connection.Close()
		return "", fmt.Errorf("plugin network is closing")
	}
	committed = true
	go m.networkTCPReadLoop(service, socket)

	encoded, _ := json.Marshal(map[string]string{
		"socketId": socket.id, "localAddr": connection.LocalAddr().String(), "remoteAddr": connection.RemoteAddr().String(),
	})
	return string(encoded), nil
}

func (m *Manager) networkTCPReadLoop(service *Service, socket *managedTCPSocket) {
	defer close(socket.done)
	defer socket.conn.Close()
	buffer := make([]byte, udpReadBufferBytes)
	for {
		count, err := socket.conn.Read(buffer)
		if count > 0 {
			payload, marshalErr := json.Marshal(tcpDataEvent{
				SocketID: socket.id, Data: base64.StdEncoding.EncodeToString(buffer[:count]),
			})
			if marshalErr == nil {
				_ = m.runtime.PostHostEvent(service.envID, "tcp_data", socket.id, string(payload))
			}
		}
		if err != nil {
			service.network.removeTCP(socket)
			if !socket.suppressNotify.Load() {
				payload, _ := json.Marshal(tcpCloseEvent{SocketID: socket.id})
				_ = m.runtime.PostHostEvent(service.envID, "tcp_close", socket.id, string(payload))
			}
			return
		}
	}
}

func (m *Manager) networkTCPSend(service *Service, data string) error {
	var request struct {
		SocketID string `json:"socketId"`
		Data     string `json:"data"`
	}
	if err := json.Unmarshal([]byte(data), &request); err != nil {
		return invalidNetworkRequest("net.tcpSend", err)
	}
	socket := service.network.getTCP(request.SocketID)
	if socket == nil {
		return fmt.Errorf("TCP socket %q not found", request.SocketID)
	}
	payload, err := base64.StdEncoding.DecodeString(request.Data)
	if err != nil {
		payload = []byte(request.Data)
	}
	socket.sendMu.Lock()
	_, err = io.Copy(socket.conn, bytes.NewReader(payload))
	socket.sendMu.Unlock()
	return err
}

func (m *Manager) networkTCPClose(service *Service, data string) error {
	var request struct {
		SocketID string `json:"socketId"`
	}
	if err := json.Unmarshal([]byte(data), &request); err != nil {
		return invalidNetworkRequest("net.tcpClose", err)
	}
	socket := service.network.takeTCP(request.SocketID)
	if socket != nil {
		socket.suppressNotify.Store(true)
		socket.close()
	}
	return nil
}

func invalidNetworkRequest(action string, err error) error {
	return &host.Error{Code: host.CodeInvalidArgument, Message: fmt.Sprintf("%s: %v", action, err)}
}

func (state *networkState) getUDP(id string) *managedUDPSocket {
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.udp[id]
}

func (state *networkState) reserveUDP() bool {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.closed || len(state.udp)+state.udpPending >= maxNetworkSocketsPerPlugin {
		return false
	}
	state.udpPending++
	return true
}

func (state *networkState) releaseUDPReservation() {
	state.mu.Lock()
	state.udpPending--
	state.mu.Unlock()
}

func (state *networkState) commitUDP(socket *managedUDPSocket) bool {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.udpPending--
	if state.closed {
		return false
	}
	state.udp[socket.id] = socket
	return true
}

func (state *networkState) takeUDP(id string) *managedUDPSocket {
	state.mu.Lock()
	defer state.mu.Unlock()
	socket := state.udp[id]
	delete(state.udp, id)
	return socket
}

func (state *networkState) removeUDP(socket *managedUDPSocket) {
	state.mu.Lock()
	if state.udp[socket.id] == socket {
		delete(state.udp, socket.id)
	}
	state.mu.Unlock()
}

func (state *networkState) getTCP(id string) *managedTCPSocket {
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.tcp[id]
}

func (state *networkState) reserveTCP() bool {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.closed || len(state.tcp)+state.tcpPending >= maxNetworkSocketsPerPlugin {
		return false
	}
	state.tcpPending++
	return true
}

func (state *networkState) releaseTCPReservation() {
	state.mu.Lock()
	state.tcpPending--
	state.mu.Unlock()
}

func (state *networkState) commitTCP(socket *managedTCPSocket) bool {
	state.mu.Lock()
	defer state.mu.Unlock()
	state.tcpPending--
	if state.closed {
		return false
	}
	state.tcp[socket.id] = socket
	return true
}

func (state *networkState) takeTCP(id string) *managedTCPSocket {
	state.mu.Lock()
	defer state.mu.Unlock()
	socket := state.tcp[id]
	delete(state.tcp, id)
	return socket
}

func (state *networkState) removeTCP(socket *managedTCPSocket) {
	state.mu.Lock()
	if state.tcp[socket.id] == socket {
		delete(state.tcp, socket.id)
	}
	state.mu.Unlock()
}

func (socket *managedUDPSocket) close() {
	socket.closeOnce.Do(func() {
		socket.opMu.Lock()
		_ = socket.conn.Close()
		socket.opMu.Unlock()
		<-socket.done
	})
}

func (socket *managedTCPSocket) close() {
	socket.closeOnce.Do(func() {
		_ = socket.conn.Close()
		<-socket.done
	})
}

func (service *Service) closeNetwork() {
	if service == nil || service.network == nil {
		return
	}
	state := service.network
	state.mu.Lock()
	state.closed = true
	state.cancel()
	udpSockets := make([]*managedUDPSocket, 0, len(state.udp))
	for _, socket := range state.udp {
		udpSockets = append(udpSockets, socket)
	}
	tcpSockets := make([]*managedTCPSocket, 0, len(state.tcp))
	for _, socket := range state.tcp {
		tcpSockets = append(tcpSockets, socket)
	}
	clear(state.udp)
	clear(state.tcp)
	state.mu.Unlock()
	for _, socket := range udpSockets {
		socket.close()
	}
	for _, socket := range tcpSockets {
		socket.suppressNotify.Store(true)
		socket.close()
	}
}
