//go:build windows

package api

import "os/exec"

func prepareExternalProcessGroup(cmd *exec.Cmd) {
	// Windows syscall.SysProcAttr does not support Unix process groups.
	// CommandContext cancellation falls back to killing the direct ffmpeg process.
	_ = cmd
}

func terminateExternalProcessGroup(cmd *exec.Cmd) bool {
	_ = cmd
	return false
}
