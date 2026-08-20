package plugin

import (
	"fmt"
	"strings"
)

const (
	PermStorage           = "storage"
	PermSongsRead         = "songs.read"
	PermSongsWrite        = "songs.write"
	PermPlaylistsRead     = "playlists.read"
	PermPlaylistsWrite    = "playlists.write"
	PermInterPlugin       = "inter-plugin"
	PermCommand           = "command"
	PermJSEnv             = "jsenv"
	PermFS                = "fs"
	PermFSMusic           = "fs:music"
	PermFSExternal        = "fs:external"
	PermWebSocket         = "websocket"
	PermPersistentStorage = "persistent-storage"
	PermNet               = "net"
)

var AllPermissions = []string{
	PermStorage,
	PermSongsRead,
	PermSongsWrite,
	PermPlaylistsRead,
	PermPlaylistsWrite,
	PermInterPlugin,
	PermCommand,
	PermJSEnv,
	PermFS,
	PermFSMusic,
	PermFSExternal,
	PermWebSocket,
	PermPersistentStorage,
	PermNet,
	"songs.*",
	"playlists.*",
	"fs.*",
}

var validPermissions = func() map[string]struct{} {
	permissions := make(map[string]struct{}, len(AllPermissions))
	for _, permission := range AllPermissions {
		permissions[permission] = struct{}{}
	}
	return permissions
}()

func CheckPermission(permissions []string, required string) bool {
	for _, permission := range permissions {
		if permission == required {
			return true
		}
		if prefix, ok := strings.CutSuffix(permission, ".*"); ok && (required == prefix || strings.HasPrefix(required, prefix+".")) {
			return true
		}
	}
	return false
}

func ValidatePermissions(permissions []string) error {
	seen := make(map[string]struct{}, len(permissions))
	for _, permission := range permissions {
		if _, ok := validPermissions[permission]; !ok {
			return fmt.Errorf("unknown permission: %q", permission)
		}
		if _, ok := seen[permission]; ok {
			return fmt.Errorf("duplicate permission: %q", permission)
		}
		seen[permission] = struct{}{}
	}
	return nil
}
