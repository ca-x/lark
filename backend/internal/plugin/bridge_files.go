package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"lark/backend/internal/plugin/host"
)

type fileRequest struct {
	Path      string `json:"path"`
	OldPath   string `json:"oldPath"`
	NewPath   string `json:"newPath"`
	Data      string `json:"data"`
	Encoding  string `json:"encoding"`
	Recursive bool   `json:"recursive"`
}

func (m *Manager) handleFS(ctx context.Context, service *Service, action, data string) (string, error) {
	var request fileRequest
	if err := json.Unmarshal([]byte(data), &request); err != nil {
		return "", &host.Error{Code: host.CodeInvalidArgument, Message: err.Error()}
	}
	paths := []string{request.Path}
	if action == "fs.rename" {
		paths = []string{request.OldPath, request.NewPath}
	}
	for _, filePath := range paths {
		permission, err := filePermission(filePath, service.plugin.ExternalPaths)
		if err != nil {
			return "", &host.Error{Code: host.CodeInvalidArgument, Message: err.Error()}
		}
		if !CheckPermission(service.plugin.Permissions, permission) {
			return "", &host.Error{Code: host.CodePermissionDenied, Message: fmt.Sprintf("%s requires %s", action, permission)}
		}
	}

	m.mu.RLock()
	var files host.FileHost
	var auth host.AuthHost
	if m.host != nil {
		files = m.host.Files()
		auth = m.host.Auth()
	}
	m.mu.RUnlock()
	if files == nil || auth == nil {
		return "", host.CapabilityUnavailable("filesystem")
	}
	info, err := auth.PluginInfo(ctx, service.plugin.EntryPath)
	if err != nil {
		return "", err
	}
	info.External = append([]string(nil), service.plugin.ExternalPaths...)

	var value any
	switch action {
	case "fs.readFile":
		return files.Read(ctx, info, request.Path, request.Encoding)
	case "fs.writeFile":
		err = files.Write(ctx, info, request.Path, request.Data, request.Encoding)
	case "fs.appendFile":
		err = files.Append(ctx, info, request.Path, request.Data, request.Encoding)
	case "fs.readdir":
		value, err = files.ReadDir(ctx, info, request.Path)
	case "fs.unlink":
		err = files.Remove(ctx, info, request.Path)
	case "fs.exists":
		var exists bool
		exists, err = files.Exists(ctx, info, request.Path)
		if err == nil {
			if exists {
				return "true", nil
			}
			return "false", nil
		}
	case "fs.mkdir":
		err = files.Mkdir(ctx, info, request.Path, request.Recursive)
	case "fs.stat":
		value, err = files.Stat(ctx, info, request.Path)
	case "fs.rename":
		err = files.Rename(ctx, info, request.OldPath, request.NewPath)
	default:
		return "", fmt.Errorf("unknown fs action %q", action)
	}
	if err != nil {
		return "", err
	}
	if value == nil {
		return "", nil
	}
	out, err := json.Marshal(value)
	return string(out), err
}

func filePermission(filePath string, externalPaths []string) (string, error) {
	if filePath == "" {
		return "", fmt.Errorf("path cannot be empty")
	}
	if strings.HasPrefix(filePath, "music://") {
		return PermFSMusic, nil
	}
	if filepath.IsAbs(filePath) {
		for _, allowed := range externalPaths {
			if pathWithin(allowed, filePath) {
				return PermFSExternal, nil
			}
		}
		return "", fmt.Errorf("absolute path is not declared in externalPaths")
	}
	return PermFS, nil
}

func pathWithin(base, target string) bool {
	base, err := filepath.Abs(base)
	if err != nil {
		return false
	}
	target, err = filepath.Abs(target)
	if err != nil {
		return false
	}
	return target == base || strings.HasPrefix(target, base+string(filepath.Separator))
}
