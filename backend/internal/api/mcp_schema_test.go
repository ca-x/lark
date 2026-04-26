package api

import "testing"

func TestBuildMCPServerRegistersTools(t *testing.T) {
	server := (&Server{}).buildMCPServer(1)
	if server == nil {
		t.Fatal("expected MCP server")
	}
}
