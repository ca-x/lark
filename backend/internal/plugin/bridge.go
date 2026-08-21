package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"lark/backend/internal/jsruntime"
	"lark/backend/internal/plugin/host"
)

func (m *Manager) handleBridge(ctx context.Context, service *Service, action, data string) (string, error) {
	if service == nil {
		return "", fmt.Errorf("plugin service is unavailable")
	}
	if permission := permissionForAction(action); permission != "" && !CheckPermission(service.plugin.Permissions, permission) {
		return "", &host.Error{Code: host.CodePermissionDenied, Message: fmt.Sprintf("%s requires %s", action, permission)}
	}
	switch {
	case strings.HasPrefix(action, "storage."):
		return m.handleStorage(ctx, service, StorageVolatile, action, data)
	case strings.HasPrefix(action, "persistent-storage."):
		return m.handleStorage(ctx, service, StoragePersistent, action, data)
	case strings.HasPrefix(action, "plugin."):
		return m.handlePlugin(ctx, service, action, data)
	case strings.HasPrefix(action, "songs."):
		return m.handleSongs(ctx, service, action, data)
	case strings.HasPrefix(action, "playlists."):
		return m.handlePlaylists(ctx, service, action, data)
	case strings.HasPrefix(action, "jsenv."):
		return m.handleJSEnv(ctx, service, action, data)
	case strings.HasPrefix(action, "fs."):
		return m.handleFS(ctx, service, action, data)
	case strings.HasPrefix(action, "command."):
		return m.handleCommand(ctx, service, action, data)
	case strings.HasPrefix(action, "net."):
		return m.handleNetwork(ctx, service, action, data)
	case strings.HasPrefix(action, "websocket."):
		return m.handleWebSocket(service, action, data)
	case strings.HasPrefix(action, "comm."):
		return m.handleComm(ctx, service, action, data)
	default:
		return "", fmt.Errorf("unknown bridge action %q", action)
	}
}

func (m *Manager) handleComm(ctx context.Context, sender *Service, action, data string) (string, error) {
	var request struct {
		To      string          `json:"to"`
		Action  string          `json:"action"`
		Payload json.RawMessage `json:"payload"`
		Timeout int             `json:"timeout"`
	}
	if err := json.Unmarshal([]byte(data), &request); err != nil {
		return "", &host.Error{Code: host.CodeInvalidArgument, Message: err.Error()}
	}
	request.To = strings.TrimSpace(request.To)
	request.Action = strings.TrimSpace(request.Action)
	if request.To == "" || request.Action == "" {
		return "", &host.Error{Code: host.CodeInvalidArgument, Message: "comm target and action are required"}
	}
	if err := m.EnsureLoaded(ctx, request.To); err != nil {
		return "", fmt.Errorf("target plugin %q is not running: %w", request.To, err)
	}
	m.mu.RLock()
	target := m.services[request.To]
	m.mu.RUnlock()
	if target == nil {
		return "", fmt.Errorf("target plugin %q is not running", request.To)
	}
	if !CheckPermission(target.plugin.Permissions, PermInterPlugin) {
		return "", &host.Error{Code: host.CodePermissionDenied, Message: fmt.Sprintf("target plugin %q requires %s", request.To, PermInterPlugin)}
	}

	payload, err := json.Marshal(host.Message{
		From: sender.plugin.EntryPath, To: request.To, Action: request.Action, Payload: request.Payload,
	})
	if err != nil {
		return "", err
	}
	timeout := 10 * time.Second
	if request.Timeout > 0 {
		timeout = min(time.Duration(request.Timeout)*time.Millisecond, 60*time.Second)
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	result, err := m.runtime.ExecuteJSCall(callCtx, target.envID, "__handleInterPluginMessage", timeout.Milliseconds(), string(payload))
	if err != nil {
		return "", fmt.Errorf("inter-plugin %s to %q: %w", action, request.To, err)
	}
	if action == "comm.send" {
		return "", nil
	}
	if action != "comm.call" {
		return "", fmt.Errorf("unknown comm action %q", action)
	}
	return result.Result, nil
}

func permissionForAction(action string) string {
	switch {
	case strings.HasPrefix(action, "storage."):
		return PermStorage
	case strings.HasPrefix(action, "persistent-storage."):
		return PermPersistentStorage
	case action == "songs.list", action == "songs.getById", action == "songs.search":
		return PermSongsRead
	case strings.HasPrefix(action, "songs."):
		return PermSongsWrite
	case action == "playlists.list", action == "playlists.getById", action == "playlists.getSongs", action == "playlists.search":
		return PermPlaylistsRead
	case strings.HasPrefix(action, "playlists."):
		return PermPlaylistsWrite
	case strings.HasPrefix(action, "jsenv."):
		return PermJSEnv
	// SongLoft checks fs permissions from the requested path: relative paths
	// need fs, music:// needs fs:music, and allowlisted absolute paths need
	// fs:external. A blanket fs check would reject valid fs:music plugins.
	case strings.HasPrefix(action, "fs."):
		return ""
	case strings.HasPrefix(action, "command."):
		return PermCommand
	case strings.HasPrefix(action, "net."):
		return PermNet
	case strings.HasPrefix(action, "websocket."):
		return PermWebSocket
	case strings.HasPrefix(action, "comm."):
		return PermInterPlugin
	default:
		return ""
	}
}

func (m *Manager) handleStorage(ctx context.Context, service *Service, namespace StorageNamespace, action, data string) (string, error) {
	key := data
	var input struct {
		Key   string          `json:"key"`
		Value json.RawMessage `json:"value"`
	}
	if strings.HasSuffix(action, ".set") {
		if err := json.Unmarshal([]byte(data), &input); err != nil {
			return "", &host.Error{Code: host.CodeInvalidArgument, Message: err.Error()}
		}
		key = input.Key
	}
	var storage host.StorageHost
	m.mu.RLock()
	if m.host != nil {
		storage = m.host.Storage()
	}
	m.mu.RUnlock()
	if storage != nil {
		switch action {
		case "storage.get", "persistent-storage.get":
			value, found, err := storage.Get(ctx, service.plugin.EntryPath, string(namespace), key)
			if err != nil {
				return "", err
			}
			if !found {
				return "", nil
			}
			return string(value), nil
		case "storage.set", "persistent-storage.set":
			return "", storage.Set(ctx, service.plugin.EntryPath, string(namespace), key, input.Value)
		case "storage.delete", "persistent-storage.delete":
			return "", storage.Delete(ctx, service.plugin.EntryPath, string(namespace), key)
		case "storage.keys", "persistent-storage.keys":
			keys, err := storage.Keys(ctx, service.plugin.EntryPath, string(namespace))
			if err != nil {
				return "", err
			}
			out, _ := json.Marshal(keys)
			return string(out), nil
		}
	}
	if m.repo == nil {
		return "", host.CapabilityUnavailable("storage")
	}
	switch action {
	case "storage.get", "persistent-storage.get":
		value, found, err := m.repo.StorageGet(ctx, service.plugin.EntryPath, namespace, key)
		if err != nil {
			return "", err
		}
		if !found {
			return "", nil
		}
		return string(value), nil
	case "storage.set", "persistent-storage.set":
		return "", m.repo.StorageSet(ctx, service.plugin.EntryPath, namespace, key, input.Value)
	case "storage.delete", "persistent-storage.delete":
		return "", m.repo.StorageDelete(ctx, service.plugin.EntryPath, namespace, key)
	case "storage.keys", "persistent-storage.keys":
		keys, err := m.repo.StorageKeys(ctx, service.plugin.EntryPath, namespace)
		if err != nil {
			return "", err
		}
		out, _ := json.Marshal(keys)
		return string(out), nil
	default:
		return "", fmt.Errorf("unknown storage action %q", action)
	}
}

func (m *Manager) handlePlugin(ctx context.Context, service *Service, action, data string) (string, error) {
	if action == "plugin.getToken" {
		return m.HostToken(service.plugin.EntryPath), nil
	}
	var auth host.AuthHost
	m.mu.RLock()
	if m.host != nil {
		auth = m.host.Auth()
	}
	m.mu.RUnlock()
	if strings.HasPrefix(action, "plugin.register") || strings.HasPrefix(action, "plugin.unregister") {
		switch action {
		case "plugin.registerPlayEvent":
			m.RegisterPlayEvent(service.plugin.EntryPath)
		case "plugin.unregisterPlayEvent":
			m.UnregisterPlayEvent(service.plugin.EntryPath)
		case "plugin.registerLyricProvider":
			m.RegisterLyricProvider(service.plugin.EntryPath)
		case "plugin.unregisterLyricProvider":
			m.UnregisterLyricProvider(service.plugin.EntryPath)
		case "plugin.registerCoverProvider":
			m.RegisterCoverProvider(service.plugin.EntryPath)
		case "plugin.unregisterCoverProvider":
			m.UnregisterCoverProvider(service.plugin.EntryPath)
		default:
			return "", fmt.Errorf("unknown plugin registration action %q", action)
		}
		return "", nil
	}
	if auth == nil {
		if action == "plugin.getHostUrl" {
			return "", nil
		}
		return "", host.CapabilityUnavailable("plugin metadata")
	}
	info, err := auth.PluginInfo(ctx, service.plugin.EntryPath)
	if err != nil {
		return "", err
	}
	switch action {
	case "plugin.getHostUrl":
		return info.HostURL, nil
	case "plugin.getNetworkAddresses":
		values, err := auth.NetworkAddresses(ctx, info)
		if err != nil {
			return "", err
		}
		out, _ := json.Marshal(values)
		return string(out), nil
	case "plugin.getFileUrl":
		var input struct {
			FilePath string `json:"filePath"`
		}
		if err := json.Unmarshal([]byte(data), &input); err != nil {
			return "", err
		}
		permission, err := filePermission(input.FilePath, service.plugin.ExternalPaths)
		if err != nil {
			return "", err
		}
		if !CheckPermission(service.plugin.Permissions, permission) {
			return "", &host.Error{Code: host.CodePermissionDenied, Message: fmt.Sprintf("plugin.getFileUrl requires %s", permission)}
		}
		info.External = append([]string(nil), service.plugin.ExternalPaths...)
		value, err := auth.FileURL(ctx, info, input.FilePath)
		if err != nil {
			return "", err
		}
		out, _ := json.Marshal(map[string]string{"url": value})
		return string(out), nil
	default:
		return "", fmt.Errorf("unknown plugin action %q", action)
	}
}

func (m *Manager) handleSongs(ctx context.Context, service *Service, action, data string) (string, error) {
	m.mu.RLock()
	var songs host.SongHost
	if m.host != nil {
		songs = m.host.Songs()
	}
	m.mu.RUnlock()
	if songs == nil {
		return "", host.CapabilityUnavailable("songs")
	}
	var query host.SongQuery
	var idInput struct {
		ID int `json:"id"`
	}
	if data != "" {
		_ = json.Unmarshal([]byte(data), &query)
		_ = json.Unmarshal([]byte(data), &idInput)
	}
	var value any
	var err error
	switch action {
	case "songs.list":
		value, err = songs.List(ctx, query)
	case "songs.search":
		value, err = songs.Search(ctx, query)
	case "songs.getById":
		value, err = songs.Get(ctx, idInput.ID)
	case "songs.create":
		var input struct {
			Songs []host.SongCreate `json:"songs"`
		}
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			value, err = songs.Create(ctx, service.plugin.EntryPath, input.Songs)
		}
	case "songs.update":
		var input struct {
			ID int `json:"id"`
			host.SongUpdate
		}
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			value, err = songs.Update(ctx, input.ID, input.SongUpdate)
		}
	case "songs.delete":
		err = songs.Delete(ctx, idInput.ID)
	case "songs.download":
		var input struct {
			ID int `json:"song_id"`
			host.DownloadOptions
		}
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			value, err = songs.Download(ctx, input.ID, input.DownloadOptions)
		}
	case "songs.setAutoDownload":
		err = songs.SetAutoDownload(ctx, json.RawMessage(data))
	case "songs.organizePreview", "songs.organize":
		var input struct {
			Items []host.OrganizeItem `json:"items"`
		}
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			if action == "songs.organizePreview" {
				value, err = songs.OrganizePreview(ctx, input.Items)
			} else {
				value, err = songs.Organize(ctx, input.Items)
			}
		}
	default:
		return "", fmt.Errorf("unknown songs action %q", action)
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

func (m *Manager) handlePlaylists(ctx context.Context, _ *Service, action, data string) (string, error) {
	m.mu.RLock()
	var playlists host.PlaylistHost
	if m.host != nil {
		playlists = m.host.Playlists()
	}
	m.mu.RUnlock()
	if playlists == nil {
		return "", host.CapabilityUnavailable("playlists")
	}
	var idInput struct {
		ID int `json:"id"`
	}
	_ = json.Unmarshal([]byte(data), &idInput)
	var value any
	var err error
	switch action {
	case "playlists.list":
		value, err = playlists.List(ctx)
	case "playlists.getById":
		value, err = playlists.Get(ctx, idInput.ID)
	case "playlists.getSongs":
		var input struct {
			ID      int                    `json:"id"`
			Options host.PlaylistSongQuery `json:"options"`
		}
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			value, err = playlists.Songs(ctx, input.ID, input.Options)
		}
	case "playlists.search":
		var input struct {
			Query  string `json:"query"`
			Limit  int    `json:"limit"`
			Offset int    `json:"offset"`
		}
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			value, err = playlists.Search(ctx, input.Query, host.Page{Limit: input.Limit, Offset: input.Offset})
		}
	case "playlists.create":
		var input host.PlaylistCreate
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			value, err = playlists.Create(ctx, input)
		}
	case "playlists.update":
		var input struct {
			ID int `json:"id"`
			host.PlaylistUpdate
		}
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			value, err = playlists.Update(ctx, input.ID, input.PlaylistUpdate)
		}
	case "playlists.delete":
		err = playlists.Delete(ctx, idInput.ID)
	case "playlists.addSongs":
		var input struct {
			ID      int   `json:"id"`
			SongIDs []int `json:"songIds"`
		}
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			value, err = playlists.AddSongs(ctx, input.ID, input.SongIDs)
		}
	case "playlists.removeSongs":
		var input struct {
			ID      int   `json:"id"`
			SongIDs []int `json:"songIds"`
		}
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			err = playlists.RemoveSongs(ctx, input.ID, input.SongIDs)
		}
	case "playlists.reorder":
		var input struct {
			ID      int   `json:"id"`
			SongIDs []int `json:"songIds"`
		}
		if err = json.Unmarshal([]byte(data), &input); err == nil {
			err = playlists.Reorder(ctx, input.ID, input.SongIDs)
		}
	default:
		return "", fmt.Errorf("unknown playlists action %q", action)
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

func (m *Manager) handleJSEnv(ctx context.Context, service *Service, action, data string) (string, error) {
	var input struct {
		Name, InitCode, Code string
		TimeoutMs            int64
		WaitEvents           []string
		Calls                []jsruntime.ParallelCall
		MaxConcurrent        int
	}
	if data != "" {
		if err := json.Unmarshal([]byte(data), &input); err != nil {
			return "", err
		}
	}
	envID := service.envID + ":child:" + input.Name
	switch action {
	case "jsenv.create":
		if err := m.runtime.CreateEnv(envID, pluginBootstrapJS+"\n"+input.InitCode, int64(service.plugin.ID)); err != nil {
			return "", err
		}
		if err := m.runtime.SetBridgeCallback(envID, func(nextAction, nextData string) (string, error) {
			return m.handleBridge(service.lifecycleCtx, service, nextAction, nextData)
		}); err != nil {
			_ = m.runtime.DestroyEnv(envID)
			return "", err
		}
		out, _ := json.Marshal(map[string]string{"envName": input.Name})
		return string(out), nil
	case "jsenv.execute":
		result, err := m.runtime.ExecuteJS(ctx, envID, input.Code, input.TimeoutMs)
		if err != nil {
			return "", err
		}
		out, _ := json.Marshal(result)
		return string(out), nil
	case "jsenv.executeWait":
		result, err := m.runtime.ExecuteJSAndWaitEvents(ctx, envID, input.Code, input.TimeoutMs, input.WaitEvents)
		if err != nil {
			return "", err
		}
		out, _ := json.Marshal(result)
		return string(out), nil
	case "jsenv.executeParallel":
		for i := range input.Calls {
			if input.Calls[i].EnvID == "" {
				input.Calls[i].EnvID = envID
			}
		}
		index, result, errs := m.runtime.ExecuteJSParallel(input.Calls, input.MaxConcurrent)
		out, _ := json.Marshal(map[string]any{"successIndex": index, "result": result, "errors": errs})
		return string(out), nil
	case "jsenv.destroy":
		return "", m.runtime.DestroyEnv(envID)
	case "jsenv.list":
		return "[]", nil
	default:
		return "", fmt.Errorf("unknown jsenv action %q", action)
	}
}

func (m *Manager) handleHostCapability(ctx context.Context, service *Service, action, data string) (string, error) {
	m.mu.RLock()
	h := m.host
	m.mu.RUnlock()
	if h == nil {
		return "", host.CapabilityUnavailable(action)
	}
	return "", host.CapabilityUnavailable(action)
}
