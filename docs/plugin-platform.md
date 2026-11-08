# 双生态插件平台

## 管理和使用

- 管理员在「设置 → 插件」分别控制「启用Songloft插件」与「启用mygo插件」。默认保留 Songloft 启用、MyGo 关闭；停用生态不会删除插件或单插件启用意图，重新启用或重启后可恢复。
- 全局开关先持久化再执行生命周期切换。插件清理失败会显示错误与 degraded 状态，但绝不自动重新启用刚停用的生态；保存失败则不改变运行状态。多页面修改使用仅包含目标字段的 PATCH。
- MyGo 市场发现使用 `topic:mygo-music-plugin archived:false`，每页 100 条，最多读取 GitHub 搜索上限 1000 条。成功结果缓存 10 分钟，API 返回更新时间、过期与截断标记；请求失败明确报错，不以过期结果冒充最新数据。
- 仓库安装优先最新 release ZIP，无 ZIP 时固定当前 commit 下载源码。上传 ZIP 同样先解析清单与权限、不执行代码；确认后才编译检查 exports 并安装，默认停用。依赖构建产物的源码仓库须上传作者提供的可运行包。
- MyGo 管理默认打开「插件市场」，卡片直接「安装」，自动获取并检查后显示来源、摘要和权限确认；「已安装」负责启停、配置和删除，ZIP 和仓库地址收纳在「手动安装」。安装不等于启用。
- 「已安装」卡片提供「打开音乐源」，开启总开关与单插件后直达所选源；也可以从「曲库 → 音乐源」进入。进入或切换源时自动加载插件首页，登录入口在源页面内；未启用或没有音乐源界面时，卡片说明原因。
- ZIP 选择唯一最浅层 `plugin.json` 作为清单，兼容仓库内的 `dist/plugin.json` 和测试 fixture；同层存在多个候选清单、重复条目、路径越界及体积超限仍拒绝，不执行构建脚本。
- 音乐库按实际能力显示独立页签：生态启用且有已启用的流媒体浏览源时显示「音乐源」；管理员有运行中且提供前端的 Songloft 插件时显示「插件工具」，可直接打开其独立页面。无能力、停用、后台插件均不强行生成空页签；普通用户不能访问管理员工具宿主。
- 普通登录用户从「音乐库 → 音乐源」选择源、填写自己的配置。插件 exports 决定可用操作；搜索、主页、收藏、歌词、歌单等依赖插件实际提供相应能力，不会伪装成功。
- `signInPrompt` 的 QR 文本在本机生成二维码，支持取消；离开源页面会取消正在进行的登录。不会将二维码或凭据发送给第三方二维码服务。
- 导出 `account()` 的源展示持续的登录状态与账号名称，进入页面、窗口重新获得焦点、登录或退出后刷新；查询失败显示「状态未知」并允许重试，不冒充未登录。终止音频错误会清除缓冲状态并提示，底部播放按钮与曲目按钮均可重新加载失败资源；MyGo 不进入本地歌曲的自适应转码救援。

## 隔离与生命周期

- 平台协调器只依赖存储和窄 Lifecycle 接口，组合根手工注入。Songloft 与 MyGo 协议适配器不互相调用，也不在执行失败后切换引擎重跑。
- Songloft 保留 QuickJS、原安装路径和 `.jsc`；既有管理员宿主语义不变，不声称其自动变成逐用户插件。最新上游差异见能力矩阵。
- MyGo 使用 `github.com/MoeForge/moejs v0.1.0-alpha.11`，每个用户/插件独立 session，VM 由单 goroutine 事件循环拥有。设置、storage、cookie、账号和媒体句柄不在不同用户间共享。
- GitHub 来源 identity 按规范化 owner/repo 固定，升级 revision 可保留状态；上传包无法证明作者身份，因此按 ZIP SHA-256 固定，改变 ZIP 不自动继承凭据。用户数据使用 v2 来源命名空间，不迁移无来源的开发期 v1 数据。
- 卸载保留同来源的私有存储；相同 manifest ID 的不同来源不能读取旧配置。队列、流地址、封面和源调用携带 identity，重新安装不同来源后旧引用失效；恢复队列只保留当前启用且 identity 相符的曲目。
- MyGo 曲目使用前端稳定负数 ID，仅保存到用户私有队列，不调用全局歌曲写入、播放历史、下载缓存或本地歌单接口。收藏属于源，不等同于本地曲库收藏。
- Suspend/Resume 可逆；Close 仅用于最终关闭。停用取消源调用与媒体传输，清理 VM；音频不使用固定 90 秒整段传输超时，仍受连接/响应头超时与会话取消约束。

## 支持边界

| 能力 | 当前行为 |
| --- | --- |
| ES/TS module、静态包内 imports、Promise、timer、fetch | 支持；不下载或安装 npm 依赖 |
| host.setting / storage、常用 crypto、signInPrompt | 支持；设置与状态按用户/来源隔离 |
| 远端 HTTP(S) 音频与请求头规则 | `stream()` 返回的公共 CDN 不受插件 API 域名列表限制，与 MyGo 播放器语义一致；仍校验 URL、DNS 与连接目标，拒绝私网、代理、HTTPS 降级及跨源凭据泄漏 |
| 插件 `fetch` 与任意封面代理 | 仍受清单网络权限限制；音频 CDN 例外不扩大插件 API 或任意图片代理权限 |
| `file:///package/…` 音频 | 支持安全包内文件与 HTTP Range，不映射服务器任意文件 |
| 主页、搜索、分页、歌词、收藏、歌单 | 基于实际 exports；有 create/rename/delete/add/remove 时提供对应操作 |
| show/station、builtin navigation、section links | 基础浏览入口，依赖源的导出与返回结构 |
| 原生进程、webSignIn、waitForRedirect、openURL、removeDataDir、remote playback | 不支持，调用明确报错；需要 process 或 remote playback 的包在预览时拒绝 |
| host.language / host.t | 暂固定 zh-CN / 返回原始键，不加载插件 locales；不承诺完整本地化 |
| DLNA、离线下载、转码、本地歌曲编辑 | 不开放给 MyGo 私有曲目 |

ZIP 有路径、条目、源码与解压总量限制，VM 有时间/内存/存储与数量配额；超时或取消会终止相关 session，持久状态保留。插件仍是第三方代码，管理员应先审阅来源及权限，GitHub topic 不是可信认证。

## 来源与验证

- MyGo 契约 reviewed commit：`cb5e4cc49f8d4774d3a57b993e5b53c89b5a8f73`。
- Songloft reviewed commit：`2b7c11daea37a0f612e69c81638adc96f4fa06a1`，原始派生基线保留为 `825f70f603a773fc8c0ded555a0cbe753d2a0d52`；8 个原始包检查范围、收藏映射、电台导入与升级后重新选择歌单的要求见能力矩阵。
- 测试包含官方 demo、两用户隔离、恶意包、取消、网络与 Range。真实 Li Zhi 插件逻辑配合模拟 HTTP 的测试需设置本机 fixture 路径选择执行，不随源码再分发未授权上游；模拟测试不等于真实第三方账号登录或所有市场插件兼容。
- 网易云回归使用 `sogud/mygo-music-netease@v0.1.3` 的原始 ZIP（commit `bfaed424da72f3c776c42e2643b328f2a210c5ac`，AGPL-3.0），设置 `LARK_MYGO_NETEASE_FIXTURE=/path/to/netease-0.1.3.zip` 后运行 `go test ./internal/mygo -run TestRealNeteasePackageSignIn`。实际插件代码配合模拟 HTTP 验证 key-first AES、二维码提示、轮询、含 Expires 的多条 Set-Cookie、账号隔离及退出；不随仓库内置插件代码，也不声称已授权真实个人账号或所有付费曲目可播放。
- 第三方许可见根目录 `NOTICE.md`、`licenses/` 和测试 fixture 的来源说明；服务端压缩包与 Docker 镜像携带许可文本。
- v0.18.13 在独立临时服务中安装该网易云 ZIP，已通过真实上游接口生成二维码并在浏览器本地显示、取消；未扫描或授权个人账号。界面回归运行 `npm run test:plugin-workspace`，覆盖市场安装、能力页签、二维码、取消、删除确认/失败重试、底部留白与首页滚动。
- v0.18.14 按市场快照逐项尝试 50 个仓库，37 个可安装启用，13 个因原生能力或包体积限制被拒绝。兼容不等于所有账号、音频和操作均已验证；测试条件及逐项结果见[检查记录](mygo-market-audit-2026-11-08.md)。
- v0.18.15 对照 MyGo 的 `Plugin.Stream`、`HeadersFor` 与播放器 HTTP 路径纠正 API 权限误用于音频 CDN 的问题。新增网易云 v0.1.3、v0.1.6 原始 ZIP 登录后 `stream()` 回归（模拟 HTTP），第二个包使用 `LARK_MYGO_NETEASE_V016_FIXTURE` 指定；覆盖普通/云盘曲目 ID 返回的 CDN 地址、请求头与账号隔离。浏览器回归覆盖持续登录状态、状态失败重试、HTTP 音频失败退出缓冲、底部按钮重试后实际音频进度前进。未授权真实个人账号，不承诺会员/地区限制曲目可播放，也不新增插件未导出的云盘浏览能力。
