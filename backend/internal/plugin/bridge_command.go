package plugin

import (
	"context"
	"encoding/json"
	"fmt"

	"lark/backend/internal/plugin/host"
)

func (m *Manager) handleCommand(ctx context.Context, service *Service, action, data string) (string, error) {
	m.mu.RLock()
	pluginHost := m.host
	m.mu.RUnlock()
	if pluginHost == nil || pluginHost.Commands() == nil || pluginHost.Auth() == nil {
		return "", host.CapabilityUnavailable("command")
	}
	info, err := pluginHost.Auth().PluginInfo(ctx, service.plugin.EntryPath)
	if err != nil {
		return "", err
	}
	commands := pluginHost.Commands()

	switch action {
	case "command.exec":
		var request struct {
			Program string            `json:"program"`
			Args    []string          `json:"args"`
			Timeout int               `json:"timeout"`
			Stdin   string            `json:"stdin"`
			Env     map[string]string `json:"env"`
		}
		if err := json.Unmarshal([]byte(data), &request); err != nil {
			return "", invalidCommandRequest(action, err)
		}
		result, err := commands.Exec(ctx, info, request.Program, request.Args, host.CommandOptions{
			Timeout: request.Timeout, Stdin: request.Stdin, Env: request.Env,
		})
		return marshalCommandResult(result, err)
	case "command.start":
		var request struct {
			Name    string            `json:"name"`
			Program string            `json:"program"`
			Args    []string          `json:"args"`
			Env     map[string]string `json:"env"`
		}
		if err := json.Unmarshal([]byte(data), &request); err != nil {
			return "", invalidCommandRequest(action, err)
		}
		result, err := commands.Start(ctx, info, request.Name, request.Program, request.Args, host.CommandOptions{Env: request.Env})
		return marshalCommandResult(result, err)
	case "command.stop", "command.isRunning":
		var request struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal([]byte(data), &request); err != nil {
			return "", invalidCommandRequest(action, err)
		}
		if action == "command.stop" {
			return "", commands.Stop(ctx, info, request.Name)
		}
		running, err := commands.IsRunning(ctx, info, request.Name)
		return marshalCommandResult(running, err)
	case "command.download":
		var request struct {
			URL           string `json:"url"`
			Filename      string `json:"filename"`
			Extract       string `json:"extract"`
			ExtractTarget string `json:"extractTarget"`
		}
		if err := json.Unmarshal([]byte(data), &request); err != nil {
			return "", invalidCommandRequest(action, err)
		}
		return "", commands.Download(ctx, info, request.URL, request.Filename, host.CommandDownloadOptions{
			Extract: request.Extract, ExtractTarget: request.ExtractTarget,
		})
	case "command.deleteBin":
		return "", commands.DeleteBin(ctx, info, data)
	case "command.listBin":
		result, err := commands.ListBin(ctx, info)
		return marshalCommandResult(result, err)
	case "command.exists":
		result, err := commands.BinExists(ctx, info, data)
		return marshalCommandResult(result, err)
	default:
		return "", fmt.Errorf("unknown command action %q", action)
	}
}

func invalidCommandRequest(action string, err error) error {
	return &host.Error{Code: host.CodeInvalidArgument, Message: fmt.Sprintf("%s: %v", action, err)}
}

func marshalCommandResult(value any, err error) (string, error) {
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}
