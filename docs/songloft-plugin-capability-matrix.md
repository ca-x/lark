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
| 歌单 | 读取、创建、更新、删除、加歌、移除、排序 | `playlists.read/write` | 可用 |
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

## 注册式能力与界面

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
