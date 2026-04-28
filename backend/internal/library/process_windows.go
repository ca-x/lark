//go:build windows

package library

import "os/exec"

func prepareProbeProcessGroup(cmd *exec.Cmd) {
	// Windows syscall.SysProcAttr does not support Unix process groups.
	// CommandContext cancellation falls back to killing the direct ffprobe process.
	_ = cmd
}

func terminateProbeProcessGroup(cmd *exec.Cmd) bool {
	_ = cmd
	return false
}
