# 双生态插件平台

## 管理和使用

- 管理员在「设置 → 插件」分别控制「启用Songloft插件」与「启用mygo插件」。默认保留 Songloft 启用、MyGo 关闭；停用生态不会删除插件或单插件启用意图，重新启用或重启后可恢复。
- 全局开关先持久化再执行生命周期切换。插件清理失败会显示错误与 degraded 状态，但绝不自动重新启用刚停用的生态；保存失败则不改变运行状态。多页面修改使用仅包含目标字段的 PATCH。
- MyGo 市场发现使用 `topic:mygo-music-plugin archived:false`，每页 100 条，最多读取 GitHub 搜索上限 1000 条。成功结果缓存 10 分钟，API 返回更新时间、过期与截断标记；请求失败明确报错，不以过期结果冒充最新数据。
- 仓库安装优先最新 release ZIP，无 ZIP 时固定当前 commit 下载源码。上传 ZIP 同样先解析清单与权限、不执行代码；确认后才编译检查 exports 并安装，默认停用。依赖构建产物的源码仓库须上传作者提供的可运行包。
- 普通登录用户从音乐库的 MyGo 区域选择源、填写自己的配置。插件 exports 决定可用操作；搜索、主页、收藏、歌词、歌单等依赖插件实际提供相应能力，不会伪装成功。

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
| 远端 HTTP(S) 音频/封面与请求头规则 | 受清单网络权限限制；校验 DNS 与连接目标，拒绝私网、代理和跨源凭据泄漏 |
| `file:///package/…` 音频 | 支持安全包内文件与 HTTP Range，不映射服务器任意文件 |
| 主页、搜索、分页、歌词、收藏、歌单 | 基于实际 exports；有 create/rename/delete/add/remove 时提供对应操作 |
| show/station、builtin navigation、section links | 基础浏览入口，依赖源的导出与返回结构 |
| 原生进程、webSignIn、waitForRedirect、openURL、removeDataDir、remote playback | 不支持，调用明确报错；需要 process 或 remote playback 的包在预览时拒绝 |
| host.language / host.t | 暂固定 zh-CN / 返回原始键，不加载插件 locales；不承诺完整本地化 |
| DLNA、离线下载、转码、本地歌曲编辑 | 不开放给 MyGo 私有曲目 |

ZIP 有路径、条目、源码与解压总量限制，VM 有时间/内存/存储与数量配额；超时或取消会终止相关 session，持久状态保留。插件仍是第三方代码，管理员应先审阅来源及权限，GitHub topic 不是可信认证。

## 来源与验证

- MyGo 契约 reviewed commit：`cb5e4cc49f8d4774d3a57b993e5b53c89b5a8f73`。
- Songloft reviewed commit：`518953c4edcc87d73342bf03e0f7cb6b1207e654`，原始派生基线保留为 `825f70f603a773fc8c0ded555a0cbe753d2a0d52`。
- 测试包含官方 demo、两用户隔离、恶意包、取消、网络与 Range。真实 Li Zhi 插件逻辑配合模拟 HTTP 的测试需设置本机 fixture 路径选择执行，不随源码再分发未授权上游；模拟测试不等于真实第三方账号登录或所有市场插件兼容。
- 第三方许可见根目录 `NOTICE.md`、`licenses/` 和测试 fixture 的来源说明；服务端压缩包与 Docker 镜像携带许可文本。
