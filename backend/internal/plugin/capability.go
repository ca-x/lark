package plugin

// CapabilityStatus describes whether a SongLoft capability is exposed by the
// Lark host. It is intentionally data-driven so the settings UI can explain a
// permission without guessing from a manifest string.
type CapabilityStatus string

const (
	CapabilityAvailable   CapabilityStatus = "available"
	CapabilityPartial     CapabilityStatus = "partial"
	CapabilityUnavailable CapabilityStatus = "unavailable"
)

type Capability struct {
	ID          string           `json:"id"`
	Label       string           `json:"label"`
	Permission  string           `json:"permission,omitempty"`
	Status      CapabilityStatus `json:"status"`
	Description string           `json:"description"`
	Note        string           `json:"note,omitempty"`
}

// CompatibilityMatrix is the host contract presented to plugin management.
// Keep this list aligned with host bridge registration; a capability marked
// available must have a corresponding permission check and implementation.
func CompatibilityMatrix() []Capability {
	return []Capability{
		{ID: "runtime.fetch", Label: "HTTP fetch", Status: CapabilityAvailable, Description: "插件可使用标准 fetch 发起受限 HTTP 请求。"},
		{ID: "runtime.crypto", Label: "Crypto", Status: CapabilityAvailable, Description: "提供 crypto、Buffer 和定时器等运行时能力。"},
		{ID: "storage", Label: "私有存储", Permission: PermStorage, Status: CapabilityAvailable, Description: "每个插件独立的键值存储。"},
		{ID: "persistent-storage", Label: "卸载后保留存储", Permission: PermPersistentStorage, Status: CapabilityAvailable, Description: "插件卸载后仍保留的键值存储。"},
		{ID: "songs.read", Label: "歌曲读取", Permission: PermSongsRead, Status: CapabilityPartial, Description: "读取歌曲列表、详情和搜索结果。", Note: "写入、下载和整理能力按 Lark 宿主适配器逐项开放。"},
		{ID: "songs.write", Label: "歌曲写入", Permission: PermSongsWrite, Status: CapabilityPartial, Description: "更新、创建和删除歌曲元数据。", Note: "下载/整理若宿主未提供等价服务会返回 host_capability_unavailable。"},
		{ID: "playlists.read", Label: "歌单读取", Permission: PermPlaylistsRead, Status: CapabilityAvailable, Description: "读取歌单及其中歌曲。"},
		{ID: "playlists.write", Label: "歌单写入", Permission: PermPlaylistsWrite, Status: CapabilityAvailable, Description: "创建、修改歌单和调整歌曲顺序。"},
		{ID: "inter-plugin", Label: "插件间通信", Permission: PermInterPlugin, Status: CapabilityAvailable, Description: "通过 songloft.comm 发送消息和请求响应。", Note: "目标插件必须启用并声明 inter-plugin 权限。"},
		{ID: "jsenv", Label: "子 JS 沙箱", Permission: PermJSEnv, Status: CapabilityAvailable, Description: "创建并执行独立 QuickJS 环境。"},
		{ID: "fs", Label: "插件文件", Permission: PermFS, Status: CapabilityAvailable, Description: "访问插件自己的数据目录。", Note: "路径仍由宿主文件适配器和权限声明校验。"},
		{ID: "fs:music", Label: "音乐目录", Permission: PermFSMusic, Status: CapabilityPartial, Description: "访问配置的音乐目录。", Note: "只允许 symlink-aware containment 内的路径。"},
		{ID: "fs:external", Label: "外部目录", Permission: PermFSExternal, Status: CapabilityPartial, Description: "访问管理员允许的外部目录。", Note: "必须命中 manifest externalPaths allowlist。"},
		{ID: "command", Label: "命令执行", Permission: PermCommand, Status: CapabilityAvailable, Description: "执行插件 bin 目录内的命令。", Note: "仅允许插件 bin 目录和宿主命令适配器定义的操作。"},
		{ID: "websocket", Label: "WebSocket", Permission: PermWebSocket, Status: CapabilityAvailable, Description: "处理插件路由的入站 WebSocket，并可连接外部 WebSocket。", Note: "入站连接按插件生命周期隔离，停用插件时会自动关闭。"},
		{ID: "net", Label: "原始网络 socket", Permission: PermNet, Status: CapabilityPartial, Description: "UDP/受限 TCP socket。", Note: "默认限制到回环和私有地址，公网 socket 需额外策略。"},
		{ID: "frontend.webview", Label: "WebView 插件页面", Status: CapabilityAvailable, Description: "插件可通过运行时路由提供 HTTP API 和静态资源。", Note: "页面在独立插件宿主中打开，不会注入主应用 DOM。"},
		{ID: "frontend.webf", Label: "WebF 原生页面", Status: CapabilityPartial, Description: "SongLoft WebF 页面在浏览器宿主中使用兼容 fallback。", Note: "WebF 原生渲染器不可用，Web API、样式和 bridge 通过 Web fallback 提供。"},
		{ID: "provider.lyrics", Label: "歌词提供者", Status: CapabilityAvailable, Description: "注册后由 Lark 歌词流程调用 /lyric-search。"},
		{ID: "provider.covers", Label: "封面提供者", Status: CapabilityUnavailable, Description: "SongLoft 注册接口保留，但 Lark 当前没有自动封面 provider 接管流程。", Note: "插件仍可自行暴露 HTTP 页面；不会被 Lark 自动调用。"},
	}
}
