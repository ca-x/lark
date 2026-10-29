# Damir 视频参考播放器主题选型

## 状态与目标

状态：2026-10-29 用户确认按高保真适配落地 Soft Static 与 Prism，新增桌面主题，保留移动端。用户再次指定 music/tile.mp4，确认 Soft Static 为重点参考。

从 <https://heydamir.design/> 的真实视频中选择适合 Lark 的独立播放器主题。保留现有播放器、移动端主题和音频服务，不把视频背景或预录动画当成可操作的播放器。

暂定先新增两款桌面主题，不更改用户当前主题。用户要求的“100% 还原”不能仅凭录像证明：目前取得的是展示 MP4 和 poster，没有取得作品的原始代码、字体、唱片纹理或素材再分发许可。以下是高保真可行性选型，不是像素级一致的承诺。

## 参考证据与选择

2026-10-29 通过原站的作品弹窗确认了 12 个作品名称及完整视频地址，查看全部 poster，并对 Soft Static、One light, every color、Beacon、Landing book、Typewriter、Snow globe、Shredder 的完整视频抽帧比较。

| 作品 | 已核实的视频 | 判断 |
| --- | --- | --- |
| Soft Static | [完整视频](https://media.sokol.studio/v1/concepts/music/full.mp4)，1920 × 1198，18.836 秒 | 首选，原本就是音乐播放器。黑底、左侧裁切的大幅彩色黑胶、金属唱臂、环绕音符、底部微型 transport。布局与主要机械运动可以独立重建；彩色纹理与音符数据需要明确处理。 |
| One light, every color | [完整视频](https://media.sokol.studio/v1/concepts/rainbow/full.mp4)，1920 × 994，9.100 秒 | 首选，适合“棱镜光谱”主题。左侧白光、中央圆角透光面板、右侧彩色扇形光束与下方倒影；视频演示了启用分光、面板倾斜及指针选择颜色。几何与光效不依赖复杂模型。 |
| Beacon | [完整视频](https://media.sokol.studio/v1/concepts/beacon/full.mp4)，1920 × 1072，8.000 秒 | 条件备选。蓝白版画灯塔与扫光能形成浅色主题，但精确视觉依赖原版插画。未取得原图与再分发许可前不纳入实现，不能用 AI 重画后称为原样还原。 |

### 不选的作品

- Landing book：翻页曲面、桌面布景、树影、投影和镜头变化依赖未取得的素材与参数。
- Typewriter：机械模型、按键、字车和纸张协同运动；用简化 CSS 造型只能近似，达不到本次还原要求。
- Snow globe：玻璃折射、雪粒子、内部场景、可抓取物理运动和场景切换，缺少原模型及环境资源。
- Shredder：核心语义是销毁文档，直接迁移成播放交互会误导用户；碎纸演出也不适合频繁切歌。
- Meadow footer、Step out of the feed、Touch grass、A 404 that sank、Folder funeral：从 poster 的场景与任务语义看不优于首选两款，本轮不把它们声明为已经验证可完整还原。

## 视觉与交互约束

- 视觉方向：Soft Static 保留黑胶的实体感与大幅裁切构图；Prism 保留黑色光学实验台、单一分光主视觉与克制的信息层，不套用全局卡片模板。
- 内容结构：真实曲目、艺术家、专辑及封面，配合播放状态、时间和必要操作；不搬入原站的营销标题、导航和定价入口。
- 样式策略：沿用 React 19、TypeScript、Phosphor 图标和局部 class 命名的普通 CSS；颜色、材质在主题内定义，不污染全局浅色/暗色 token。
- Soft Static 的音符不是歌词。Lark 没有音高转录契约，不伪造当前歌曲的音符；若改为真实歌词或静态装饰，必须作为与原作的明确差异确认，未有歌词时显示真实曲目信息。
- 黑胶纹理优先使用已获许可的原始素材。没有原素材时，只能提供标明差异的自制纹理，不从“相似”推导“100% 一致”。
- Prism 的光束默认是主题视觉，不伪装成实时音频频谱；只有使用真实测量数据时才显示音频分析含义。

### 动效决策

按 emil-design-eng、animate 与 apple-design 的顺序先判断必要性，再选择工具与时长。

- 播放反馈：唱片转动用于状态指示，使用恒速线性旋转，暂停时保持当前角度；不以固定录像循环代替播放状态。
- 高频操作：切歌、键盘操作和 seek 不等待转场，数据与输入即时响应；不让可读歌词沿装饰轨道移动。
- 指针反馈：已有 `--ease-out` token 继续复用；必要的按压反馈采用 100–160ms、约 `scale(0.97)` 的 CSS transition，仅作用于实际按压控件，不添加悬浮漂动。
- 光束切换：用于状态说明，可用 150–250ms opacity/transform transition；不为简单淡入安装动画库，不使用 `transition: all`。
- 拖动只在确有对应功能时实现；使用 Pointer Events、pointer capture 和明确的取消处理，按当前位置连续跟随，不在拖动中加补间延迟。若需要惯性回弹，必须延续释放速度，不能用锁定输入的关键帧序列。
- 减少动态效果时停止转动、倾斜和扫光，保留静态构图及必要状态反馈。低透明度、高对比度偏好提供更实的表面与清晰边缘。
- 离屏、页面隐藏和不播放时不持续运行渲染循环；复用 `animationActivity.ts` 或现有可见性 hook，不另建全局时钟。

## 接入位置与代码风格

- 独立组件及样式：`frontend/src/components/player-themes/`，通过现有 `index.ts` 导出，不重写旧主题。
- 前端注册：`frontend/src/types.ts` 的 `HomePlayerStyle`，`frontend/src/App.tsx` 的 normalizer、首页选择分支和设置入口，`frontend/src/i18n.ts` 的中英文名称与无障碍标签。
- 后端持久化：`backend/internal/library/service.go` 的 `normalizeUserHomePlayerStyle` 白名单及 `settings_test.go`；只更新允许值，不改数据库 schema。
- 暂定 ID：`soft-static`、`prism`。移动端继续使用现有主题；在线电台与网络曲目保留现有可用的控制入口，不被本地 Song 专属主题遮蔽。
- 不新增依赖；原站视频和未经确认许可的美术资源不进入产品包。用户随后明确要求测试通过后发布新版，并指定保留 `0.18.x` 系列，目标为服务端/Web `v0.18.1`；同步版本、双语说明和嵌入资源，检查后提交、推送并发布，独立桌面客户端不变。

遵循现有显式 props、原生控件、禁用语义和命名方式：

```tsx
<button type="button" aria-label={playing ? text.pause : text.play} disabled={!onToggle} onClick={onToggle}>
  {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
</button>
```

## 验收与命令

- 固定曲目、进度、封面、视口和动画时刻，与完整视频的关键帧并排比较构图、比例、材质及运动方向，单列所有已知差异，不以主观“很像”替代对比。
- 两款主题均使用真实播放/暂停、上一首/下一首、播放模式、seek 回调；无曲目、无封面、封面加载失败、无歌词和未知时长仍可理解，无假控件。
- 保持可见的键盘焦点与有名称的按钮；range 支持键盘逐秒 seek，未知时长禁用；指针和触控有效区域至少 44 × 44px，正常文本对比度至少 4.5:1。
- 覆盖快速连续点击、拖动离开控件、取消手势、暂停恢复、切换主题、重新加载后的偏好持久化以及不同用户隔离。
- 浏览器检查 1280px 与 1440px 桌面、紧凑布局和 375px 下的移动端回退；验证中英文、全局浅色/暗色、reduced-motion、高对比度及降低透明度。
- 邻近测试沿用 Node test 与 Go library tests；先验证新组件回调和边界，再跑现有主题回归。不把源码字符串匹配当作唯一行为证据。

实现后的验证命令：

```bash
pnpm --dir frontend dev --host 127.0.0.1
pnpm --dir frontend build
pnpm --dir frontend lint
pnpm --dir frontend test:player-motion
cd backend && go test ./internal/library -run 'Test.*Preferences' -count=1
```

始终保留原有用户偏好与播放器功能；新增依赖、变更移动端范围或将原站美术资源随软件发布必须先确认。

## 已确认的实施边界

1. 接受以视频可见关键帧为基准的高保真适配，不声称严格 100%。
2. 新增 `soft-static` 与 `prism` 桌面主题，本轮不改移动端。
3. Soft Static 使用已有 `activeLyricText` 展示真实歌词，无歌词时显示曲目信息；弧形背景只显示静态元数据，不伪造音高转录。唱片纹理由代码生成，不嵌入原站美术资源。

## 发布约束

- 服务端/Web 发布沿用 `v*` tag，独立桌面安装包沿用 `desktop-v*`，本次不混发。
- 核对现有主分支与远端 SHA，完成测试、独立复核和生成资源检查后再提交并推送，不覆盖已有 tag。
- 等待 CI、五个平台二进制与多架构镜像流水线，检查实际产物后发布 GitHub Release，不把 draft 或运行中的构建称为已发布。
