package larkhost

import (
	"testing"

	pluginhost "lark/backend/internal/plugin/host"
)

func TestNetworkHostOnlyResolvesPrivateTCPDestinations(t *testing.T) {
	network := New(nil, nil, Config{}).Network()
	info := pluginhost.PluginInfo{EntryPath: "network-test"}
	resolved, err := network.ResolveDial(t.Context(), info, "127.0.0.1", 6600)
	if err != nil || resolved != "127.0.0.1:6600" {
		t.Fatalf("private destination = %q, %v", resolved, err)
	}
	if _, err := network.ResolveDial(t.Context(), info, "8.8.8.8", 53); err == nil {
		t.Fatal("public TCP destination was allowed")
	}
}
