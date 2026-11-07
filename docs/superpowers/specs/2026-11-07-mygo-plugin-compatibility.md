# MyGo Music 插件兼容规格（范围已确认）

2026-11-07 用户确认本文兼容范围。新增依赖仍遵循下文的单独确认边界。

后续补充：用户要求 MyGo GitHub topic 插件发现及安装、两个独立生态开关，并要求
重新设计 Go 插件架构；允许两套迁移 MoeJS，但明确 Songloft 不兼容时保留当前引擎。
这些要求与新的实现设计统一记录在
`docs/superpowers/specs/2026-11-07-plugin-platform-redesign.md`，有冲突时以后者为准。

## 目标与假设

在保留现有 SongLoft 插件、数据、插件市场和运行行为的前提下，为 Lark 增加
MyGo Music 音源插件支持。兼容应包括用户实际使用音源的闭环，而不只是识别
`plugin.json` 或允许安装。

- 现有插件不迁移、不重新安装、不改 ID；两套协议明确区分。
- 首期以 `playback: stream` 的音源为目标；沿用 Lark 播放器、队列和主题。
- 服务端继续发布 `0.18.x`，不顺带发布桌面安装包。
- 不把原生桌面程序的进程启动、浏览器 Cookie 读取或系统浏览器调用权限直接
  授予服务器中的插件；不支持的能力明确提示，不能返回假成功。

## 已核验基线

- Lark：`8d5643a995bde1d01d42ebb7337d86543b883c4b` / `v0.18.11`。
- MyGo Music：`cb5e4cc49f8d4774d3a57b993e5b53c89b5a8f73`。
- 参考源码：`/home/czyt/code/go/mygo-music`，只读参考，不修改上游。
- 重点契约：上游 `README.md`、`internal/plugin/{plugin,host,source,install,headers}.go`、
  `internal/music/music.go`、`examples/demo-plugin`。
- MyGo 使用包含 `id`、对象型 `permissions`、`settings`、`navigation` 的 manifest，
  入口是导出函数的 JS/TS 模块；现有 SongLoft 使用 `entryPath`、数组型权限和
  宿主 HTTP/bridge，不能直接混用。
- MyGo 的歌曲时长和播放位置以毫秒表示，需要在 Lark 边界转换。

## 用户路径与验收

### 安装与生命周期

1. 管理员在插件设置中安装 MyGo 插件 ZIP；支持根目录与 GitHub 单层目录包。
2. 识别生态、版本、入口和权限；安装前展示网络/进程权限与不支持能力。
3. 插件可启用、禁用、删除；与旧插件同名 ID 时不互相覆盖。
4. 启动失败、调用超时、非法 manifest 和不支持的宿主能力提供明确错误。
5. 继承现有压缩包大小、解压路径、符号链接、完整性与原子安装保护。

### 实际音源使用

1. 插件设置字段可编辑并持久化，按插件隔离；敏感值不写入日志或 URL。
2. 按实际导出能力提供首页/自定义浏览、搜索及分页、歌单/专辑/艺术家查看。
3. 搜索或歌单中的歌曲可加入 Lark 队列，并通过 `stream({id, quality})` 解析播放；
   正确转换元数据、时长和封面，不把外部 ID 当作 Lark 数据库歌曲 ID。
4. 播放代理保留必要请求头与 Range；重定向到不同域名时不泄露认证请求头。
5. 支持插件 LRC/翻译歌词以及可支持的逐字歌词；无法表示的格式明确降级。
6. 插件实现相应导出时，接通账户状态、收藏状态/操作和歌单操作；未实现的按钮
   不显示或明确禁用，而不是点击无反应。
7. 不覆盖本地曲库、旧插件或其他用户的收藏、账户与设置。

### 能力边界

- `host.storage`、`host.setting`、语言/翻译、定时器、受控 `fetch` 和所需密码学
  helper 按上游契约实现；Promise、错误 code 和同步返回值都需覆盖。
- JS/TS 入口及模块依赖须使用真正的模块解析/编译，不能正则替换 `export`。
- `permissions.network` 的域名/通配符规则必须实际限制请求与重定向；无声明
  就不能访问网络。仅声明网络权限不等于可以访问服务器私有地址。
- 图片和音频的 `requestHeaders` 按域名、资源种类和当前 setting/storage 解析；
  不得将凭据直接下发到不可信域名。
- 原生 `host.webSignIn`、本机回调监听、`host.spawn` 和 `playback: remote` 首期
  不伪装为已兼容。依赖这些能力的插件须明确标记限制，必要时阻止启用。
- 服务端多用户边界：插件代码安装/权限由管理员管理；账户与凭据不能无提示地
  在用户之间共享。具体隔离方案在实现计划中明确后才能接入真实登录。

## 技术与目录

- 后端：Go，现有 Echo / Ent / QuickJS 插件体系。
- 前端：React / TypeScript，沿用现有设置和播放器组件。
- `backend/internal/plugin/`：现有协议接入边界与安装、权限、生命周期。
- 新的 MyGo 适配代码集中在独立边界，避免在旧协议全链路堆条件判断。
- `backend/internal/api/`：认证后的插件管理与音源 API。
- `frontend/src/components/PluginSettings.tsx` 及相关 feature/service：安装、配置、
  音源交互；配套中英文文案。
- 测试与实现同目录；兼容矩阵及使用说明放 `docs/` 与 README。
- 如确需新增编译器/运行时依赖或数据库 schema，先单独说明理由并确认。

## 风格

遵循现有错误包装、context 取消和宿主接口风格。例如：

```go
func validateSourceID(sourceID string) error {
    if strings.TrimSpace(sourceID) == "" {
        return fmt.Errorf("source ID is required")
    }
    return nil
}
```

只改兼容所需范围；不重构播放器、不改主题/logo、不修改既有插件的权限语义。

## 验证策略与命令

- 使用上游官方 demo 执行安装、设置持久化、搜索、歌单、收藏、歌词、stream
  的真实运行测试；再选一个实际 streaming 插件验证适用能力并记录限制。
- 请求本地测试音频，验证完整数据、Range、必要请求头和重定向凭据隔离。
- 覆盖旧插件兼容回归、路径穿越、权限绕过、跨用户访问、禁用后失效、超时
  和关闭时清理。浏览器覆盖桌面/手机的安装配置与搜索到播放的实际操作。
- 不用“安装成功”代替运行兼容，不用仅字符串断言代替交互行为验证。

```sh
cd backend && go test ./internal/plugin/... ./internal/api/... ./internal/library/...
cd backend && go mod verify && go test ./... && go vet ./...
cd frontend && npm run lint && npm run build
cd frontend && npm run test:settings
git diff --check
```

以上 `cd` 命令分别从仓库根目录执行。

## 发布门禁

更新 README、兼容矩阵、中英文 CHANGELOG 和前端版本；完成测试及构建产物
一致性核验后，提交推送并发布下一个未占用的 `v0.18.x`。等待 CI、二进制和
Docker 工作流成功，核验官方二进制和公开 release；不覆盖既有 tag/产物。

## 确认记录

用户已确认首期采用上述“流媒体音源完整使用闭环，明确标记原生专属能力限制”
的范围，而不是承诺所有 MyGo 桌面插件无差别运行。
