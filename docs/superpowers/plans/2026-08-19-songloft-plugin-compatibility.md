# SongLoft Plugin Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Lark 内承载与当前参考版本 SongLoft 兼容的 JS 插件运行时，并最终用插件 provider 替换 Lark 的内置在线歌词获取。

**Architecture:** 保持 SongLoft 插件包、QuickJS 行为和 JavaScript API 契约，隔离出通用 runtime/plugin 核心；所有 SongLoft 业务依赖通过 `Host` 接口映射到 Lark 的 Ent、Library Service 和 Echo。迁移采用并行兼容期，真实歌词插件通过黑盒测试后才移除旧在线歌词调用链。

**Tech Stack:** Go 1.27.0、Echo v5、Ent、modernc.org/quickjs、gorilla/websocket、React、TypeScript、Vitest。

## Global Constraints

- 兼容基线固定为 `/home/czyt/code/ref/songloft` 当前版本的 `plugin.json`、权限和 `songloft.*` API。
- 不引入 SongLoft 的 Chi、sqlc、database 或 services 包。
- 所有插件 bridge 调用必须做运行时权限校验。
- 插件 ZIP 上传最大 50 MiB，拒绝 traversal、symlink、重复路径和解压炸弹。
- 真实插件兼容测试通过前，不删除 Lark 当前在线歌词实现。
- Go 代码编辑前运行 Modern Go Guidelines CLI；每个 Go 任务结束运行相关测试。

---

### Task 1: 固定上游兼容基线与许可证归属

**Files:**
- Create: `backend/internal/plugin/upstream/README.md`
- Modify: `NOTICE.md`
- Test: `backend/internal/plugin/upstream/upstream_test.go`

**Interfaces:**
- Consumes: `/home/czyt/code/ref/songloft` 当前 git commit、Apache-2.0 LICENSE 和 NOTICE。
- Produces: `UpstreamCommit` 常量和移植文件清单，供后续兼容测试输出版本信息。

- [ ] **Step 1: 记录参考提交和移植边界**

运行 `git -C /home/czyt/code/ref/songloft rev-parse HEAD`，将结果写入 README 和：

```go
package upstream

const UpstreamCommit = "825f70f603a773fc8c0ded555a0cbe753d2a0d52"
```

- [ ] **Step 2: 添加许可证声明**

在 `NOTICE.md` 记录移植自 SongLoft 的 runtime/plugin 文件、Apache-2.0 来源、提交哈希和修改说明。

- [ ] **Step 3: 写版本格式测试**

```go
func TestUpstreamCommitIsPinned(t *testing.T) {
	if len(UpstreamCommit) != 40 {
		t.Fatalf("UpstreamCommit length = %d", len(UpstreamCommit))
	}
}
```

- [ ] **Step 4: 验证**

Run: `cd backend && go test ./internal/plugin/upstream`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add NOTICE.md backend/internal/plugin/upstream
git commit -m "docs: pin SongLoft plugin compatibility baseline"
```

### Task 2: 移植 QuickJS runtime 内核

**Files:**
- Create: `backend/internal/jsruntime/runtime.go`
- Create: `backend/internal/jsruntime/polyfill.go`
- Create: `backend/internal/jsruntime/pendingjob.go`
- Create: `backend/internal/jsruntime/runtime_test.go`
- Modify: `backend/go.mod`
- Modify: `backend/go.sum`

**Interfaces:**
- Consumes: `modernc.org/quickjs`、context 和标准库 HTTP/crypto/compress。
- Produces: `JSEnvManager`、`CreateEnv`、`ExecuteJS`、`ExecuteJSParallel`、`HealthProbe`、`DestroyEnv`、`Close`。

- [ ] **Step 1: 查询现代 Go 规则**

Run: `sh /home/czyt/.codex/skills/use-modern-go/scripts/run-tool.sh list --file-path backend/internal/jsruntime/runtime.go`
Expected: 完整输出适用于 Go 1.25 的规则。

- [ ] **Step 2: 先移植 runtime 测试并改成 Lark 包路径**

保留 Promise、await、fetch、timer、Buffer、crypto、并行执行、取消和 shutdown 测试；删除只依赖 SongLoft 日志文案的断言。

- [ ] **Step 3: 运行测试确认缺少实现**

Run: `cd backend && go test ./internal/jsruntime`
Expected: FAIL，缺少 runtime 类型或 quickjs 依赖。

- [ ] **Step 4: 移植最小 runtime 实现**

保持 VM 隔离、`env.mu` 串行访问、await 期间释放锁、异步结果通道和 context 取消语义。所有 goroutine 必须由 env 或 manager shutdown 收口。

- [ ] **Step 5: 验证 runtime**

Run: `cd backend && go test -race ./internal/jsruntime`
Expected: PASS，无 race 和 goroutine 泄漏症状。

- [ ] **Step 6: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/jsruntime
git commit -m "feat: add SongLoft-compatible QuickJS runtime"
```

### Task 3: 实现 manifest、权限、hash 与安全解包

**Files:**
- Create: `backend/internal/plugin/manifest.go`
- Create: `backend/internal/plugin/permissions.go`
- Create: `backend/internal/plugin/hash.go`
- Create: `backend/internal/plugin/package.go`
- Create: `backend/internal/plugin/package_test.go`

**Interfaces:**
- Consumes: SongLoft `PluginManifest` JSON。
- Produces: `ParseManifest([]byte)`, `ValidateManifest(*Manifest)`, `CheckPermission([]string, string)`, `InstallPackage(context.Context, []byte)`。

- [ ] **Step 1: 写 manifest 和权限兼容测试**

覆盖合法 manifest、非法 semver、非法 `entryPath`、未知权限、通配符权限、缺失/非法 hash。

- [ ] **Step 2: 写恶意 ZIP 测试**

分别构造 `../escape`、绝对路径、symlink、重复路径、超过条目数、超过解压总大小和 hash 不匹配的 ZIP，断言安装失败且目标目录无残留。

- [ ] **Step 3: 运行测试确认失败**

Run: `cd backend && go test ./internal/plugin -run 'Manifest|Permission|Package'`
Expected: FAIL，接口未实现。

- [ ] **Step 4: 实现兼容校验和原子安装**

先解压到 `os.MkdirTemp(pluginsDataDir, ".install-*")`，完整校验后使用同文件系统 rename 发布；失败时删除临时目录。不得直接覆盖正在运行的目录。

- [ ] **Step 5: 验证**

Run: `cd backend && go test -race ./internal/plugin -run 'Manifest|Permission|Package'`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/internal/plugin
git commit -m "feat: validate and install SongLoft plugin packages"
```

### Task 4: 新增 Ent 插件仓库与存储配额

**Files:**
- Create: `backend/ent/schema/plugin.go`
- Create: `backend/ent/schema/plugin_storage.go`
- Create: `backend/internal/plugin/repository.go`
- Create: `backend/internal/plugin/ent_repository.go`
- Create: `backend/internal/plugin/ent_repository_test.go`
- Modify: generated files under `backend/ent/`

**Interfaces:**
- Produces:

```go
type Repository interface {
	List(context.Context) ([]Plugin, error)
	GetByID(context.Context, int) (Plugin, error)
	GetByEntryPath(context.Context, string) (Plugin, error)
	Create(context.Context, Plugin) (Plugin, error)
	Update(context.Context, Plugin) (Plugin, error)
	Delete(context.Context, int) error
	SetStatus(context.Context, int, Status) error
	StorageGet(context.Context, string, StorageNamespace, string) (json.RawMessage, bool, error)
	StorageSet(context.Context, string, StorageNamespace, string, json.RawMessage) error
	StorageDelete(context.Context, string, StorageNamespace, string) error
	StorageKeys(context.Context, string, StorageNamespace) ([]string, error)
}
```

- [ ] **Step 1: 写内存数据库测试**

覆盖 entryPath 唯一、状态更新、volatile/persistent 隔离、1 MiB value 限制、10 MiB namespace 配额、删除插件时只清理 volatile。

- [ ] **Step 2: 运行测试确认 schema 缺失**

Run: `cd backend && go test ./internal/plugin -run EntRepository`
Expected: FAIL。

- [ ] **Step 3: 添加 schema 并生成 Ent 代码**

Run: `cd backend && go generate ./ent`
Expected: 生成 Plugin 和 PluginStorage client/query/mutation 文件。

- [ ] **Step 4: 实现 Repository**

配额检查与写入放在同一 transaction 中；唯一冲突转换成稳定的 `ErrPluginConflict`。

- [ ] **Step 5: 验证**

Run: `cd backend && go test -race ./internal/plugin -run EntRepository`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/ent backend/internal/plugin
git commit -m "feat: persist plugins and isolated storage"
```

### Task 5: 建立 Host 接口与 fake-host 契约测试

**Files:**
- Create: `backend/internal/plugin/host/host.go`
- Create: `backend/internal/plugin/host/types.go`
- Create: `backend/internal/plugin/host/errors.go`
- Create: `backend/internal/plugin/host/fake_test.go`
- Create: `backend/internal/plugin/compat_fixture_test.go`
- Create: `backend/internal/plugin/testdata/compat/plugin.json`
- Create: `backend/internal/plugin/testdata/compat/main.js`

**Interfaces:**
- Produces:

```go
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
```

- [ ] **Step 1: 编写全命名空间 fixture**

`main.js` 的 `onHTTPRequest` 根据路径调用一个 `songloft.*` API 并返回 JSON；另提供无权限路径，验证 bridge 拒绝。

- [ ] **Step 2: 定义 SongLoft JSON DTO**

DTO 字段使用 SongLoft 的 snake_case JSON，禁止直接暴露 Ent entity。

- [ ] **Step 3: 编写 fake host**

每个方法记录调用参数并返回固定结果，使 runtime/bridge 测试不依赖数据库和文件系统。

- [ ] **Step 4: 验证 fixture 可被 package manager 安装**

Run: `cd backend && go test ./internal/plugin -run CompatFixturePackage`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/internal/plugin/host backend/internal/plugin/testdata backend/internal/plugin/compat_fixture_test.go
git commit -m "test: define SongLoft host compatibility contract"
```

### Task 6: 移植 scheduler、service、manager 与 bridge

**Files:**
- Create: `backend/internal/plugin/scheduler.go`
- Create: `backend/internal/plugin/service.go`
- Create: `backend/internal/plugin/manager.go`
- Create: `backend/internal/plugin/bridge.go`
- Create: `backend/internal/plugin/bridge_fs.go`
- Create: `backend/internal/plugin/bridge_command.go`
- Create: `backend/internal/plugin/bridge_net.go`
- Create: `backend/internal/plugin/bridge_websocket.go`
- Create: `backend/internal/plugin/communication.go`
- Create: `backend/internal/plugin/manager_test.go`
- Create: `backend/internal/plugin/bridge_test.go`

**Interfaces:**
- Consumes: `jsruntime.JSEnvManager`, `Repository`, `host.Host`。
- Produces: `Manager.Start`, `Close`, `Enable`, `Disable`, `Reload`, `EnsureLoaded`, `InvokeHTTP`, `SearchLyrics`, `FetchLyrics`。

- [ ] **Step 1: 写生命周期和并发测试**

覆盖重复加载幂等、并发 `EnsureLoaded` singleflight、队列满、调用超时、关闭中取消、插件异常隔离和 idle 后懒加载恢复。

- [ ] **Step 2: 写权限矩阵测试**

对每个 action 验证正确权限、通配符权限和拒绝路径；`plugin.*` 内置能力只开放明确列出的 action。

- [ ] **Step 3: 运行测试确认失败**

Run: `cd backend && go test ./internal/plugin -run 'Manager|Bridge|Scheduler'`
Expected: FAIL。

- [ ] **Step 4: 移植并解耦 SongLoft 核心**

将所有 `songloft/internal/database` 和 `songloft/internal/services` 调用替换为 `host.Host`；保留 bootstrap JS 的公开 API 名称与 Promise 行为。

- [ ] **Step 5: 验证完整 fixture**

Run: `cd backend && go test -race ./internal/plugin -run 'Manager|Bridge|Scheduler|Compat'`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/internal/plugin
git commit -m "feat: run SongLoft plugins with host adapters"
```

### Task 7: 实现 Lark Host 适配器

**Files:**
- Create: `backend/internal/plugin/larkhost/host.go`
- Create: `backend/internal/plugin/larkhost/songs.go`
- Create: `backend/internal/plugin/larkhost/playlists.go`
- Create: `backend/internal/plugin/larkhost/files.go`
- Create: `backend/internal/plugin/larkhost/auth.go`
- Create: `backend/internal/plugin/larkhost/host_test.go`
- Modify: `backend/internal/library/catalog.go`
- Modify: `backend/internal/library/service.go`

**Interfaces:**
- Consumes: `*ent.Client`, `*library.Service`, data/library dirs。
- Produces: `larkhost.New(Config) host.Host`。

- [ ] **Step 1: 写歌曲/歌单 DTO 映射测试**

验证 SongLoft 字段、分页、搜索、所有权、添加/删除歌曲和不存在资源的错误映射。

- [ ] **Step 2: 添加 Library Service 缺少的窄接口**

只添加插件实际需要且 Lark 已能正确实现的方法，例如 playlist get/update/delete/reorder；文件整理和下载不在此任务伪造实现。

- [ ] **Step 3: 实现专用插件身份**

启动时确保内部账号存在，并在 Host 内固定使用其 user ID；令牌只由 `AuthHost` 生成，权限范围限制为插件 API。

- [ ] **Step 4: 实现文件映射**

`plugin://`、`music://`、`external://` 分别解析到插件目录、library dir 和 manifest allowlist；所有路径在打开文件前做 symlink-aware containment 检查。

- [ ] **Step 5: 对缺少宿主能力返回稳定错误**

`songs.download`、`songs.organize*` 若没有等价 Lark 实现，返回 code 为 `host_capability_unavailable` 的 bridge error。

- [ ] **Step 6: 验证**

Run: `cd backend && go test -race ./internal/plugin/larkhost ./internal/library`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/internal/plugin/larkhost backend/internal/library
git commit -m "feat: map SongLoft plugin APIs to Lark services"
```

### Task 8: 接入启动生命周期与 Echo 路由

**Files:**
- Modify: `backend/internal/config/config.go`
- Modify: `backend/internal/config/config_test.go`
- Modify: `backend/cmd/server/main.go`
- Modify: `backend/internal/api/server.go`
- Create: `backend/internal/api/plugin_routes.go`
- Create: `backend/internal/api/plugin_routes_test.go`

**Interfaces:**
- Produces: `api.WithPluginManager(*plugin.Manager)`；配置字段 `PluginsDir`、`PluginsDataDir`。

- [ ] **Step 1: 写配置默认值测试**

断言目录分别为 `${LARK_DATA_DIR}/jsplugins` 和 `${LARK_DATA_DIR}/jsplugins_data`，并由 `EnsureRuntimeDirs` 创建。

- [ ] **Step 2: 写 Echo 路由集成测试**

覆盖静态入口、SPA fallback、API body/base64、认证、admin 管理、publicPaths、404/403/503 和 shutdown。

- [ ] **Step 3: 注册管理和运行路由**

保持 `/api/v1/jsplugins` 与 `/api/v1/jsplugin/:entryPath/*`；Echo 参数读取与响应写入在 route adapter 内转换成 plugin request/response DTO。

- [ ] **Step 4: 接入有序关闭**

服务器 shutdown 先停止接收插件请求，再关闭 plugin manager/VM，最后关闭 Echo；共享 10 秒 shutdown context。

- [ ] **Step 5: 验证**

Run: `cd backend && go test -race ./internal/config ./internal/api ./cmd/server`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/internal/config backend/cmd/server backend/internal/api
git commit -m "feat: expose SongLoft plugin routes in Lark"
```

### Task 9: 插件 registry、更新和管理界面

**Files:**
- Create: `backend/internal/plugin/registry.go`
- Create: `backend/internal/plugin/update.go`
- Create: `backend/internal/plugin/registry_test.go`
- Modify: `backend/internal/api/plugin_routes.go`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types/app.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Create: `frontend/src/components/PluginSettings.tsx`
- Create: `frontend/src/components/PluginSettings.test.tsx`
- Create: `frontend/src/components/plugins/InstalledPlugins.tsx`
- Create: `frontend/src/components/plugins/PluginMarketplace.tsx`
- Create: `frontend/src/components/plugins/PluginSources.tsx`

**Interfaces:**
- Produces: list/upload/enable/disable/delete/update/registry client methods and admin settings panel。

- [ ] **Step 1: 写 registry 安全测试**

覆盖 HTTPS URL、重定向限制、响应大小、超时、私有 token 不入日志、递归 includes 环检测、重复 identity、版本比较和下载 hash 校验。默认设置必须包含：

```go
var DefaultRegistries = []RegistryConfig{
	{
		Name:     "SongLoft 社区插件市场",
		URL:      "https://raw.githubusercontent.com/deerwan/songloft-plugin-market/main/registry.json",
		Homepage: "https://songloft-store.lllh.de/#/",
		Enabled:  true,
	},
}
```

测试必须区分未保存配置与显式空数组：未保存时返回并持久化上述默认记录；用户删除后保存 `{"registries":[]}`，重建 service 或重启进程后仍保持空数组，不得重新 seed。

- [ ] **Step 2: 实现 registry 和更新**

递归解析 `includes`，以 `entryPath + identity` 去重并保留最高版本及全部 source names。远端下载进入临时文件，完成 manifest/hash 校验后才替换；运行插件更新使用 unload/install/load，失败恢复旧目录和数据库记录。

- [ ] **Step 3: 写前端组件测试**

覆盖三个内部视图“已安装 / 插件市场 / 订阅源”，以及空状态、搜索、来源筛选、重复条目合并、上传、权限确认、启停、更新、多订阅地址新增/编辑/停用/删除、删除初始化社区源、同步错误和打开插件页面。React 列表使用稳定 identity key。

- [ ] **Step 4: 在设置页增加插件管理**

增加管理员可见的“插件”一级设置标签，内部使用 segmented tabs：

```tsx
type PluginView = "installed" | "marketplace" | "sources";

<PluginSettings activeView={pluginView} onViewChange={setPluginView}>
  {pluginView === "installed" && <InstalledPlugins />}
  {pluginView === "marketplace" && <PluginMarketplace />}
  {pluginView === "sources" && <PluginSources />}
</PluginSettings>
```

沿用现有主题 tokens、设置页面密度和 Phosphor Icons。已安装插件用 toggle 启停；市场用紧凑行列表，不做卡片网格；订阅源用桌面表格/移动端行列表。危险权限 `command`、`fs:external`、`fs:music`、`net` 在安装确认中明确列出。icon-only action 提供 tooltip/`aria-label`，异步状态使用固定宽度行内反馈，避免布局跳动。

- [ ] **Step 5: 实现克制的交互反馈**

tabs 和 toggle 直接响应，不添加列表进场动画；popover/modal 使用 150-220 ms `cubic-bezier(.23,1,.32,1)`，按钮 `:active` 使用 `scale(.97)`，并在 `prefers-reduced-motion` 下移除 transform。375 px 下把次要 action 收入 menu，确保 URL 和最长插件名换行不溢出。

- [ ] **Step 6: 验证**

Run: `cd backend && go test -race ./internal/plugin ./internal/api`
Expected: PASS。

Run: `cd frontend && pnpm test && pnpm build`
Expected: PASS。

Run: `cd frontend && pnpm dev --host 127.0.0.1`
Expected: 使用浏览器在 375、768、1024、1440 px 检查 installed/marketplace/sources，无重叠、溢出或不可达控件；运行 accessibility audit，关键流程可键盘完成。

- [ ] **Step 7: Commit**

```bash
git add backend/internal/plugin backend/internal/api frontend/src
git commit -m "feat: manage SongLoft plugins from Lark settings"
```

### Task 10: 接入歌词 provider 并保留迁移回退

**Files:**
- Modify: `backend/internal/library/service.go`
- Modify: `backend/internal/library/lyric_query.go`
- Modify: `backend/internal/library/lyrics.go`
- Modify: `backend/internal/library/lyric_query_test.go`
- Modify: `backend/internal/api/server.go`
- Create: `backend/internal/plugin/lyrics_test.go`

**Interfaces:**
- Consumes: `plugin.Manager.SearchLyrics` 和 `FetchLyrics`。
- Produces: `library.WithLyricProvider(LyricProvider)`。

- [ ] **Step 1: 写插件歌词测试**

覆盖多 provider 聚合、`plugin:{entryPath}` source、候选 ID 保真、选择后缓存、provider 超时、单插件崩溃隔离和无 provider。

- [ ] **Step 2: 写旧缓存兼容测试**

已有 `netease`/`qq` source 和缓存歌词仍可读取，但 refresh 不再强制访问旧 provider。

- [ ] **Step 3: 接入迁移回退**

优先插件 provider；仅当没有任何已注册插件 provider 时，临时走当前在线实现。记录结构化 warning，方便确认生产环境是否仍在依赖回退。

- [ ] **Step 4: 验证真实歌词插件**

将一个由当前参考 SongLoft toolchain 构建的歌词插件 ZIP 放入测试临时目录，启动 manager 后通过 Lark API 搜索并选择歌词。

- [ ] **Step 5: 验证**

Run: `cd backend && go test -race ./internal/plugin ./internal/library ./internal/api`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/internal/plugin backend/internal/library backend/internal/api
git commit -m "feat: resolve online lyrics through SongLoft plugins"
```

### Task 11: 删除内置在线歌词调用链

**Files:**
- Modify: `backend/internal/library/lyric_query.go`
- Modify: `backend/internal/library/lyrics.go`
- Modify: `backend/internal/library/service.go`
- Modify: `backend/internal/netease/client.go`
- Modify: `backend/internal/qqmusic/client.go`
- Modify: `backend/internal/online/provider.go`
- Modify: `backend/internal/online/extras.go`
- Modify: associated tests only where behavior is replaced

**Interfaces:**
- Consumes: Task 10 真实插件通过的兼容证据。
- Produces: 在线歌词只经过 `LyricProvider`，本地 embedded/sidecar/cache 保持原行为。

- [ ] **Step 1: 先证明回退未被使用**

运行完整歌词测试和真实插件测试，断言没有 `legacy lyric fallback used` 日志事件。

- [ ] **Step 2: 删除旧在线歌词分支**

删除 netease/qqmusic/online provider 中仅用于歌词请求的方法和响应类型；保留仍被元数据、封面或搜索使用的代码。

- [ ] **Step 3: 更新测试期望**

无插件 provider 时返回无在线候选，不访问外网；embedded、sidecar、缓存和手动选择行为不变。

- [ ] **Step 4: 验证**

Run: `cd backend && go test -race ./...`
Expected: PASS。

Run: `cd backend && go vet ./... && go build ./cmd/server`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "refactor: remove built-in online lyric providers"
```

### Task 12: 完整兼容验收和文档

**Files:**
- Modify: `README.md`
- Modify: `README_ZH.md`
- Modify: `CHANGELOG.md`
- Create: `docs/songloft-plugin-compatibility.md`
- Create: `backend/internal/plugin/conformance_test.go`

**Interfaces:**
- Produces: 固定兼容矩阵、部署目录、权限说明、升级流程和已知宿主差异。

- [ ] **Step 1: 建立兼容矩阵测试**

测试逐项列出 manifest、lifecycle、HTTP、WebSocket、每个 `songloft.*` namespace、错误码和权限结果；失败输出上游提交哈希。

- [ ] **Step 2: 运行后端全量验证**

Run: `cd backend && go test -race ./...`
Expected: PASS。

Run: `cd backend && go vet ./... && go build ./cmd/server`
Expected: PASS。

- [ ] **Step 3: 运行前端全量验证**

Run: `cd frontend && pnpm test && pnpm build`
Expected: PASS。

- [ ] **Step 4: 更新用户文档**

记录插件目录、上传限制、权限含义、registry、插件页面 URL、歌词迁移和 `host_capability_unavailable` 能力差异。

- [ ] **Step 5: 最终 diff 审查**

Run: `git diff --check`
Expected: 无 whitespace error。

- [ ] **Step 6: Commit**

```bash
git add README.md README_ZH.md CHANGELOG.md docs backend/internal/plugin/conformance_test.go
git commit -m "docs: publish SongLoft plugin compatibility guide"
```
