package host

import (
	"context"
	"encoding/json"
)

type Host interface {
	Songs() SongHost
	Playlists() PlaylistHost
	Storage() StorageHost
	Files() FileHost
	Commands() CommandHost
	Network() NetworkHost
	Auth() AuthHost
	Events() EventHost
}

type SongHost interface {
	List(context.Context, SongQuery) ([]Song, error)
	Get(context.Context, int) (Song, error)
	Search(context.Context, SongQuery) ([]Song, error)
	Create(context.Context, string, []SongCreate) ([]Song, error)
	Update(context.Context, int, SongUpdate) (Song, error)
	Delete(context.Context, int) error
	Download(context.Context, int, DownloadOptions) (DownloadResult, error)
	SetAutoDownload(context.Context, json.RawMessage) error
	OrganizePreview(context.Context, []OrganizeItem) ([]OrganizeResult, error)
	Organize(context.Context, []OrganizeItem) ([]OrganizeResult, error)
}

type PlaylistHost interface {
	List(context.Context) ([]Playlist, error)
	Get(context.Context, int) (Playlist, error)
	Songs(context.Context, int, PlaylistSongQuery) ([]Song, error)
	Search(context.Context, string, Page) ([]Playlist, error)
	Create(context.Context, PlaylistCreate) (Playlist, error)
	Update(context.Context, int, PlaylistUpdate) (Playlist, error)
	Delete(context.Context, int) error
	AddSongs(context.Context, int, []int) (AddSongsResult, error)
	RemoveSongs(context.Context, int, []int) error
	Reorder(context.Context, int, []int) error
}

type StorageHost interface {
	Get(context.Context, string, string, string) (json.RawMessage, bool, error)
	Set(context.Context, string, string, string, json.RawMessage) error
	Delete(context.Context, string, string, string) error
	Keys(context.Context, string, string) ([]string, error)
}

type FileHost interface {
	Resolve(context.Context, PluginInfo, string) (string, error)
	Read(context.Context, PluginInfo, string, string) (string, error)
	Write(context.Context, PluginInfo, string, string, string) error
	Append(context.Context, PluginInfo, string, string, string) error
	ReadDir(context.Context, PluginInfo, string) ([]FileEntry, error)
	Remove(context.Context, PluginInfo, string) error
	Exists(context.Context, PluginInfo, string) (bool, error)
	Mkdir(context.Context, PluginInfo, string, bool) error
	Stat(context.Context, PluginInfo, string) (FileStat, error)
	Rename(context.Context, PluginInfo, string, string) error
}

type CommandHost interface {
	Exec(context.Context, PluginInfo, string, []string, CommandOptions) (CommandResult, error)
	Start(context.Context, PluginInfo, string, string, []string, CommandOptions) (CommandStartResult, error)
	Stop(context.Context, PluginInfo, string) error
	IsRunning(context.Context, PluginInfo, string) (bool, error)
	Download(context.Context, PluginInfo, string, string, CommandDownloadOptions) error
	DeleteBin(context.Context, PluginInfo, string) error
	ListBin(context.Context, PluginInfo) ([]string, error)
	BinExists(context.Context, PluginInfo, string) (bool, error)
	Cleanup(context.Context, PluginInfo) error
}

// NetworkHost authorizes raw socket operations. Socket ownership and event
// delivery remain in the bridge, while the Lark adapter controls address policy.
type NetworkHost interface {
	AuthorizeBind(context.Context, PluginInfo, string, string) error
	ResolveDial(context.Context, PluginInfo, string, int) (string, error)
}

type AuthHost interface {
	PluginInfo(context.Context, string) (PluginInfo, error)
	FileURL(context.Context, PluginInfo, string) (string, error)
	NetworkAddresses(context.Context, PluginInfo) ([]string, error)
}

type EventHost interface {
	Register(context.Context, EventRegistration) error
	Unregister(context.Context, EventRegistration) error
}
