package larkhost

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	pluginhost "lark/backend/internal/plugin/host"
)

const maxPluginFileBytes int64 = 10 << 20

type fileHost Host

func (h *fileHost) Resolve(_ context.Context, info pluginhost.PluginInfo, name string) (string, error) {
	return resolveFilePath(info, name)
}

func (h *fileHost) Read(_ context.Context, info pluginhost.PluginInfo, name, encoding string) (string, error) {
	resolved, err := resolveFilePath(info, name)
	if err != nil {
		return "", err
	}
	stat, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if stat.IsDir() || stat.Size() > maxPluginFileBytes {
		return "", fmt.Errorf("plugin file is a directory or exceeds %dMB", maxPluginFileBytes>>20)
	}
	data, err := os.ReadFile(resolved)
	if err != nil {
		return "", err
	}
	if encoding == "base64" {
		return base64.StdEncoding.EncodeToString(data), nil
	}
	return string(data), nil
}

func (h *fileHost) Write(_ context.Context, info pluginhost.PluginInfo, name, value, encoding string) error {
	data, err := decodeFileData(value, encoding)
	if err != nil {
		return err
	}
	if int64(len(data)) > maxPluginFileBytes {
		return fmt.Errorf("plugin file exceeds %dMB", maxPluginFileBytes>>20)
	}
	resolved, err := resolveFilePath(info, name)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(resolved), 0o755); err != nil {
		return err
	}
	return os.WriteFile(resolved, data, 0o644)
}

func (h *fileHost) Append(_ context.Context, info pluginhost.PluginInfo, name, value, encoding string) error {
	data, err := decodeFileData(value, encoding)
	if err != nil {
		return err
	}
	resolved, err := resolveFilePath(info, name)
	if err != nil {
		return err
	}
	if stat, statErr := os.Stat(resolved); statErr == nil && stat.Size()+int64(len(data)) > maxPluginFileBytes {
		return fmt.Errorf("plugin file exceeds %dMB", maxPluginFileBytes>>20)
	}
	if err := os.MkdirAll(filepath.Dir(resolved), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(resolved, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.Write(data)
	return err
}

func (h *fileHost) ReadDir(_ context.Context, info pluginhost.PluginInfo, name string) ([]pluginhost.FileEntry, error) {
	resolved, err := resolveFilePath(info, name)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(resolved)
	if err != nil {
		return nil, err
	}
	result := make([]pluginhost.FileEntry, len(entries))
	for index, entry := range entries {
		result[index] = pluginhost.FileEntry{Name: entry.Name(), IsDir: entry.IsDir()}
	}
	return result, nil
}

func (h *fileHost) Remove(_ context.Context, info pluginhost.PluginInfo, name string) error {
	resolved, err := resolveFilePath(info, name)
	if err != nil {
		return err
	}
	stat, err := os.Stat(resolved)
	if err != nil {
		return err
	}
	if stat.IsDir() {
		return fmt.Errorf("cannot unlink a directory")
	}
	return os.Remove(resolved)
}

func (h *fileHost) Exists(_ context.Context, info pluginhost.PluginInfo, name string) (bool, error) {
	resolved, err := resolveFilePath(info, name)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(resolved)
	if os.IsNotExist(err) {
		return false, nil
	}
	return err == nil, err
}

func (h *fileHost) Mkdir(_ context.Context, info pluginhost.PluginInfo, name string, recursive bool) error {
	resolved, err := resolveFilePath(info, name)
	if err != nil {
		return err
	}
	if recursive {
		return os.MkdirAll(resolved, 0o755)
	}
	return os.Mkdir(resolved, 0o755)
}

func (h *fileHost) Stat(_ context.Context, info pluginhost.PluginInfo, name string) (pluginhost.FileStat, error) {
	resolved, err := resolveFilePath(info, name)
	if err != nil {
		return pluginhost.FileStat{}, err
	}
	stat, err := os.Stat(resolved)
	if err != nil {
		return pluginhost.FileStat{}, err
	}
	return pluginhost.FileStat{Size: stat.Size(), ModTime: stat.ModTime().UnixMilli(), IsDir: stat.IsDir()}, nil
}

func (h *fileHost) Rename(_ context.Context, info pluginhost.PluginInfo, oldName, newName string) error {
	oldPath, err := resolveFilePath(info, oldName)
	if err != nil {
		return err
	}
	newPath, err := resolveFilePath(info, newName)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
		return err
	}
	return os.Rename(oldPath, newPath)
}

func decodeFileData(value, encoding string) ([]byte, error) {
	if encoding == "base64" {
		return base64.StdEncoding.DecodeString(value)
	}
	return []byte(value), nil
}

func resolveFilePath(info pluginhost.PluginInfo, name string) (string, error) {
	if name == "" || strings.IndexByte(name, 0) >= 0 {
		return "", fmt.Errorf("path cannot be empty or contain NUL")
	}
	base, relative := info.DataDir, name
	if strings.HasPrefix(name, "music://") {
		base, relative = info.MusicDir, strings.TrimPrefix(name, "music://")
	} else if filepath.IsAbs(name) {
		for _, allowed := range info.External {
			if pathContained(allowed, name) {
				base, relative = allowed, strings.TrimPrefix(name, allowed)
				break
			}
		}
		if relative == name {
			return "", fmt.Errorf("path is not in externalPaths")
		}
	}
	if base == "" {
		return "", fmt.Errorf("filesystem base is not configured")
	}
	if hasParentTraversal(relative) {
		return "", fmt.Errorf("path cannot contain '..'")
	}
	resolved := filepath.Join(base, relative)
	if !pathContained(base, resolved) {
		return "", fmt.Errorf("path escapes allowed directory")
	}
	if err := verifyExistingAncestor(base, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func hasParentTraversal(name string) bool {
	for part := range strings.SplitSeq(filepath.ToSlash(name), "/") {
		if part == ".." {
			return true
		}
	}
	return false
}

func pathContained(base, target string) bool {
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

func verifyExistingAncestor(base, target string) error {
	if err := os.MkdirAll(base, 0o755); err != nil {
		return err
	}
	realBase, err := filepath.EvalSymlinks(base)
	if err != nil {
		return err
	}
	ancestor := target
	for {
		_, err = os.Lstat(ancestor)
		if err == nil {
			break
		}
		if !os.IsNotExist(err) {
			return err
		}
		parent := filepath.Dir(ancestor)
		if parent == ancestor {
			return fmt.Errorf("cannot resolve path ancestor")
		}
		ancestor = parent
	}
	realAncestor, err := filepath.EvalSymlinks(ancestor)
	if err != nil {
		return err
	}
	if !pathContained(realBase, realAncestor) {
		return fmt.Errorf("path escapes allowed directory through symlink")
	}
	return nil
}

var _ pluginhost.FileHost = (*fileHost)(nil)
