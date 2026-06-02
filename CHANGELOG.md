# 更新日志 / Changelog

> 中文版在前，英文版在后。
> Chinese first, English follows.

---

## 0.7.20 — 锤子音乐经典主题

发布日期 / Released: 2026-06-02

### 新功能

- **新增锤子音乐经典主题。** 设置色板新增「锤子经典」，PC 端还原 Smartisan Music 的白灰标题栏、分组列表、底部播放栏、红色主操作、蓝色辅助色和旧式按钮凹凸层次。
- **新增移动端锤子播放样式。** 手机端「移动端播放样式」新增「锤子经典」，展开播放器使用 Smartisan Music 经典黑胶 LP、唱针、标题条和红色状态灯资源。

### 资源与致谢

- 主题参考并致谢 [DE105/SmartisanMusic-Revived](https://github.com/DE105/SmartisanMusic-Revived)。引用的 Smartisan Music 视觉资产归各自权利人所有，仅用于学习、研究与保存目的。

完整 diff：`git log v0.7.19..v0.7.20`

---

## v0.7.20 — Smartisan Music classic theme

Released: 2026-06-02

### New

- **Smartisan Music classic theme.** Settings now includes a "Smartisan Classic" swatch. Desktop styling restores the white/gray Smartisan title bar, grouped list surfaces, bottom playback bar, red primary actions, blue secondary accent, and old-style pressed button depth.
- **Smartisan mobile player style.** The mobile player style selector now includes "Smartisan classic"; the expanded mobile player uses classic Smartisan Music LP, stylus, title bar, and red status-light assets.

### Credits

- Theme reference and credit: [DE105/SmartisanMusic-Revived](https://github.com/DE105/SmartisanMusic-Revived). Referenced Smartisan Music visual assets belong to their respective rights holders and are included only for learning, research, and preservation.

Full diff: `git log v0.7.19..v0.7.20`

---

## 0.7.19 — 移动端收尾 + 设置分组

发布日期 / Released: 2026-06-01

### 新功能

- **移动曲库行操作折叠。** 移动端（≤720px）把 4 个次要操作（下一首播放、缓存离线、加入歌单、分享）合并到右侧的「更多」按钮（DotsThree），点击展开 fixed 定位的浮层菜单。心形按钮仍然常驻（最高频操作）。桌面端布局不变。
- **设置分组折叠（SettingsSection）。** 新增 `SettingsSection` 组件，把「历史播放位置」「主页播放样式」「移动端主页播放样式」「艺人/专辑显示样式」4 个卡片改为可点击头部 + 可折叠 body。每个分组默认展开，用户可单独收起。

### 改进

- 移动底部导航激活态：active tab 顶部出现 18×3 px 的强调色胶囊（带 0.28s 缩放淡入动画），叠加在原有填充背景之上。
- 移动顶栏：gap 10→8、内边距 12→8、用户菜单按钮 44→38 px，整体更紧凑。
- HI-FI ORBIT 卡片：标签前加 5 px 强调色圆点（2.2s 呼吸动画），加 135° 渐变光泽和内阴影，层次更立体。

### i18n

- 新增 `more`（zh: 更多 / en: More），用于「更多」按钮的可访问性标签。

完整 diff：`git log v0.7.18..v0.7.19`

---

## v0.7.19 — Mobile follow-ups + settings accordion

Released: 2026-06-01

### New

- **Mobile song row action collapse.** On screens ≤720px, the 4 secondary actions (play next, cache offline, add to playlist, share) are folded into a single "..." (DotsThree) button on the right. Tapping it opens a `position: fixed` popover anchored to the button. The heart button stays visible (most common action). Desktop layout unchanged.
- **Settings accordion.** New `SettingsSection` component: clickable header (title + description + caret) with collapsible body. 4 cards now use it: playback resume, home player style, mobile home player style, artist/album display style. Each section can be independently collapsed/expanded.

### Improvements

- Mobile bottom nav active tab: an 18×3 px accent pill animates in above the active icon (0.28s scale + fade), layered on top of the existing filled background.
- Mobile top bar: gap 10→8, padding-bottom 12→8, user-menu trigger 44→38 px — overall tighter.
- HI-FI ORBIT card: 5 px accent dot before the label pulses (2.2s breath), subtle 135° gradient sheen, inset shadow for depth.

### i18n

- `more` key added (zh: 更多 / en: More) for the new collapse button's aria-label.

Full diff: `git log v0.7.18..v0.7.19`

---

## 0.7.18 — UI/UX 集中打磨

发布日期 / Released: 2026-06-01

### 新功能

- **20 套主题，色板化选择。** 主题入口从原来的下拉框换成「设置 → 站点」里的 20 格色板，每格都是实时预览，深/浅色用小圆点区分，当前主题会显示强调色描边。
- **空状态统一组件。** 新增通用 `EmptyState` 组件，收藏夹等页面统一使用三种风格（default / compact / rich）。
- **专辑 / 歌手页标题。** 详情页顶部加面包屑标题（例如「专辑 / Driftwood」），方便用户确认所在位置。
- **歌词匹配失败兜底。** 在线歌词和歌曲不匹配时，全屏歌词顶部显示「匹配可能不准」徽章。
- **全屏歌词布局优化。** 长歌曲名不再顶到右侧操作按钮。
- **曲库行质量列。** `2024 · MP3 · 44.1kHz` 单元不再被截断，鼠标悬停可见完整 title。

### 改进

- 5 套原创浅色主题（奶白陶瓷 / 燕麦拿铁 / 薄荷苏打 / 樱花宣纸 / 黄昏琥珀）重新调整 `--muted`，正文文字对比度从 3.4:1 提升到 4.5:1 以上。
- 致敬版浅色主题（apple-light / spotify-light / netease-light / winamp-light / foobar-light）同步对齐对比度。
- 主题切换加 0.32s 平滑过渡，shell / 卡片 / 按钮 / 输入框颜色平滑变化。
- 主内容区底部补上播放器高度的间距，最后一行歌曲不再被播放器遮挡。
- 设置 tab 选中态加强调色圆点 + 投影。
- 曲库顶部留白收紧，标题与控件之间更紧凑。
- 桌面端曲库 / 收藏 / 卡片网格的 h2 标题恢复可见。
- 「快速开始」占位文案改为「从这里开始」，避免重复感。

### 修复

- 修复桌面端 `.library-view > .section-head > h2` 被意外 `display:none` 导致标题缺失。
- 修复浅色主题正文/辅色对比度过低（<4.5:1）。
- 修复全屏歌词长标题与操作按钮重叠。
- 修复主题选择器中 inline style 覆盖色板 CSS 选择器。

### 20 套主题清单

- **原创深色 5 套**：深空极夜 / 琥珀胶片 / 霓虹珊瑚 / 冰川极光 / 碳黑燃绿
- **原创浅色 5 套**：奶白陶瓷 / 燕麦拿铁 / 薄荷苏打 / 樱花宣纸 / 黄昏琥珀
- **致敬 10 套**（各深浅一版）：Apple Music / Spotify / 网易云 / Winamp / Foobar2000

完整 diff：`git log v0.7.17..v0.7.18`

---

## v0.7.18 — UI/UX polish pass

Released: 2026-06-01

### New

- **20-swatch theme picker.** The 20-option dropdown is replaced with a 20-swatch color grid in Settings → Site. Each swatch is a live preview, shows a small dot for dark vs. light variants, and gets an accent ring on the active theme.
- **Shared `EmptyState` component.** Favorites and other library surfaces use the new component with three variants (default / compact / rich).
- **Breadcrumb page titles.** Album and artist detail views show a `Album / Driftwood`-style title at the top.
- **Lyrics match guard.** When an online lyrics source loads for a song it doesn't really match, a "Match may be off" badge appears in the full lyrics header.
- **Full lyrics layout fix.** Long song titles no longer overlap the action buttons.
- **Song row quality column.** The `2024 · MP3 · 44.1kHz` cell no longer truncates; quality info also shows on hover via `title`.

### Improvements

- The 5 original light themes (Milk Porcelain / Oat Latte / Mint Soda / Sakura Washi / Dusk Amber) had `--muted` rebalanced to meet 4.5:1 contrast (was ~3.4:1).
- Tribute light themes (apple-light / spotify-light / netease-light / winamp-light / foobar-light) tuned to match.
- Theme switches now have a 0.32s smooth fade across shell / cards / buttons / inputs.
- Main content area now leaves room for the bottom player, so the last row is never hidden.
- Settings tab has a theme-accent dot + glow on the active tab.
- Library top spacing tightened, controls sit closer to the title.
- Desktop section heads (library / favorites / card grid) now show their `h2` again.
- "Quick start" placeholder copy rewritten to "Start here" to feel less generic.

### Fixes

- `.library-view > .section-head > h2` was hidden on `min-width:721px`; restored to `display:block`.
- Light theme body/secondary text contrast was below 4.5:1; fixed across all 10 light themes.
- Full-lyrics long title overlapped the action buttons; resolved via grid layout.
- Theme picker swatch CSS selectors were being overridden by inline `style`; inline style removed.

### Theme inventory (20)

- **5 original dark**: Deep Space Noir, Amber Film, Neon Coral, Arctic Aurora, Carbon Volt
- **5 original light**: Milk Porcelain, Oat Latte, Mint Soda, Sakura Washi, Dusk Amber
- **10 tributes** (each dark + light): Apple Music, Spotify, NetEase, Winamp, Foobar2000

Full diff: `git log v0.7.17..v0.7.18`

---

## Earlier versions / 早期版本

For the full history of changes, see the git log:

```bash
git log --oneline --decorate
```

Earlier versions (`v0.6.x`, `v0.7.0`–`v0.7.17`) included:

- v0.7.17 — 移动曲库管理 + CUE 支持
- v0.7.16 — 字体和原生质感打磨
- v0.6.x — 早期迭代
