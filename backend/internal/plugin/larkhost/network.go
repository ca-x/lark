package larkhost

import (
	"context"
	"fmt"
	"net"
	"strconv"

	pluginhost "lark/backend/internal/plugin/host"
)

type networkHost Host

func (h *networkHost) AuthorizeBind(_ context.Context, _ pluginhost.PluginInfo, network, address string) error {
	if network != "udp4" {
		return fmt.Errorf("unsupported bind network %q", network)
	}
	if address == "" {
		address = ":0"
	}
	if _, err := net.ResolveUDPAddr(network, address); err != nil {
		return fmt.Errorf("invalid UDP bind address %q: %w", address, err)
	}
	return nil
}

func (h *networkHost) ResolveDial(ctx context.Context, _ pluginhost.PluginInfo, hostname string, port int) (string, error) {
	if hostname == "" || port <= 0 || port > 65_535 {
		return "", fmt.Errorf("invalid TCP destination %q:%d", hostname, port)
	}
	if literal := net.ParseIP(hostname); literal != nil {
		if !isPrivateNetworkIP(literal) {
			return "", fmt.Errorf("only private, loopback, or link-local TCP destinations are allowed")
		}
		return net.JoinHostPort(literal.String(), strconv.Itoa(port)), nil
	}

	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, hostname)
	if err != nil {
		return "", fmt.Errorf("resolve TCP destination %q: %w", hostname, err)
	}
	if len(addresses) == 0 {
		return "", fmt.Errorf("resolve TCP destination %q: no addresses", hostname)
	}
	for _, address := range addresses {
		if !isPrivateNetworkIP(address.IP) {
			return "", fmt.Errorf("only private, loopback, or link-local TCP destinations are allowed")
		}
	}
	return net.JoinHostPort(addresses[0].IP.String(), strconv.Itoa(port)), nil
}

func isPrivateNetworkIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}
