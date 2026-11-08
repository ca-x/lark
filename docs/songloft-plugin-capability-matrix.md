# SongLoft 插件能力契约

本文档冻结 Lark 对 SongLoft JS 插件 API 的宿主承诺。插件包和 JavaScript
API 保持 SongLoft 兼容；宿主能力是否可用由权限和下表共同决定。

## 能力分层

| 层级 | 能力 | 是否需要 manifest 权限 | Lark 当前策略 |
| --- | --- | --- | --- |
| 运行时 | `fetch`、`crypto`、`Buffer`、定时器、日志 | 否 | 可用；请求仍受超时和响应大小限制 |
| 私有状态 | `songloft.storage` | `storage` | 可用；按插件隔离 |
| 持久状态 | `songloft.persistentStorage` | `persistent-storage` | 可用；卸载插件时保留 |
| 歌曲 | `list`、`getById`、`search` | `songs.read` | 可用 |
| 歌曲写入 | `create`、`update`、`delete` | `songs.write` | 按 Lark 服务能力开放 |
| 歌曲下载/整理 | `download`、`organize*` | `songs.write` | 没有等价宿主服务时返回 `host_capability_unavailable` |
| 普通歌单 | 读取、创建、更新、删除、加歌、移除、排序 | `playlists.read/write` | 可用；ID 为 Lark 普通歌单 ID |
| 内置收藏歌单 | Songloft 固定 ID 1 的「收藏」 | `playlists.read/write` | 尚无兼容映射；不能把 Lark 普通歌单 ID 1 当作收藏，依赖此约定的插件收藏操作暂不兼容 |
| 电台导入 | `/api/v1/songs/radio`、`type:radio` 歌单 | `songs.write`、`playlists.write` | 未实现；安装/初始化成功不代表电台导入可用 |
| 插件通信 | `songloft.comm` | `inter-plugin` | 可用；目标插件必须启用并声明权限 |
| 子环境 | `songloft.jsenv` | `jsenv` | 可用；受 QuickJS 生命周期约束 |
| 文件 | 插件目录 | `fs` | 可用；由宿主文件适配器执行路径校验 |
| 文件 | 音乐目录 | `fs:music` | 仅允许配置的 music 根目录内路径 |
| 文件 | 外部目录 | `fs:external` | 仅允许 manifest `externalPaths` allowlist |
| 命令 | `songloft.command` | `command` | 可用；仅插件私有 `bin` 目录和宿主适配器定义的操作 |
| WebSocket | 入站 `onWebSocket`、出站连接 | `websocket` | 可用；入站连接按插件生命周期隔离并在停用时回收 |
| 原始 socket | UDP/受限 TCP | `net` | 仅回环/私网默认开放；公网由策略控制 |
| WebView 插件页面 | HTTP API、静态资源 | 无 | 可用；在独立插件宿主中打开，不注入主应用 DOM |
| WebF 插件页面 | SongLoft WebF 原生渲染 | 无 | 部分可用；浏览器使用 WebF CSS/JS fallback，原生渲染器不可用 |
| 注册 provider | 歌词 | 无 | 可用，Lark 歌词流程调用 `/lyric-search` |
| 注册 provider | 封面 | 无 | 接口保留，Lark 当前不自动调用 |

## 浏览器宿主桥

- 公开 `SongloftPlugin.invokeHost`、`player` 与 `favorite.refresh(songId?, isFavorited?)`；收藏通知只刷新当前用户在主应用中的缓存，不替代插件应执行的持久化写入。
- 带参收藏刷新读取服务端权威歌曲状态；无参刷新按页读取完整收藏并更新已显示曲目的红心。不会把插件传来的布尔值当作已成功写入的证据。
- 播放订阅推送进度、时长、源歌单和完整队列变化，包括同长度队列重排；歌曲包含 `duration`、`file_path`、`file_size` 与本地封面 URL 等上游字段。
- Web 不支持原生 Cookie store 读取，与上游 Web 平台的限制一致；不向插件伪造第三方登录状态。

## 原包检查（2026-11-08）

对照 Songloft `2b7c11daea37a0f612e69c81638adc96f4fa06a1` 检查宿主接口。最新上游空闲驱逐后的播放事件唤醒修复不适用于 Lark：Lark 没有该空闲驱逐路径。

原始包安装、启用、静态入口检查通过：Subsonic `2.2.3`、Navidrome `2026.11.6.0`、Lyrics `2026.10.17.0`、Stats `2026.9.8`、Radio `2026.7.5`、Library Plus `0.2.16`、Now Playing `1.0.31`。其中修复前 Lyrics、Navidrome 的四段日期版本被严格 SemVer 校验拒绝；现同时支持严格 SemVer 和四段数字版本，更新比较计入第四段。

设置 `LARK_REAL_PLUGIN_DIR` 指向上述 `*.jsplugin.zip` 目录，可运行 `TestRealSongLoftPluginMatrix`；Subsonic 原包另有真实宿主代理 + 模拟源的 Range 播放集成测试，Library Plus 验证读取本地曲库，Lyrics 验证 provider 注册，Stats 验证播放事件订阅。浏览器使用实际 `common.js` 验证宿主 SDK、播放进度推送、同长度队列重排及两种收藏缓存刷新。未验证私人 Navidrome 账号、真实第三方登录、个人设备或所有插件操作；内置收藏 ID 与电台导入缺口仍如上表所述。

## 注册能力语义

`permissions` 只表示插件可以请求哪些桥接 API，不表示插件已经提供某项
业务服务。歌词/封面/播放事件通过 `registerProvider` 或事件注册在运行时
登记，管理界面应分别展示：

- **声明权限**：安装确认和插件详情中的静态权限列表。
- **已注册能力**：插件 `onInit` 后真实注册的 provider/事件。
- **宿主缺口**：能力矩阵中标为 partial/unavailable 的项目及原因。

因此，插件市场可以显示“支持歌词”，但只有已启用且成功注册歌词 provider
后，Lark 才会把它加入歌词搜索链；禁用、卸载或初始化失败会立即移出搜索链。

## 歌词契约

宿主调用：

```text
GET /lyric-search?title=&artist=&album=&duration=&fingerprint=&isrc=
```

插件返回 HTTP 200 JSON：

```json
{
  "lyric": "[00:01.00]...",
  "tlyric": "...",
  "rlyric": "...",
  "lxlyric": "..."
}
```

Lark 将一次插件响应缓存为一个候选项，候选源标记为
`plugin:<entryPath>`；用户选择后读取缓存，不会再次请求旧的内置在线歌词
provider。没有可用插件 provider 时，迁移阶段才允许旧实现回退。

## 错误与安全边界

- 未声明权限的桥接调用必须返回稳定的 permission denied 错误。
- 宿主没有等价实现的 API 必须返回 `host_capability_unavailable`，不能伪造成功。
- ZIP 安装拒绝 traversal、绝对路径、符号链接、重复条目和解压炸弹。
- 插件数据、命令 bin、音乐目录和外部 allowlist 使用不同根目录，路径检查在
  每次调用时执行。
