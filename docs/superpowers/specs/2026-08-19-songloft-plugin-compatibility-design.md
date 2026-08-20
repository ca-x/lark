# Lark SongLoft 插件兼容层设计

## 目标

将 SongLoft 的 JS 插件模式移植到 Lark，使现有 SongLoft 插件包无需修改即可被 Lark 安装、启用、停用、更新和运行。Lark 负责承载 QuickJS 运行时，并通过适配器把 SongLoft 的宿主 API 映射到 Lark 的 Echo、Ent 和 Library Service。

歌词是首个迁移消费者：本地文件内嵌歌词和同目录 sidecar 歌词继续由 Lark 读取；在线歌词搜索与获取改由 SongLoft 插件提供。插件兼容测试和迁移测试通过后，删除 Lark 当前内置的在线歌词 provider 调用链。

## 用户场景

1. 管理员上传标准 `.jsplugin.zip`，Lark 校验 `plugin.json`、`entryHash` 和 `zipHash` 后安装。
2. 管理员可以查看、启用、停用、更新和删除插件，并看到加载错误。
3. 插件可以通过 `/api/v1/jsplugin/{entryPath}/...` 接收 HTTP 请求和提供静态页面。
4. 插件代码继续使用 `songloft.*` API，不需要为 Lark 构建单独版本。
5. 声明歌词 provider 的插件可参与 Lark 的歌词候选搜索和歌词获取。
6. 具有相应权限的插件可访问歌曲、歌单、存储、文件、网络、命令、子 JS 环境和插件间通信能力。
7. 管理员可以配置多个插件订阅源，并从合并去重后的市场列表中安装插件。

## 兼容目标

### 必须兼容

- SongLoft `plugin.json` 字段、校验规则、状态值和 `.jsplugin.zip` 文件命名。
- JavaScript 生命周期：`onInit`、`onDeinit`、`onHTTPRequest`、`onWebSocket`。
- `songloft.log`、`storage`、`persistentStorage`、`songs`、`playlists`、`plugin`、`jsenv`、`command`、`fs`、`comm`、`lyrics`、`covers`、`net`、`events` 命名空间。
- QuickJS polyfill：Promise、fetch、定时器、Buffer、TextEncoder/TextDecoder、URL、crypto、zlib 和 WebSocket。
- 权限名称和通配符语义：`storage`、`persistent-storage`、`songs.read`、`songs.write`、`playlists.read`、`playlists.write`、`inter-plugin`、`command`、`jsenv`、`fs`、`fs:music`、`fs:external`、`websocket`、`net`、`songs.*`、`playlists.*`、`fs.*`。
- 每插件独立 VM、存储命名空间、文件目录、消息队列和资源清理。
- SongLoft 路由前缀 `/api/v1/jsplugin` 与 `/api/v1/jsplugin-assets`。

### 宿主差异处理

- SongLoft 使用 Chi/sqlc，Lark 使用 Echo/Ent。运行时不得依赖 SongLoft 的 Router、Repository、Database 或 Service 具体类型。
- JS 可见的 JSON 字段与 SongLoft 保持兼容；内部 ID 使用 Lark 的 `int`，桥接层转成插件契约要求的 JSON 数字或字符串。
- 歌曲和歌单操作以一个专用插件服务账号执行。该账号由 Lark 启动时确保存在，角色为管理员，但仅能通过插件权限门控访问。
- `songs.download` 映射到 Lark 的网络源导入能力。第一版若缺少等价的可持久化下载入口，必须返回稳定错误码 `host_capability_unavailable`，不得返回假成功。
- `songs.organize` 和 `songs.organizePreview` 仅在 Lark 已有等价文件整理服务后开放；迁移初期返回 `host_capability_unavailable`。
- `renderEngine=webf` 保留并返回，但 Lark Web 前端仅按普通 Web 页面嵌入；不得声称提供原生 WebF 引擎。
- `plugin.getToken()` 返回权限受限的 Lark 插件令牌；该令牌只能访问插件宿主所需 API，不能等同于管理员登录会话。

## 架构

```text
SongLoft plugin ZIP
        |
        v
Package Manager -> Ent Repository -> Plugin Manager
                                      |
                            Service Scheduler
                                      |
                              QuickJS Runtime
                                      |
                              Bridge Interface
                                      |
              +-----------------------+-----------------------+
              |                       |                       |
        Lark Library             Lark Storage             OS adapters
       songs/playlists       plugin KV/settings       fs/net/command
```

核心包边界：

- `internal/jsruntime`：从 SongLoft 移植的通用 QuickJS VM、事件循环和 polyfill，不引用 Lark 业务包。
- `internal/plugin`：manifest、包安装、调度、生命周期、权限、路由和通信。
- `internal/plugin/host`：宿主接口定义与 SongLoft JSON 契约类型。
- `internal/plugin/larkhost`：对 Ent、Library Service、认证和文件目录的适配。
- `internal/api`：注册插件管理 API 和插件运行路由，不包含 VM 逻辑。

## 数据模型

新增 Ent schema：

- `Plugin`：SongLoft `JSPlugin` 的全部可持久化字段，包括状态、hash、路径和更新时间。
- `PluginStorage`：`plugin_entry_path + namespace + key` 唯一；`namespace` 为 `volatile` 或 `persistent`。
- `PluginSetting`：插件系统级配置，包括 registry、自动更新和 keep-alive；若现有 `AppSetting` 足够，则复用 `AppSetting`，不新增表。

存储语义：

- 普通 `storage` 在插件删除时清理。
- `persistentStorage` 在插件删除时保留，只有显式孤儿清理 API 才删除。
- 单插件单 namespace 默认限制 10 MiB；单 value 最大 1 MiB；超限返回稳定错误。

## 文件布局

- `${LARK_DATA_DIR}/jsplugins/`：原始 `.jsplugin.zip`。
- `${LARK_DATA_DIR}/jsplugins_data/{entryPath}/`：解包内容、插件私有文件、缓存和二进制。
- `${LARK_LIBRARY_DIR}`：`music://` 根目录，仅 `fs:music` 可访问。
- `externalPaths` 必须是管理员在 manifest 安装确认时接受的绝对目录，且运行时再次做 containment 校验。

## HTTP API

管理 API 仅管理员可用：

- `GET /api/v1/jsplugins`
- `POST /api/v1/jsplugins/upload`
- `GET /api/v1/jsplugins/:id`
- `PUT /api/v1/jsplugins/:id`
- `DELETE /api/v1/jsplugins/:id`
- `POST /api/v1/jsplugins/:id/enable`
- `POST /api/v1/jsplugins/:id/disable`
- `GET /api/v1/jsplugins/:id/check-update`
- `POST /api/v1/jsplugins/:id/update`
- `POST /api/v1/jsplugins/update-all`
- `POST /api/v1/jsplugins/storage/cleanup`
- registry 配置、刷新和安装接口保持 SongLoft 路径与 JSON 兼容。

### 默认订阅源

Lark 在订阅源设置尚不存在时写入一条普通的社区聚合源记录。该源自身 include SongLoft 官方 registry，因此同时覆盖官方和社区插件，不再单独配置官方源：

```json
{
  "registries": [
    {
      "name": "SongLoft 社区插件市场",
      "url": "https://raw.githubusercontent.com/deerwan/songloft-plugin-market/main/registry.json",
      "homepage": "https://songloft-store.lllh.de/#/",
      "enabled": true
    }
  ]
}
```

这条默认记录不具有特殊身份，与用户新增的订阅源使用相同的数据结构和操作权限，可以编辑、启用、停用或删除。初始化逻辑必须区分“设置不存在”和“设置已保存为空数组”：用户删除全部订阅源后不得在重启时自动补回社区源。

聚合结果以规范化 `entryPath + identity` 去重，同一插件保留最高语义版本，并记录所有命中的 source name。自定义 URL 必须是 HTTPS，拉取时拒绝重定向到非 HTTPS 或私有/保留地址。

运行 API：

- `/api/v1/jsplugin/{entryPath}` 提供插件静态入口。
- `/api/v1/jsplugin/{entryPath}/static/*` 提供静态资源。
- `/api/v1/jsplugin/{entryPath}/files/*` 提供经过权限校验的文件响应。
- `/api/v1/jsplugin/{entryPath}/*` 转发到 `onHTTPRequest` 或 `onWebSocket`。
- manifest 的 `publicPaths` 仅跳过用户认证，不跳过插件存在、状态、路径和权限校验。

## 前端插件管理

插件管理位于现有设置页，仅管理员可见，作为独立的“插件”一级设置标签。内部使用三个紧凑 tabs：

1. **已安装**：按行显示图标、名称、版本、来源、权限摘要和状态。启用/停用使用 toggle；更新、打开、删除放在行尾 icon actions/menu。加载、更新和失败状态固定占位，不因文案变化引发布局跳动。
2. **插件市场**：顶部为搜索框、来源筛选、类型筛选和刷新按钮；下方使用可扫描的紧凑列表，不使用营销卡片网格。每行显示插件、作者、版本、来源、更新时间和安装/更新命令。官方与社区重复记录合并，不重复展示。
3. **订阅源**：表格/移动端列表显示名称、registry URL、homepage、启用 toggle、最近同步时间和错误状态。支持新增多个订阅地址、编辑、手动刷新和删除自定义源。

交互约束：

- 沿用 Lark 当前主题 tokens、字体和 Phosphor Icons，不引入单独的 marketplace 配色、渐变背景或新字体。
- 桌面端保持信息密度；移动端在 375 px 下将每行操作收进 menu，URL 可换行且不撑破容器。
- tabs、toggle、搜索、filter 和按钮全部可键盘操作并具有可见 focus ring；icon-only 按钮必须有 `aria-label` 和 tooltip。
- 安装前显示权限确认 modal；`command`、`net`、`fs:external` 和 `fs:music` 单独标记为高权限。
- 异步操作超过 300 ms 显示行内 spinner/progress；成功和失败反馈就近展示，失败保留可重试动作。
- 高频 tabs 和 toggle 不做进场动画。popover/modal 使用 150-220 ms ease-out；按钮按下使用 `scale(.97)`；支持 `prefers-reduced-motion`。
- 使用稳定 plugin identity 作为 React key，不使用数组下标；筛选结果从已加载数据派生，不保存重复 state。

## 歌词迁移

歌词解析优先级：

1. 音频文件内嵌歌词。
2. 同目录 sidecar `.lrc`/歌词文件。
3. 用户已选择并缓存的歌词。
4. SongLoft 插件 provider。

插件 manager 暴露：

```go
type LyricProvider interface {
	SearchLyrics(ctx context.Context, query LyricQuery) ([]LyricCandidate, error)
	FetchLyrics(ctx context.Context, provider, candidateID string) (string, error)
}
```

候选 `source` 使用 `plugin:{entryPath}`，候选 `id` 保持插件返回值。旧的 `netease`、`qq` 等 source 只用于读取已有缓存；迁移完成后不再用于发起在线请求。

## 安全约束

- ZIP 上传最大 50 MiB，限制条目数量、单条目大小和解压后总大小，拒绝绝对路径、`..`、symlink 和重复路径。
- 安装必须校验规范化 `zipHash` 和入口 `entryHash`。
- 插件声明权限只是第一层；每次 bridge 调用必须再次校验权限。
- HTTP/fetch、WebSocket、UDP/TCP、命令和文件操作必须受 context 超时、资源上限和 shutdown 控制。
- `command` 只能执行插件私有 `bin` 目录内的程序；禁止 shell 字符串执行。
- `fs` 使用解析后的绝对路径做 containment 检查，防止 traversal 和 symlink escape。
- 插件日志不得记录认证头、cookie、token 或 storage value。
- VM 设置内存、栈、执行时间和并发上限；插件异常不得导致主服务退出。

## 测试策略

- 从 SongLoft 移植 runtime 和 package 的现有单元测试，并将业务依赖替换为 fake host。
- 为 manifest/hash/ZIP traversal/权限/存储配额建立表驱动测试。
- 为 Echo 路由、认证、publicPaths、静态资源和 WebSocket 建立集成测试。
- 构建一个最小兼容插件 fixture，覆盖全部 `songloft.*` 命名空间的可用/拒绝路径。
- 用至少一个真实 SongLoft 歌词插件包做黑盒兼容测试。
- 迁移歌词时保持现有 `lyric_query_test.go`，新增插件 provider 成功、超时、多 provider 隔离和旧缓存兼容测试。
- 后端验证：`cd backend && go test -race ./...`、`go vet ./...`、`go build ./cmd/server`。
- 前端验证：`cd frontend && pnpm test`、`pnpm build`。
- 前端交互验证覆盖 375、768、1024 和 1440 px，键盘导航、可见 focus、长 URL、空列表、重复源、同步错误和 reduced motion。

## 分阶段交付

1. 运行时内核：QuickJS、polyfill、manifest、hash、包解压和 fake-host 测试。
2. 生命周期与路由：manager、scheduler、静态页面、HTTP/WebSocket、管理 API。
3. Lark 宿主桥：存储、歌曲、歌单、文件、网络、命令、通信、事件。
4. 管理界面和 registry：上传、启停、更新、权限展示和插件页面入口。
5. 歌词迁移：插件 provider 接管在线歌词，验证后删除内置在线歌词调用链。

每个阶段必须形成可运行、可测试的提交；第 5 阶段不得早于真实插件兼容测试通过。

## 成功标准

- 标准 SongLoft `.jsplugin.zip` 可以不修改内容直接安装并通过 hash 校验。
- 插件生命周期、HTTP、静态页面、存储和权限行为与 SongLoft 测试 fixture 一致。
- 已映射的 `songloft.*` API 返回结构与 SongLoft 一致；未映射能力返回显式稳定错误。
- 一个真实歌词插件能在 Lark 中返回候选和歌词，超时或崩溃不会影响其他插件与主服务。
- 在线歌词不再调用 Lark 内置 provider；内嵌、sidecar 和已有缓存仍可用。
- 首次初始化添加的社区聚合订阅源可刷新其包含的官方和社区插件，也可像普通记录一样被删除；重复插件只显示一条，并可辨识其所有来源。
- 管理员可以添加多个自定义订阅源并独立启用、停用或刷新。
- 后端 race test、vet、build 和前端 test/build 全部通过。

## 不在本次范围

- 复制 SongLoft 的 Chi、sqlc、歌曲下载器、缓存服务或 Flutter/WebF 客户端。
- 保证依赖 SongLoft 私有未公开数据库字段的插件可运行。
- 为插件授予绕过 Lark 用户、管理员或文件权限边界的能力。
- 在兼容验证之前删除 Lark 现有在线歌词代码。

## 需确认的决策

1. 兼容基线固定为当前参考目录 `/home/czyt/code/ref/songloft` 的代码版本，而不是任意未来 SongLoft 版本。
2. 第一版允许个别 Lark 无等价能力的写操作返回 `host_capability_unavailable`；插件包仍可安装和运行其余功能。
3. 插件管理和插件宿主 API 使用 SongLoft 的 `/api/v1/...` 路径，以最大化现有插件页面兼容性。
