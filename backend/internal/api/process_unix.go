//go:build !windows

package api

import (
	"os/exec"
	"syscall"
)

func prepareExternalProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateExternalProcessGroup(cmd *exec.Cmd) bool {
	if cmd == nil || cmd.Process == nil || cmd.SysProcAttr == nil || !cmd.SysProcAttr.Setpgid {
		return false
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	return true
}
