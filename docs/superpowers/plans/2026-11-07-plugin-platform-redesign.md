# 双生态插件平台实施计划

规格：`../specs/2026-11-07-plugin-platform-redesign.md`，2026-11-07 已确认。
原 MyGo 兼容实施计划作废。本计划在当前会话直接连续执行，不再拆开询问。

## 架构与顺序

手工构造注入；平台只依赖窄 Lifecycle，Songloft 保留 QuickJS，MyGo 独立 MoeJS。
先生命周期与开关，再按用户隔离的 MyGo 执行、市场安装，最后前端播放与回归发布。

## 任务

- [x] 1. 平台状态存储、双开关、可逆 Songloft Suspend/Resume。
  - 验收：四种开关组合、重启持久化、停用拒绝入口、重启不丢单插件意图。
  - 测试：pluginapp 单测、Songloft 生命周期回归及 race。
- [x] 2. MyGo 契约、受限文件包、MoeJS 单 goroutine session。
  - 验收：真实 ES/TS exports、async、超时取消、受限网络与 host storage/setting。
  - 测试：demo 搜索、异步、恶意包/路径/网络/无限循环、跨用户隔离。
- [x] 3. GitHub topic 市场、仓库/release/ZIP 预览与确认安装。
  - 验收：不先执行代码、拒绝原生进程和 remote playback、安装来源固定并可核验。
  - 测试：fixture GitHub HTTP、压缩预算、身份冲突、安装后仍默认停用。
- [x] 4. 认证 API、用户配置与源调用、媒体代理。
  - 验收：按服务器身份授权；本地包媒体安全访问；远端媒体无 SSRF；不写全局 Song 表。
  - 测试：两用户的配置/存储/句柄隔离，停用后旧媒体失效，Range 播放。
- [x] 5. 设置双开关、MyGo 安装/配置/浏览与播放器队列。
  - 验收：搜索/分页/播放/歌词/收藏/队列和可用歌单操作；unsupported 可见而非无反应。
  - 测试：前端单测、lint/build、浏览器桌面/手机深浅色。
- [x] 6. Songloft 最新契约能力矩阵及来源说明。
  - 验收：明确条件支持和未实现，不把 reviewed SHA 当作完整支持声明。
- [ ] 7. 全量测试、提交推送、0.18.x 服务端发布。
  - 测试：Go test/vet/race，前端 lint/build/test:settings，diff --check，CI/发布资产。
  - 发布：查询未占用版本；只在全部验收通过后提交、推送、打 tag；核验实际产物与版本。

## 执行记录（发布前源码快照）

- 基线 `8d5643a`，候选服务端版本 `v0.18.12`；未修改桌面客户端版本或发布通道。第 7 项的远端 CI、正式产物与发布状态以 GitHub Actions / Release 为准，不在打 tag 前伪记完成。
- Go 全量 test/vet/mod verify、MyGo/pluginapp/pluginruntime/Songloft/jsruntime/API race 通过；前端 MyGo 专项、lint、build（含设置测试和 126 项回归）通过。fixture 覆盖真实官方 demo、async/取消、网络/包安全、按用户/来源隔离、Range 与媒体生命周期。
- 浏览器在独立临时数据目录验证：上传预览、GitHub topic 发现、真实仓库固定 commit 安装且默认停用；demo 音频实际播放、收藏与主播放器同步、用户配置、歌单创建/重命名/添加/移除/删除；生态停用返回 503、重新启用恢复；重启保留配置/收藏/私有队列。
- 普通用户实际登录可浏览源，设置/收藏/队列与管理员分离；修改全局开关和访问市场返回 403。桌面 1440、平板 768、手机 390 宽度无横向页面溢出；修复手机导航按钮被全局 nav 样式拉宽、全局浅色主题配合手机深色局部 palette 的提示文字对比度问题。
- 最终独立审查的 6 项首轮与 3 项二轮阻断全部修复并复审确认；新增回归覆盖抛错 deinit 不撤销停用、PATCH 独立修改、同 ID 不同来源不继承凭据、HTTPS 降级/跨端口凭据、活跃长流不被 idle 淘汰、播客和全部实体分页。

Ruling: 开关先保存 desired state，再执行生命周期；清理错误只报告 degraded，不回滚重开刚停用的代码 — 管理员停用是安全边界 — 代价是 API 报错后界面必须重新读取真实状态。

Ruling: GitHub 以规范化仓库作为持久来源，上传 ZIP 以 digest 作为来源，开发期无来源 v1 数据不迁移 — 不允许同 ID 替换源窃取原账号配置 — 代价是更换上传包后用户需重新配置。

Ruling: Li Zhi 上游没有再分发许可证，不把完整源文件纳入仓库；真实兼容测试改为本机 fixture 路径显式选择执行 — 保留互操作验证而不再分发未授权代码 — 默认 CI 仍运行已授权官方 demo 与独立契约测试。

Ruling: 本次只开放流媒体与基础浏览操作，原生进程/窗口登录、remote playback、私网访问和完整插件 locale 均明确列入 unsupported/limited — 不为兼容静默扩权 — 已在 README 与能力说明中告知用户。
