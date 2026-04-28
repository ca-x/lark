//go:build !windows

package library

import (
	"os/exec"
	"syscall"
)

func prepareProbeProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateProbeProcessGroup(cmd *exec.Cmd) bool {
	if cmd == nil || cmd.Process == nil || cmd.SysProcAttr == nil || !cmd.SysProcAttr.Setpgid {
		return false
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	return true
}
