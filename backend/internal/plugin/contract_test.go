package plugin

import (
	"regexp"
	"testing"
)

// This list is derived from SongLoft internal/jsplugin/api_bridge.go. Keeping
// it executable prevents Lark from silently dropping an upstream API while
// refactoring the compatibility bootstrap.
func TestBootstrapExposesEverySongLoftBridgeAction(t *testing.T) {
	t.Parallel()

	want := []string{
		"command.deleteBin", "command.download", "command.exec", "command.exists", "command.isRunning", "command.listBin", "command.start", "command.stop",
		"comm.call", "comm.send",
		"fs.appendFile", "fs.exists", "fs.mkdir", "fs.readFile", "fs.readdir", "fs.rename", "fs.stat", "fs.unlink", "fs.writeFile",
		"jsenv.create", "jsenv.destroy", "jsenv.execute", "jsenv.executeParallel", "jsenv.executeWait", "jsenv.list",
		"net.tcpClose", "net.tcpConnect", "net.tcpSend", "net.udpBind", "net.udpClose", "net.udpGetLocalAddr", "net.udpJoinMulticast", "net.udpLeaveMulticast", "net.udpSend",
		"persistent-storage.delete", "persistent-storage.get", "persistent-storage.keys", "persistent-storage.set",
		"playlists.addSongs", "playlists.create", "playlists.delete", "playlists.getById", "playlists.getSongs", "playlists.list", "playlists.removeSongs", "playlists.reorder", "playlists.search", "playlists.update",
		"plugin.getFileUrl", "plugin.getHostUrl", "plugin.getNetworkAddresses", "plugin.getToken", "plugin.registerCoverProvider", "plugin.registerLyricProvider", "plugin.registerPlayEvent", "plugin.unregisterCoverProvider", "plugin.unregisterLyricProvider", "plugin.unregisterPlayEvent",
		"songs.create", "songs.delete", "songs.download", "songs.getById", "songs.list", "songs.organize", "songs.organizePreview", "songs.search", "songs.setAutoDownload", "songs.update",
		"storage.delete", "storage.get", "storage.keys", "storage.set",
		"websocket.close", "websocket.send",
	}
	matches := regexp.MustCompile(`__(?:callBridge|callRegistrationBridge)\('([^']+)'`).FindAllStringSubmatch(pluginBootstrapJS, -1)
	got := make(map[string]bool, len(matches))
	for _, match := range matches {
		got[match[1]] = true
	}
	for _, action := range want {
		if !got[action] {
			t.Errorf("SongLoft bridge action %q is missing from the Lark bootstrap", action)
		}
	}
}
