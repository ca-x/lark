# 移动端体验与客户端传输评审

日期：2026-10-22

## 目标与边界

保留现有移动端主题、音乐库、账号会话及 Protobuf 契约，改善触控、键盘和无障碍使用体验。桌面客户端自动协商可用传输，不再要求使用 Cloudflare Tunnel 的用户安装 WARP。此次不重做视觉品牌、不更换数据库、不声称已完成真实手机或生产 Cloudflare 环境验证。

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| mobile-experience | 移动端键盘、播放器、焦点和动作反馈 | 现有移动主题与播放状态 |
| desktop-transport | 同端口 Connect、gRPC-Web、gRPC 与客户端自动协商 | 现有 Protobuf 与会话服务 |
| deployment-guide | 端口、Docker、反向代理、Tunnel 和故障排查 | desktop-transport |
| release | 验证、版本、提交、推送和 tag 读回 | 前述模块 |

## 体验评审

| Before | After | Why |
| --- | --- | --- |
| 键盘 viewport 每次变化都对输入框 smooth 居中 | 输入框被遮挡才即时滚动，清理待执行回调 | 避免与系统自动滚动争抢、取消后仍滚动 |
| 全屏播放器未隔离背景交互 | 背景 inert，焦点留在播放器，关闭后恢复 | 触屏读屏与键盘均不会误入背景 |
| 用整段手势平均速度判断释放 | 纳入释放方向、停顿与多指取消 | 返回手势和停住后松手不应误切歌 |
| 播放器固定 380ms 回弹且 inline transform 可能覆盖 reduced motion | 移除整页拖拽和回弹，保留原生滚动及即时手势动作 | 高频切歌不应让正在阅读的数据移动，也不应阻挡滚动 |
| Cloudflare Tunnel 用户只能使用 gRPC/WARP | 默认无凭据探测 Connect → gRPC-Web → gRPC | 用户只需填写地址，不必理解代理协议 |
| Docker 监听与发布端口混用同一变量 | 容器固定 8080，仅宿主发布端口可配置 | 修改宿主端口不应导致容器内外端口不匹配 |

## 实施顺序

1. 保存评审与验收约束，渲染基线移动界面。
2. 增加同端口 HTTP 兼容 RPC，复用鉴权、业务错误与分块媒体流。
3. 客户端自动协商；只在无认证的 GetServerInfo 上回退，登录只发送一次。协议版本不符、认证拒绝、TLS 错误和用户取消不得静默降级。
4. 改善移动端交互，补充回归测试并复查窄屏、横屏和 reduced motion。
5. 更新中英文连接帮助、端口发布文档和版本；验证后提交并推送两类 tag。

## 验收

- HTTP/1.1-only 代理下可探测、登录、浏览、收藏、读取媒体 byte range，且原有 gRPC 仍通过。
- Connect 不可用时能自动选择 gRPC-Web 或原生 gRPC；会话重载仍可连接，状态显示实际协议。
- 登录失败、服务关闭、TLS 失败、取消及协议版本不符没有凭据重试或安全降级。
- 桌面接口总开关同时控制所有桌面传输，不影响网页 API。
- 移动端搜索、播放、展开/收起、队列、对话框、焦点恢复均可使用，无水平溢出。
- 明确区分 Docker 主机端口、容器端口、HTTPS 公网端口和 cloudflared 出站连接；不要求额外开放 gRPC 端口。
- Go 测试、前端构建和桌面构建验证通过；提交及远程 tag 精确读回，不将 CI 启动误报为安装包发布成功。

## 桌面端补充评审

| Before | After | Why |
| --- | --- | --- |
| MyGo / mygo-runtime 0.5.1 | 0.6.2，2026-10-21 发布的稳定版 | 跟进 Wayland activation token 和 CJK 排印修正，验证 Go/UI 兼容性 |
| 设置直系 div 的 flex 规则覆盖连接卡 grid | 标题行选择器排除连接卡 | 避免状态、地址、按钮挤成同一行 |
| 连接时输入仍可修改、密码不可查看、进度仅文案 | 禁用已提交字段、显隐密码、status + 600ms 旋转指示 | 避免提交内容与界面内容不一致，明确系统正在工作 |
| 协议固定写成 gRPC，客户端无法自解释 | 显示协商结果、自动连接提示和错误状态 | 用户不必先理解 HTTP/2 或代理差异 |
| 抽屉无 Escape 和关闭后的焦点恢复 | 非模态 panel，Escape、焦点进入与恢复 | 保留主界面和播放器可操作，不用不必要的遮罩打断流程 |
| 900px 窗口侧栏内容溢出，面板切换恢复到旧入口 | 窄栏底部按钮纵排，按最新打开入口恢复焦点 | 设置按钮始终可点击，面板来回切换后不会丢失位置 |
| HTTP 连接关闭仅释放空闲连接 | 同时取消在途请求和媒体流，关闭后拒绝新请求 | 断开、重连和切换服务器不会遗留下载流 |
| 所有平台显示 ⌘ K | macOS 显示 ⌘，其他平台显示 Ctrl | 快捷键提示应与用户设备一致 |

动效门控：切歌、列表导航和键盘操作即时完成，不新增进入动画；按压反馈使用现有 easing token、transform、140ms，排除 focus-visible 键盘操作；仅加载指示使用 linear，reduced motion 下静止。没有引入新的动效库。

## 最终验证

- Backend：`go test -count=1 ./...`、`go vet ./...` 通过，包括 HTTP/1.1 Connect、gRPC-Web 和原生 gRPC。
- 服务端发布二进制：以临时数据目录启动 `v0.17.0`，健康检查与 HTTP/1.1 Connect 探测通过，实际响应的 HTML/JS 与本次构建产物逐字节一致。
- Desktop Go：`go test -race -count=1 ./...`、`go vet ./...` 通过。连接关闭取消流的新增测试先复现失败，再验证修复；同时覆盖调用取消、在途探测取消和服务端流退出。
- Web：`pnpm lint`、`pnpm test:mobile-interactions`、`pnpm build` 通过；构建包含 50 个测试、TypeScript 检查及嵌入服务端的静态资源更新。
- Desktop：重新生成 MyGo 绑定，TypeScript、Vite 和 Linux amd64 打包通过；检查 DEB 元数据及 tar.gz 内容，包版本均为 `0.2.0`。现有大 chunk 提示仍为非阻断警告。

浏览器回归使用临时测试账号与合成音频，不涉及生产数据：

- `320×568`、`390×844` 和 `844×390` 无水平溢出，横屏播放器控件保持可见；搜索输入字体为 16px。
- 展开播放器后背景 inert，Tab / Shift+Tab 在播放器内循环；队列 Escape 只关闭队列，下一次 Escape 关闭播放器并恢复展开按钮焦点。
- Pointer Events 鼠标拖动验证正文下滑不关闭播放器、标题栏下滑可收起；reduced motion 下无播放器位移动画。
- 桌面 UI fixture 验证密码显隐、busy 禁用与防重复提交、设置/队列互斥、Escape 和双向切换的焦点恢复、Ctrl+K、900×600 滚动及 reduced motion。

验证边界：桌面浏览器 fixture 只验证界面，真实 RPC 由 Go 集成测试验证；未宣称真机 iOS/Android 软键盘与触摸手势、所有平台原生安装、生产 Cloudflare Tunnel、Cloudflare Access 登录或 WAN 性能已经实测。Docker 未在本机运行，Compose 只作 YAML 和端口配置检查。

本次保留曲库、历史、播放队列与电台会话边界，不因 UI 改进更改播放模型。
