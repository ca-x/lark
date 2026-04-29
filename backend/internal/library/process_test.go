package library

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestCommandOutputLimitedTerminatesOversizedOutput(t *testing.T) {
	if os.Getenv("LARK_TEST_OUTPUT_HELPER") == "1" {
		fmt.Print(strings.Repeat("x", 1024))
		os.Exit(0)
	}

	cmd := exec.Command(os.Args[0], "-test.run=TestCommandOutputLimitedTerminatesOversizedOutput")
	cmd.Env = append(os.Environ(), "LARK_TEST_OUTPUT_HELPER=1")
	_, err := commandOutputLimited(cmd, 16)
	if !errors.Is(err, errProbeOutputTooLarge) {
		t.Fatalf("expected oversized output error, got %v", err)
	}
}
