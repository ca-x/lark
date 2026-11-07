# Lark 双生态插件平台重设计（2026-11-07 用户已确认）

## 目标与已确认要求

在不破坏已安装 Songloft 插件的前提下，让 MyGo 原有插件能在 Lark 内被发现、安装、
配置和使用。不是把 MyGo 包装成假的 Songloft HTTP 插件，也不是为两个系统复制整套
管理与权限逻辑。本文件接续已确认的 MyGo streaming 功能规格。

- 两个管理员全局开关，中文名称严格为 **启用Songloft插件** / **启用mygo插件**。
- 两个开关独立、可同时开启；关生态不删除包、不清理配置、不重置单插件启用意图。
- MyGo 市场使用 GitHub topic `mygo-music-plugin`，兼容仓库地址安装及 ZIP 安装。
- 保留 Songloft 市场、已安装插件、ID、存储、配置和既有 API。
- 用户允许两套换 MoeJS，也明确允许 Songloft 不兼容时继续沿用当前引擎。
- 完成功能、兼容性与发布产物验证后发布服务端 `0.18.x`，不顺带发桌面安装包。

## 上游基线与已做验证

2026-11-07 通过本地 clone、GitHub API 及 `git ls-remote origin HEAD` 核验：

| 项目 | 本地路径 | 核验的 HEAD |
|---|---|---|
| Lark | `/home/czyt/code/go/lark` | `8d5643a995bde1d01d42ebb7337d86543b883c4b` |
| MyGo Music | `/home/czyt/code/go/mygo-music` | `cb5e4cc49f8d4774d3a57b993e5b53c89b5a8f73` |
| Songloft | `/home/czyt/code/go/songloft` | `518953c4edcc87d73342bf03e0f7cb6b1207e654` |

两个上游 checkout 均未修改。MoeJS 使用核验到的最新发布版 `v0.1.0-alpha.11` 评估；
这是 alpha 版本，不能因其支持 JavaScript 就推断业务插件契约全部兼容。

独立临时模块 `/tmp/lark-moejs-probe` 实测三项通过，未向 Lark 引入依赖：

1. 官方 MyGo demo 原文件在 MoeJS 中加载，真实 `search` 返回 `t2 / Song 2 / 12000ms`。
2. Lark 当前 Songloft polyfill 在 MoeJS 默认配置下确实失败：修改被冻结的
   `Function.prototype.toString` 会抛 TypeError。
3. 独立 `MutableIntrinsics: true` runtime 可初始化当前 polyfill 与 Songloft
   bootstrap，暴露预期函数。这只证明初始化，不代表网络、宿主、异步或真插件兼容。

以上不是产品验收。未测试真实服务登录、完整 Songloft 行为、官方发布包或 Docker。

## 当前结构需要改什么

- `plugin.Manager` 同时负责安装、生命周期、桥接、网络、HTTP、媒体 URL、事件和
  provider 注册；不能继续向其中加入整套 MyGo 分支。
- `NewManager(...args ...any)`、`NewRegistryService(...args ...any)` 运行时猜依赖；
  必需依赖应改为类型化构造注入，不能传错了还静默忽略。
- 当前 `Manager.Close()` 和 runtime shutdown 都是不可逆终态。生态开关如果直接
  调用 Close，再开就无法恢复；需要可逆 Suspend/Resume 与最终 Close 分离。
- 现有 fetch 使用包级 HTTP client 和 background context，取消 JS 等待不会立即
  取消网络。这是新运行层必须避免的设计，不可当作 MyGo 安全策略复用。
- Songloft 当前是实例级、管理员宿主语义；MyGo 的用户账户不能复用管理员 fallback。
- 不为重设计迁移整个 Ent/Library/API：先隔离消费接口与运行边界，保留既有适配器。

## 架构选择

```text
API / 设置 / 播放器
        │
 pluginapp.Service ── SettingsStore
        │             全局开关 / 状态 / 入口授权
        ├── Songloft adapter ── Registry catalog ── 现有市场与包
        │       ├── Songloft bridge / 现有 Lark host
        │       └── QuickJS session（本次兼容基线）
        │
        └── MyGo adapter ── GitHub topic catalog ── repo/release/ZIP
                ├── MyGo exports / 用户级 host
                └── MoeJS session（逐用户隔离）

     可复用的资源预算 / 网络策略构造 / 日志脱敏 / 包检查
     不共用 VM、用户凭据、bridge 对象或插件执行全局变量
```

### 不强行统一 VM

- 本次 **MyGo 用 MoeJS，Songloft 默认保留现有 QuickJS**。这是用户授权的兼容回退，
  不是断言 MoeJS 永远不能运行 Songloft 源码。
- MoeJS 原生支持 MyGo 所需 ESM、async、TypeScript 去类型及 webapi/eventloop；
  先用它自己的编译/受限 Importer，不预先引入 esbuild 或第二套模块系统。
- Songloft 的 QuickJS `.jsc` 字节码不能作为 MoeJS 源码执行。现有只带 `.jsc` 的包
  继续走旧引擎，不要求用户重装、不丢配置、不偷偷下载其他源码替代。
- 未来只有源码、全桥接/异步契约与真实包矩阵全部通过，才逐步迁移 Songloft 到 MoeJS。
  允许私有 mutable intrinsics，不允许为了兼容修改其他 runtime 的共享 builtins。
- 不能“新引擎调用失败就换旧引擎重跑”：调用可能已经写库或发出外部请求，会造成
  重复副作用。引擎选择在实例创建前完成，调用期间不跨引擎重试。

### 手工依赖注入，不加 DI 框架

- 在现有启动 composition root 显式组装 Repository、HTTP client/policy、两个
  catalog、协议 adapter、runtime session builder 和平台 service。
- 必需依赖用构造参数/Dependencies struct，构造时校验并返回 error；可选项才用
  typed functional options。移除新代码的 `...any` 依赖扫描。
- 接口放在消费侧，按行为最小化：SettingsStore、Lifecycle、Catalog、媒体解析等。
  不创建几十个方法的 Engine 接口，也不复制整个 Library 接口。
- 不传容器、不用全局 registry、不用 init 注册服务、不使用 Resolve(any) locator。
- `host.Host` 暂留给旧 Songloft 适配器，不要求 MyGo 实现它；新 API 不再通过
  Manager.SongsHost() 等路径临时寻找无关服务。

示例只表达生命周期边界，不把两种协议的调用方式塞入同一接口：

```go
type Lifecycle interface {
    Resume(context.Context) error
    Suspend(context.Context) error
    Close(context.Context) error
}

type Engines struct {
    Songloft Lifecycle
    Mygo     Lifecycle
}
```

## 状态与开关语义

- 默认沿用已安装环境：Songloft 开启，新增 MyGo 默认关闭；管理员可自行打开。
- `desired_enabled` 与 `runtime_state` 分开；后者为 disabled / starting / running /
  stopping / degraded，避免失败后仍显示“运行成功”。
- 全局开关在现有 AppSetting 中持久化，不修改所有单插件 status 字段。
- PATCH 使用可选字段 `songloft_enabled` / `mygo_enabled`，独立更新，避免一个开关
  用旧快照把另一项覆盖。服务端串行化状态变更并返回权威结果。
- 关闭：先拒绝新执行与懒加载，再取消该生态在途调用、stream、socket/子进程，
  有界等待和清理；保留安装态与个人配置。重新打开只恢复原先启用的插件。
- 开关必须在实际 dispatch、bridge、媒体解析、host token 授权处生效，不只隐藏菜单。
- 每次状态代际变化使旧 session/媒体句柄失效；旧异步结果不能重建已关闭实例。
- 全局 Close 只用于退出；API 停接收 → 协议 session 排空 → 网络/loop/VM 清理 → DB，
  整批共享一个截止预算，每个资源只有一个明确关闭者。

## 身份、账户与安全边界

- 身份是 `(ecosystem, pluginID, origin)`，不是裸 entryPath；旧安装仍解释为 Songloft。
  不为兼容做批量重命名或搬目录。
- MyGo 执行 scope 明确包含服务器认证得到的 userID；VM、setting、storage、Cookie、
  缓存和媒体句柄按用户及插件隔离。缺用户身份时 fail closed，不回退管理员。
- 外部 track ID 与本地 Song ID 分离，不将用户私有音源直接导入全站共享 Song 表。
- 单调用、实例数、空闲存活、内存、编译缓存、状态值和ZIP解压都有上限。
- MyGo fetch 必须同时具有受控 HTTP client 和域名 allow hook；限制真实 DNS 解析、
  每次重定向和其他可触网入口。默认禁止私有/回环/link-local 目标。
- Cookie/Authorization/requestHeaders 只用于当前用户和许可域名；跨 origin 重定向
  不转发凭据；日志、预览结果、前端 URL 不携带密钥。
- MyGo 原生 webSignIn、spawn、remote playback 保持明确 unsupported；不能把
  服务器的系统浏览器/进程能力伪装成用户桌面能力。
- MoeJS 不是 OS 沙箱；安全来自宿主暴露能力、资源限制和网络策略，不能依赖 engine
  名称代替授权。

## 两套发现与安装流程

- Songloft 保留原 registry JSON/includes、订阅和安装路径。
- MyGo topic 查询固定为 `topic:mygo-music-plugin archived:false`；支持分页、
  限流与短缓存，失败显示错误/旧缓存时间，不假装“没有插件”。
- topic 仅负责发现，不代表审核或信任。保留 GitHub repo ID、owner/repo、来源 SHA、
  下载摘要；插件安装态在每次响应时合并，不混入共享搜索缓存。
- 仓库安装优先兼容的 release ZIP，缺 release 时固定默认分支 commit 后下载源码包；
  不跟随任意 URL，不把 401/403/429 当作“没有 release”。
- 下载 → 校验 → 权限/限制预览 → 确认同一 SHA256 包 → 原子安装；确认前不执行脚本。
  更新新增权限必须重新确认，不能自动扩权。
- ZIP/源码包复用边界检查的代码与测试，不复用 Songloft manifest 解析。保留大小、
  路径穿越、符号链接、重复文件及解压预算保护。

## Songloft 新契约差异与处理

| 核验到的上游契约 | Lark 当前情况 | 重设计处理 |
|---|---|---|
| `renderEngine: webview / lynx` | 仍是 webview / webf | 保留历史 WebF；Lynx 仅在包带 Web fallback 时走浏览器，不能宣称原生 Lynx |
| `tags.read/write/*` | 权限与宿主缺失 | 识别并列为明确能力缺口；不能仅放宽权限白名单冒充实现 |
| `net:insecure-tls` | 未支持 | 与 net 分离；默认严格 TLS，不更改共享 transport；未实现时明确拒绝能力 |
| `net.httpStream` | 未实现分块句柄 | 独立 bridge 能力；补齐需覆盖 headers/read/cancel/预算/卸载回收，不以 buffered fetch 假替代 |
| `playlists.replaceSongs` | 无原子替换接口 | 需要带事务的宿主能力；不能拆成先清空后逐条添加 |
| registry identity 规范化 | 仅 trim/lower author 或完整 updateURL | 对齐作者去邮箱/备注与 repo 身份规则；不改旧 entryPath |
| 当前 QuickJS `.jsc` 包 | 已支持并执行 | 保留旧 engine 路线，不能直接迁移字节码 |

能力矩阵分“支持 / 条件支持 / 未实现 / 原生不可用”；解析最新定义与执行能力是两层。
不能只通过更新 baseline SHA 宣称已经支持上游所有新增功能。旧来源归属 SHA 保留，
另记本次 reviewed SHA；本次 clone 中未找到旧 baseline 对象，不伪造逐提交差异结论。

## 目录与渐进落地顺序

```text
backend/internal/pluginapp/       平台开关、状态、入口授权、消费侧小接口
backend/internal/plugin/          原 Songloft 协议与宿主，先保留包名/API
backend/internal/mygo/            MyGo manifest、exports、账户/源与 host 适配
backend/internal/pluginruntime/   MoeJS session、loop 与资源所有权
backend/internal/plugincatalog/   GitHub topic/release，复用必要的安全下载能力
backend/internal/api/             薄认证与 DTO 层，保留旧路由
frontend/src/features/plugins/    双开关、两类市场/安装与源浏览交互
docs/                            能力矩阵、上游基线与使用/限制说明
```

1. 先为旧行为与生命周期建立回归；加类型化依赖和可逆 Suspend/Resume，不更换引擎。
2. 落地平台双开关与执行门禁，覆盖停用竞态和重新打开；保持旧包/配置不变。
3. 用独立 MoeJS session 跑真实 MyGo demo 与 streaming 插件，完成按用户隔离。
4. 接 GitHub topic/release/ZIP 的预览确认安装链路及两类市场界面。
5. 接通 MyGo 配置、浏览/分页、播放器、队列、歌词、收藏及可用歌单操作。
6. 更新 Songloft 契约识别/兼容矩阵；按宿主现有能力逐项实现，不虚报完整支持。
7. 完整回归、构建产物验收和新 `0.18.x` 发布；Songloft 换 MoeJS 不作为发布前提。

## 测试、命令与发布门禁

- 用现有真实 Songloft 包矩阵验证装载、曲库/歌单/歌词/事件/网络，不只测 onInit。
- MyGo 用官方 demo 加至少一个固定来源的真实 streaming 插件；实际登录/联网验证
  与本地fixture测试分开报告，不假报第三方服务可用。
- 两用户 × 两生态 × 四种开关组合；停用后拒绝执行、重新打开恢复、旧句柄失效、
  在途请求取消、超时/关闭泄漏、跨源请求头和 DNS rebinding 均需行为测试。
- 运行时 owner-loop 单 goroutine 访问，只有受支持的 Interrupt 跨线程；并发用 race
  与可用的 synctest 验证，测试 HTTP/状态存储由构造注入，不改生产安全策略。
- 桌面/手机真实测试预览安装、配置保存、搜索到播放/seek、收藏、队列恢复；验证
  暗色主题文字、控件对齐与键盘操作，不能只检查标签存在。

以下命令各自从仓库根执行，新增包名以实现计划最终划分为准：

```sh
cd backend && go test ./internal/plugin/... ./internal/api/... ./internal/library/...
cd backend && go mod verify && go test ./... && go vet ./...
cd backend && go test -race ./internal/plugin/... ./internal/jsruntime/...
cd frontend && npm run lint && npm run build && npm run test:settings
git diff --check
```

新增包需加入 targeted/race 命令。发布前还须官方 CI、二进制、Docker 工作流通过，
核验真实下载包、版本/SHA、嵌入资源与公开 release，版本发布前重查，不能覆盖旧 tag。

## 变更边界与确认点

- Always：保留已安装数据；错误真实可观察；最小接口；显式依赖；先测试再发布。
- Ask first：破坏兼容、数据库 schema 变更、额外 OS/进程权限或范围外 UI/音频重写。
- Never：插件代码先执行后确认、静默扩权、共享用户凭据、丢弃失败测试或误报发布。
- 本文件的架构已获用户确认，发布须通过测试。按替代实施计划连续实现，
  不再沿用已失效的 ZIP-only/共用 QuickJS 草案。
