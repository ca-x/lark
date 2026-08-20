package jsruntime

import (
	"testing"
)

func TestSynchronousBridgeOnlyDispatchesRegistrationActions(t *testing.T) {
	manager := NewJSEnvManager()
	t.Cleanup(func() { _ = manager.Close() })
	const envID = "sync-bridge-allowlist"
	if err := manager.CreateEnv(envID, "", 1); err != nil {
		t.Fatal(err)
	}

	var dispatched []string
	if err := manager.SetBridgeCallback(envID, func(action, _ string) (string, error) {
		dispatched = append(dispatched, action)
		return "", nil
	}); err != nil {
		t.Fatal(err)
	}

	result, err := manager.ExecuteJS(t.Context(), envID, `JSON.stringify([
  __go_bridge_sync('plugin.registerLyricProvider', ''),
  __go_bridge_sync('storage.keys', '')
])`, 1_000)
	if err != nil {
		t.Fatal(err)
	}
	const expected = `["","synchronous bridge action is not allowed: storage.keys"]`
	if result.Result != expected {
		t.Fatalf("sync bridge result = %s, want %s", result.Result, expected)
	}
	if len(dispatched) != 1 || dispatched[0] != "plugin.registerLyricProvider" {
		t.Fatalf("dispatched actions = %v", dispatched)
	}
}
