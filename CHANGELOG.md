# 更新日志 / Changelog

> 中文版在前，英文版在后。
> Chinese first, English follows.

---

## 0.8.13 — 沉浸式歌词显示

发布日期 / Released: 2026-06-08

### 新功能

- **新增沉浸式歌词显示效果。** 全屏歌词页参考主流歌词应用，当前句清晰突出，上下文歌词以低透明度和虚化退后，背景继续使用封面与主题色承托。
- **新增个人歌词显示选项。** 个人设置中可以在“沉浸景深”和“经典列表”之间切换，偏好按用户保存。
- **保留歌词自由拖动交互。** 关闭“跟随歌词拖动播放”后仍可自由滚动阅读，只能通过居中行右侧按钮从该句播放；沉浸模式也为该按钮保留触控空间。

完整 diff：`git log v0.8.12..v0.8.13`

---

## v0.8.13 — Immersive lyrics display

Released: 2026-06-08

### Features

- **Added an immersive lyrics display.** The fullscreen lyrics view now follows mainstream lyrics-app treatment: the active line is crisp and prominent, surrounding lyrics recede with lower opacity and blur, and the cover/theme backdrop carries the mood.
- **Added a personal lyrics display preference.** Each user can choose between “Immersive depth” and “Classic list” in Profile settings.
- **Preserved free lyrics scrolling.** When “Follow playback while dragging lyrics” is disabled, users can still scroll freely and only the centered-line play button seeks; immersive mode reserves touch space for that button.

Full diff: `git log v0.8.12..v0.8.13`

---

## 0.8.12 — 侧栏选中态流光增强

发布日期 / Released: 2026-06-08

### 修复

- **增强侧栏当前页面动画的可见性。** 将上一版不明显的 1px 渐变位移改成沿主题边框环绕的流光高光。
- **修复移动端仍引用旧动画名的问题。** 底部导航选中态现在和桌面侧栏使用同一套主题流光边框。
- **继续遵循主题色与减少动态效果。** 高光颜色来自主题 token，系统减少动态效果开启时保持静态边框。

完整 diff：`git log v0.8.11..v0.8.12`

---

## v0.8.12 — Stronger sidebar active-state motion

Released: 2026-06-08

### Fixes

- **Made the sidebar active animation visibly perceptible.** The previous subtle 1px gradient shift is replaced with a theme-colored glint that travels around the active border.
- **Fixed the mobile nav override still referencing the old animation name.** Mobile bottom navigation now shares the same themed active-border treatment.
- **Kept theme and reduced-motion support.** The glint uses theme tokens, and reduced-motion mode keeps a static themed border.

Full diff: `git log v0.8.11..v0.8.12`

---

## 0.8.11 — 侧栏选中态动效优化

发布日期 / Released: 2026-06-08

### 优化

- **侧栏当前页面标识升级为流动渐变边框。** 选中态不再使用静态高亮，改为跟随主题色的低强度滚动边框。
- **保持主题色一致性。** 渐变颜色全部来自主题 token，并兼容 `smartisan-classic` 与移动端底部导航。
- **支持减少动态效果。** 系统开启减少动态效果时，选中边框停止动画，保留静态主题边框。

完整 diff：`git log v0.8.10..v0.8.11`

---

## v0.8.11 — Sidebar active-state motion polish

Released: 2026-06-08

### Improvements

- **Upgraded the sidebar active indicator to a flowing gradient border.** The selected page now uses a subtle theme-aware animated border instead of a static highlight.
- **Kept colors aligned with themes.** The gradient is driven by theme tokens and supports `smartisan-classic` plus the mobile bottom nav.
- **Respects reduced motion.** When reduced motion is enabled, the active border stays static while preserving the themed treatment.

Full diff: `git log v0.8.10..v0.8.11`

---

## 0.8.10 — 跨设备继续收听与曲库最新修复

发布日期 / Released: 2026-06-08

### 修复

- **修复跨设备继续收听只剩单曲的问题。** PC B 即使没有开启本机“启动时恢复播放队列”，点击继续收听也会使用 PC A 最近保存的完整播放 session。
- **空闲客户端不再清空服务器队列。** 未开始播放的设备启动时不会因为本机没有 current song 而删除其他设备保存的播放队列。
- **修复 queue/source 同步竞态。** 播放专辑、歌手或歌单时会把完整队列和来源上下文同一拍写入 session，避免后续保存把 source 清掉。
- **修复最近播放污染曲库最新的问题。** 播放状态不再刷新歌曲库存更新时间，曲库列表按入库时间排序，最近播放只进入播放历史。
- **澄清设置文案。** “保留播放队列”改为“启动时恢复播放队列”，明确它只控制本机启动自动恢复，不影响跨设备继续收听。

完整 diff：`git log v0.8.9..v0.8.10`

---

## v0.8.10 — Cross-device continue and library latest fixes

Released: 2026-06-08

### Fixes

- **Fixed cross-device continue restoring only one track.** PC B now uses PC A's latest full playback session when clicking continue, even if local launch-time queue restore is disabled.
- **Stopped idle clients from clearing the server queue.** A device with no current song no longer deletes another device's saved playback queue during startup.
- **Fixed the queue/source sync race.** Album, artist, and playlist playback now saves the full queue and source context in the same action, preventing later saves from clearing the source.
- **Fixed recently played songs leaking into library latest.** Playback state no longer refreshes song inventory timestamps, and the library list sorts by import time while recent playback stays in playback history.
- **Clarified the setting copy.** “Keep playback queue” is now “Restore queue on launch,” making clear that it controls local startup behavior only.

Full diff: `git log v0.8.9..v0.8.10`

---

## 0.8.9 — 播放历史与队列体验重构

发布日期 / Released: 2026-06-07

### 新功能

- **新增播放历史时间线。** 历史页按播放事件展示收听轨迹，支持日历和日期筛选，并适配移动端底部导航。
- **新增播放历史保留天数设置。** 站点设置可以配置历史记录保留天数，`0` 表示永久保留。

### 修复

- **分离曲库与播放行为。** 曲库继续只表达歌曲来源和库存，最近播放不再作为曲库入口的隐式逻辑。
- **统一播放队列与来源 session。** 队列、当前歌曲和专辑/歌手/歌单来源保存到同一个 session，旧 source 记录只用于迁移后删除，避免重启后只剩最近一首。
- **保留真实用户队列。** 重启和从历史续播时优先恢复保存的 `song_ids/current_id`，source 只作为上下文和兜底重建依据。

完整 diff：`git log v0.8.8..v0.8.9`

---

## v0.8.9 — Playback history and queue UX overhaul

Released: 2026-06-07

### Features

- **Added a playback history timeline.** The History view now shows listening events with calendar and date filtering, including mobile bottom-nav support.
- **Added playback history retention settings.** Site settings can retain history for a fixed number of days, with `0` meaning forever.

### Fixes

- **Separated library inventory from playback behavior.** The Library remains source and inventory management; recent plays no longer leak into library behavior.
- **Unified playback queue and source session storage.** Queue, current song, and album/artist/playlist context now share one session; legacy source records are migration-only and then deleted.
- **Preserved the real user queue.** Restart and history resume prefer saved `song_ids/current_id`; source context is only fallback reconstruction.

Full diff: `git log v0.8.8..v0.8.9`

---

## 0.8.7 — 专辑歌手同步修复

发布日期 / Released: 2026-06-06

### 修复

- **修复单艺人专辑的歌曲歌手同步。** 当专辑艺人已经改正确、但专辑内歌曲艺人仍统一停留在错误水印或旧值时，再次写入专辑元信息会同步修正每首歌的 `artist` 标签和歌曲行。
- **允许专辑元信息按当前字段重新写入。** 专辑编辑弹窗在勾选确认后可以重新写入当前专辑字段，用于修复源文件或歌曲行与界面显示不一致的半同步状态。

完整 diff：`git log v0.8.6..v0.8.7`

---

## v0.8.7 — Album artist sync fix

Released: 2026-06-06

### Fixes

- **Fixed song artist sync for single-artist albums.** When the album artist is already correct but every song in the album still has the same wrong watermark or stale artist, writing album metadata now updates each file's `artist` tag and the song rows.
- **Allowed album metadata to be rewritten with current fields.** The album metadata dialog can now write the current album fields after confirmation, which repairs half-synced source files or song rows.

Full diff: `git log v0.8.6..v0.8.7`

---

## 0.8.6 — 移动端播放体验与元信息写回修复

发布日期 / Released: 2026-06-06

### 新功能

- **重做移动端首页与播放界面。** 移动端新增更精致的迷你播放器、展开播放页、音效面板和首页信息层级，吸收桌面首页播放器的视觉效果，同时保留桌面端现有布局。

### 修复

- **修复专辑元信息写回。** 在专辑页编辑专辑名、专辑歌手、年份等信息时，会同步写回对应歌曲文件和歌曲记录，和单曲元信息编辑保持一致。
- **增强 WAV 元信息写回可靠性。** WAV `LIST/INFO` 写回改为流式重写，避免大文件整文件读入，并修复 chunk 解析和短写边界处理。

完整 diff：`git log v0.8.5..v0.8.6`

---

## v0.8.6 — Mobile playback polish and metadata writeback fixes

Released: 2026-06-06

### Features

- **Redesigned the mobile home and playback experience.** Mobile now has a more polished mini player, expanded now-playing view, sound panel, and home hierarchy, borrowing the desktop home player treatment while preserving the existing desktop layout.

### Fixes

- **Fixed album metadata writeback.** Editing album title, album artist, year, and related fields from the album page now writes the changes back to the matching audio files and song records, matching single-track metadata editing.
- **Hardened WAV metadata writeback.** WAV `LIST/INFO` updates now rewrite files as a stream instead of reading the full file into memory, with safer chunk parsing and short-write handling.

Full diff: `git log v0.8.5..v0.8.6`

---

## 0.8.5 — 后端并发与预热修复

发布日期 / Released: 2026-06-06

### 修复

- **限制曲库监听导入并发。** 文件监听事件改为固定 worker 队列处理，避免大量文件写入时无限创建导入 goroutine，并在停止监听时通过 context 取消后台导入。
- **修复转码预热生命周期。** 转码预热 reservation 与 shutdown 等待绑定，完成后释放 warm lease，避免同一路径预热被旧 lease 阻塞。
- **修复内存 KV 关闭竞态。** `MemoryStore.Close` 改为并发安全，重复或并发关闭不会触发关闭已关闭 channel 的 panic。

### 维护

- **减少在线 provider 热路径分配。** HTML 清理和年份解析复用包级正则，Kuwo 歌词格式化直接写入 builder。

完整 diff：`git log v0.8.4..v0.8.5`

---

## v0.8.5 — Backend concurrency and warmup fixes

Released: 2026-06-06

### Fixes

- **Bounded library watcher imports.** File watcher events now flow through a fixed worker queue, avoiding unbounded import goroutines during large writes and canceling background imports when watchers stop.
- **Fixed transcode warmup lifecycle.** Transcode warmup reservations are tied to shutdown waiting and release the warm lease on completion, preventing stale leases from blocking later warmups for the same path.
- **Fixed memory KV close races.** `MemoryStore.Close` is now concurrent-safe, so repeated or concurrent closes cannot panic by closing an already closed channel.

### Maintenance

- **Reduced online provider hot-path allocations.** HTML cleanup and year parsing reuse package-level regexps, and Kuwo lyric formatting writes directly to the builder.

Full diff: `git log v0.8.4..v0.8.5`

---

## 0.8.4 — 歌词拖动播放跟随开关

发布日期 / Released: 2026-06-05

### 新功能

- **新增个人歌词拖动播放跟随开关。** 用户可以在个人设置中关闭“跟随歌词拖动播放”，关闭后滚动歌词只用于阅读，不会自动调整播放进度，并可通过当前居中行右侧按钮从该句播放；开启后保持原来的拖动即跳转交互且隐藏该按钮。

### 修复

- **避免关闭开关后残留滚动定时器触发跳转。** 切换为自由阅读模式时会清理待执行的歌词 seek，歌词高亮保持原有行为，歌词行本身不会触发跳转。

完整 diff：`git log v0.8.3..v0.8.4`

---

## v0.8.4 — Lyric drag playback-follow toggle

Released: 2026-06-05

### Features

- **Added a personal lyric drag playback-follow toggle.** Users can turn off lyric drag seeking in profile settings so scrolling lyrics is only for reading and does not change playback progress, then use the centered-line play button to start from that line; turning it on keeps the previous drag-to-seek behavior and hides that button.

### Fixes

- **Prevented pending lyric scroll timers from seeking after the toggle is disabled.** Switching to free-reading mode clears any queued lyric seek while keeping lyric highlighting intact; lyric lines no longer seek unless the dedicated play button is clicked.

Full diff: `git log v0.8.3..v0.8.4`

---

## 0.8.3 — 曲库与专辑筛选区避让修复

发布日期 / Released: 2026-06-05

### 修复

- **修复用户菜单展开时遮挡曲库/专辑控件。** 曲库操作区、专辑歌手筛选和艺术家首字母筛选改为标题下方左对齐，避免落在右上角用户菜单浮层正下方。

完整 diff：`git log v0.8.2..v0.8.3`

---

## v0.8.3 — Library and album filter overlap fix

Released: 2026-06-05

### Fixes

- **Fixed the user menu covering library and album controls.** Library actions, album artist filtering, and artist initial filtering now align below the title on the left instead of sitting under the top-right user menu popover.

Full diff: `git log v0.8.2..v0.8.3`

---

## 0.8.2 — 曲库与专辑界面布局修复

发布日期 / Released: 2026-06-05

### 修复

- **修复曲库和专辑页面顶部区域挤压错位。** 顶栏搜索、离线状态和用户菜单现在使用稳定列布局，中等宽度下曲库操作区和专辑筛选器会主动换行。
- **修复移动端用户菜单触控区偏小。** 头像入口恢复到 44px 以上，搜索建议项也保持可点击高度，降低误触概率。

### 维护

- **分批拆分 `App.tsx`。** 抽出卡片网格、分页、用户菜单、鉴权页、播放列表弹窗、元数据编辑器和通用工具函数，降低后续维护风险。

完整 diff：`git log v0.8.1..v0.8.2`

---

## v0.8.2 — Library and album layout fixes

Released: 2026-06-05

### Fixes

- **Fixed cramped top areas on library and album views.** Topbar search, offline status, and user menu now use stable columns, while library actions and album filters wrap on medium-width screens.
- **Fixed undersized mobile user menu hit target.** The avatar trigger is back above 44px, and search suggestion rows keep a tappable height.

### Maintenance

- **Split `App.tsx` in batches.** Extracted card grids, pagination, user menu, auth view, playlist dialogs, metadata editor, and shared utility helpers to reduce maintenance risk.

Full diff: `git log v0.8.1..v0.8.2`

---

## 0.8.0 — 元信息编辑器可用性增强

发布日期 / Released: 2026-06-03

### 新功能

- **新增从文件路径解析元信息候选。** 单曲和专辑元信息编辑器会优先给出本地路径解析候选，适合现有音频标签已经错误、线上匹配关键词不可靠的场景。

### 修复

- **修复专辑元信息编辑难以手动输入。** 编辑器现在显式聚焦第一个可编辑字段，并约束上传封面控件的点击区域，避免透明文件输入影响其它字段。
- **替换元信息写入浏览器确认弹窗。** 二次确认改为应用内浮动弹窗，移动端使用底部 sheet，并支持键盘取消和焦点循环。
- **修正音轨号文件名解析。** `01 - 歌名` 这类路径不再把 `01` 误当作歌手，专辑候选也能从多碟目录推断专辑名和专辑艺人。

完整 diff：`git log v0.7.29..v0.8.0`

---

## v0.8.0 — Metadata editor usability improvements

Released: 2026-06-03

### Features

- **Added file-path metadata candidates.** Song and album metadata editors now surface local path-derived candidates first, useful when existing audio tags are wrong and online matching starts from unreliable keywords.

### Fixes

- **Fixed album metadata fields being hard to edit manually.** The editor now focuses the first editable field and confines the cover upload hit area so the transparent file input cannot interfere with other fields.
- **Replaced browser writeback confirmation.** The final confirmation now uses an in-app floating dialog, with a mobile bottom sheet plus keyboard cancel and focus cycling.
- **Fixed track-number filename parsing.** Paths like `01 - Title` no longer treat `01` as the artist, and album candidates can infer album title and album artist from multi-disc folders.

Full diff: `git log v0.7.29..v0.8.0`

---

## 0.7.29 — 移动端弹窗体验修复

发布日期 / Released: 2026-06-03

### 修复

- **修复歌词页元信息编辑弹窗移动端闪烁。** 编辑器改为头部、内容滚动区、底部操作三段式布局，并取消打开时自动聚焦输入框，避免软键盘触发布局反复重算。
- **修复元信息编辑底部操作不可达。** 候选和结果列表在移动端不再嵌套抢滚动，确认与写入按钮固定在弹窗底部区域。
- **优化定时关闭弹窗适配。** 桌面端改为紧凑双列布局，移动端改为底部 sheet，内容区单独滚动并保留安全区。
- **补齐移动播放器定时入口。** 移动端自定义播放器操作区新增定时关闭按钮，和桌面控制栏共享同一套定时状态。

完整 diff：`git log v0.7.28..v0.7.29`

---

## v0.7.29 — Mobile dialog UX fixes

Released: 2026-06-03

### Fixes

- **Fixed metadata editor flicker on mobile lyrics view.** The editor now uses fixed header, scrollable body, and fixed action rows, and no longer auto-focuses the title field on open.
- **Fixed unreachable metadata editor actions.** Candidate and result lists no longer compete for nested scrolling on mobile, keeping confirmation and writeback actions reachable.
- **Improved sleep timer dialog responsiveness.** Desktop now uses a compact two-column layout, while mobile uses a safe-area-aware bottom sheet with a dedicated scroll body.
- **Added the sleep timer entry to mobile player themes.** The custom mobile player action row now exposes the same sleep timer state as the desktop control bar.

Full diff: `git log v0.7.28..v0.7.29`

---

## 0.7.27 — 源文件元信息回写编辑器

发布日期 / Released: 2026-06-03

### 新功能

- **新增单曲/专辑元信息编辑器。** 歌词页可编辑单曲标题、歌手、专辑、年份和封面；专辑页可批量编辑专辑名、专辑艺人、年份和封面。
- **支持直接回写源音频文件。** 新增基于 `go.senan.xyz/taglib` 的 MP3/FLAC/M4A/OGG/WAV 等 Tag/封面回写；WAV 文本字段继续沿用内置 RIFF INFO 写入逻辑。
- **支持在线候选和手动输入。** 单曲使用在线歌曲候选，专辑使用在线专辑候选；用户也可以完全手动输入字段和封面 URL/上传封面。

### 体验与安全

- **增加二次确认。** 写入前必须勾选“确认修改源文件”，点击保存后还会再次弹出最终确认。
- **写入结果逐文件反馈。** 保存后展示已写入、跳过、失败的文件明细；CUE 虚拟曲目按真实音频文件去重写入。
- **封面缓存即时刷新。** 写入封面后返回 cover version，前端自动绕过旧封面缓存。

完整 diff：`git log v0.7.26..v0.7.27`

---

## v0.7.27 — Source metadata writeback editor

Released: 2026-06-03

### Features

- **Added song and album metadata editors.** The lyrics view can edit song title, artist, album, year, and cover; the album page can batch-edit album title, album artist, year, and cover.
- **Writes directly to source audio files.** Added `go.senan.xyz/taglib`-based tag/artwork writeback for MP3, FLAC, M4A, OGG, WAV, and related formats; WAV text fields keep using Lark's built-in RIFF INFO writer.
- **Supports candidates and manual entry.** Songs use online song candidates, albums use online album candidates, and users can still enter fields, cover URLs, or uploaded covers manually.

### UX and safety

- **Added two-step confirmation.** Users must explicitly confirm source-file modification, then accept a final confirmation before writing.
- **Shows per-file results.** The result list reports updated, skipped, and failed files; CUE virtual tracks are deduplicated by their real audio file.
- **Refreshes cover cache immediately.** Cover writeback returns a cover version so the frontend bypasses stale cached artwork.

Full diff: `git log v0.7.26..v0.7.27`

---

## 0.7.26 — CUE 异常格式兼容修复

发布日期 / Released: 2026-06-03

### 修复

- **修复无音频轨 CUE 导致扫描报黄。** `TRACK ... MODE1/2352` 等非音频 CUE 现在会被静默跳过，不再报告 `cue sheet has no audio tracks`。
- **避免坏 CUE 拦截真实整轨音频。** 没有 `TRACK ... AUDIO` 的 CUE 不再把 `FILE` 指向的音频标记为已由 CUE 接管，真实的 `CDImage.ape/flac/wav` 会继续按普通音频扫描。
- **兼容 CUE 中的 Unicode 空白。** CUE 分词现在使用 Unicode 空白识别，能处理全角空格、NBSP 等异常空白字符。

完整 diff：`git log v0.7.25..v0.7.26`

---

## v0.7.26 — CUE malformed format compatibility

Released: 2026-06-03

### Fixes

- **Fixed scan warnings from CUE files without audio tracks.** Non-audio CUE sheets such as `TRACK ... MODE1/2352` are now skipped quietly instead of reporting `cue sheet has no audio tracks`.
- **Prevented malformed CUE sheets from blocking real image audio.** CUE files without `TRACK ... AUDIO` no longer mark their `FILE` targets as CUE-managed, so real `CDImage.ape/flac/wav` files continue to scan normally.
- **Accepted Unicode whitespace in CUE sheets.** CUE tokenization now recognizes Unicode whitespace, including full-width spaces and NBSP.

Full diff: `git log v0.7.25..v0.7.26`

---

## 0.7.25 — 歌手首字母检索与封面兜底

发布日期 / Released: 2026-06-03

### 新功能

- **新增歌手名称归一与首字母检索。** 扫描与启动时会归并 `2.周杰伦`、`12.周杰伦`、`蔡依林_周杰伦` 等异常歌手名，并为歌手记录保存拼音/字母首字母。
- **新增歌手列表首字母筛选。** 歌手页现在支持 A-Z/# 检索；可点击字母来自全曲库歌手 initials，不受当前分页影响。

### 修复

- **修复缺封面导致播放器黑图。** 歌曲、专辑、歌手和公开分享封面缺失时，Web API 返回静态唱片兜底图，不再让播放控制栏收到 404。
- **补齐播放器主题封面失败兜底。** PC 和移动端播放器主题在封面图片加载失败时会回退到唱片/主题占位，避免锤子唱机、移动播放器和控制栏出现空图。

完整 diff：`git log v0.7.24..v0.7.25`

---

## v0.7.25 — Artist initials search + cover fallback

Released: 2026-06-03

### Features

- **Added artist-name normalization and initials indexing.** Startup and scans merge abnormal artist names such as `2.周杰伦`, `12.周杰伦`, and `蔡依林_周杰伦`, and persist pinyin/letter initials on artist records.
- **Added artist initials filtering.** The artist page now supports A-Z/# filtering; enabled initials are computed from the full library independently from the current page.

### Fixes

- **Fixed missing covers leaving player artwork blank.** Song, album, artist, and public-share cover APIs now return a static record fallback when no real cover exists instead of returning 404 to the web player.
- **Completed player-theme image fallbacks.** Desktop and mobile player themes now fall back to record/theme placeholders when artwork image loading fails, covering Smartisan decks, mobile players, and control-bar artwork.

Full diff: `git log v0.7.24..v0.7.25`

---

## 0.7.24 — 曲库缓存与模块拆分优化

发布日期 / Released: 2026-06-03

### 新功能

- **新增 DDIA 风格曲库缓存优化。** 歌曲、专辑、歌手、歌单和每日推荐的热路径现在复用结构化缓存、计数缓存和 singleflight 去重，降低 9000+ FLAC 曲库下的歌手专辑/曲目加载超时风险。
- **拆分后端曲库服务模块。** 原先超大的 `service.go` 拆分为缓存、目录、封面、文件夹、歌词、元数据、播放、扫描、设置和用户状态等模块，保留原有公共 API。

### 改进

- **前端应用类型与工具函数拆分。** `App.tsx` 的视图类型、常量和通用工具提取到独立文件，降低主组件维护成本。
- **SQLite 与缓存运行参数更稳健。** SQLite 连接池默认收敛为较保守配置，并提供 `LARK_SQLITE_MAX_OPEN_CONNS` / `LARK_SQLITE_MAX_IDLE_CONNS` 给低内存设备调节。

### 修复

- **保持缓存命中后的播放状态新鲜。** 缓存的歌曲列表只保存稳定曲库结构，每次读取重新叠加收藏、播放次数、最近播放和续播位置，避免 `MarkPlayed`/播放进度不触发大范围缓存失效时返回旧用户态。
- **修复 Needs lyrics 判断。** 智能歌单现在使用 `has_lyrics` 元数据字段判断缺歌词状态，避免把已检测到内嵌歌词但正文延迟加载的歌曲误判为缺歌词。
- **避免分层刷新旧请求覆盖新状态。** 前端 `refreshAll` 在每层请求返回后检查 generation，减少 80ms/300ms 分层加载带来的 stale UI 写回。

完整 diff：`git log v0.7.23..v0.7.24`

---

## v0.7.24 — Library cache optimization + module split

Released: 2026-06-03

### Features

- **Added DDIA-style library cache optimization.** Hot song, album, artist, playlist, and daily-mix paths now reuse structural caches, count caches, and singleflight deduplication to reduce artist album/song load timeouts on 9000+ FLAC libraries.
- **Split the backend library service modules.** The formerly large `service.go` is split into cache, catalog, cover, folder, lyrics, metadata, playback, scan, settings, and user-state modules while preserving the public API.

### Improvements

- **Extracted frontend app types and helpers.** `App.tsx` view types, constants, and common utilities now live in focused files to reduce main-component maintenance cost.
- **Made SQLite and cache runtime tuning safer.** SQLite pool defaults are more conservative and can be tuned with `LARK_SQLITE_MAX_OPEN_CONNS` / `LARK_SQLITE_MAX_IDLE_CONNS` on low-memory devices.

### Fixes

- **Keep playback state fresh after cache hits.** Cached song lists store stable library structure only; every read overlays favorites, play counts, last played, and resume position so playback writes do not need broad cache invalidation.
- **Fixed Needs lyrics classification.** The smart playlist now uses `has_lyrics` metadata instead of the lazily populated lyrics text column.
- **Prevent stale layered refresh writes.** Frontend `refreshAll` checks its generation after each layer returns, reducing stale UI writes from the 80ms/300ms staggered load.

Full diff: `git log v0.7.23..v0.7.24`

---

## 0.7.23 — 锤子移动端导航与深色唱机修复

发布日期 / Released: 2026-06-02

### 改进

- **优化 PC 锤子唱机唱针对齐。** 桌面端「锤子唱机」的唱针轴心现在按参考项目原始比例对齐右侧标题栏按钮中心，播放进度扫动时不再显得偏离右侧控制位。
- **适配深色主题下的锤子唱机。** 当站点使用深色主题、首页播放器选择「锤子唱机」时，唱机面板、标题栏、文字、进度条和模式按钮会切换到暗色 Smartisan 风格，不再出现突兀的全白播放器。

### 修复

- **移除移动端锤子首页重复导航。** 移动端「锤子经典」首页不再渲染顶部「为你推荐 / 曲库 / 收藏 / 歌单」内部 tabs，避免与底部主导航重复；其它移动端播放器主题保持原有首页 tabs。
- **修复移动端播放器右上空按钮。** 展开播放器标题栏右侧的布局占位不再复用按钮样式，保持居中布局但不可见、不可点击。

完整 diff：`git log v0.7.22..v0.7.23`

---

## v0.7.23 — Smartisan mobile nav + dark deck fixes

Released: 2026-06-02

### Improvements

- **Improved desktop Smartisan stylus alignment.** The Smartisan deck stylus pivot now follows the reference geometry and aligns with the right titlebar button center, so progress-driven movement no longer feels offset from the right-side control anchor.
- **Dark theme support for the Smartisan deck.** When a dark site theme is paired with the Smartisan deck home player, the deck panel, titlebar, text, progress rail, and mode button switch to a dark Smartisan treatment instead of a stark white surface.

### Fixes

- **Removed duplicate Smartisan mobile home navigation.** The mobile Smartisan classic home surface no longer renders the top "For You / Library / Favorites / Playlists" tabs, avoiding duplication with the bottom primary nav. Other mobile player themes keep their home tabs.
- **Fixed the empty top-right mobile player button.** The expanded player titlebar spacer no longer reuses button styling; it remains invisible and non-interactive while preserving centered title layout.

Full diff: `git log v0.7.22..v0.7.23`

---

## 0.7.22 — 锤子唱针动画与歌词背景修复

发布日期 / Released: 2026-06-02

### 改进

- **锤子唱机唱针跟随播放进度。** PC「锤子唱机」和移动端「锤子经典」播放器的唱针现在会在播放时进入唱片并随播放进度扫动；停止或无有效时长时，唱针回到唱片外侧。

### 修复

- **修复深色站点主题 + 锤子唱机的可读性。** 当站点使用 Spotify 等深色主题、首页播放器使用「锤子唱机」时，hero 文字、歌手/专辑链接和播放按钮改为锤子浅色唱机适配的黑/红配色，不再落在浅色唱机背景上发白。
- **修复 PC 和移动端小封面显示。** 底部播放栏、移动端收起播放器和移动首页卡片的小封面改为真实图片层渲染，避免被主题背景层覆盖成黑块或兜底纹理。
- **移除歌词页背景里的装饰播放器。** 全屏歌词页不再渲染模糊的装饰唱机，但仍保留当前唱片封面作为歌词背景。

完整 diff：`git log v0.7.21..v0.7.22`

---

## v0.7.22 — Smartisan needle motion + lyrics backdrop fixes

Released: 2026-06-02

### Improvements

- **Smartisan needle follows playback progress.** The desktop Smartisan deck and mobile Smartisan classic player now move the stylus onto the record while playing and sweep it with playback progress. When stopped or without a valid duration, the stylus parks outside the record.

### Fixes

- **Dark site theme + Smartisan deck readability.** When a dark site theme such as Spotify is paired with the Smartisan deck home player, hero text, artist/album links, and the play button now use readable Smartisan black/red treatment on the light deck background.
- **PC and mobile mini cover rendering.** Bottom player, mobile mini player, and mobile home cards now render cover art as an image layer so theme background rules cannot cover it with a black square or fallback texture.
- **Lyrics backdrop cleanup.** Fullscreen lyrics no longer renders the blurred decorative player, while keeping the current album cover as the lyrics backdrop.

Full diff: `git log v0.7.21..v0.7.22`

---

## 0.7.21 — 锤子唱机与移动端宽度修复

发布日期 / Released: 2026-06-02

### 新功能

- **新增 PC 端锤子唱机播放样式。** 「首页播放器样式」新增「锤子唱机」，使用 Smartisan Music 参考项目的 LP、唱片中心叠层、唱针、播放按钮和进度滑块资源，独立于移动端播放样式设置。

### 修复

- **修复移动端锤子主题首页宽度。** 锤子移动端首页 tab 现在固定为原版 titlebar 分栏，不再被通用移动端滚动胶囊样式覆盖，并补齐内容区左右内边距，避免横向溢出。
- **兼容旧锤子播放器配置。** 历史存储的 `smartisan` / `smartisan-classic` PC 播放器值会映射到新的「锤子唱机」样式。

完整 diff：`git log v0.7.20..v0.7.21`

---

## v0.7.21 — Smartisan deck + mobile width fix

Released: 2026-06-02

### New

- **Desktop Smartisan deck player style.** The desktop home player selector now includes "Smartisan deck", using LP, center-label overlay, stylus, playback button, and seek-thumb assets from the Smartisan Music reference project. This remains separate from the mobile player style setting.

### Fixes

- **Smartisan mobile home width.** Smartisan mobile tabs now stay as a fixed titlebar-style grid instead of being overridden by generic scroll-pill tab rules, with corrected content padding to avoid horizontal overflow.
- **Legacy Smartisan player value compatibility.** Stored desktop player values `smartisan` and `smartisan-classic` now resolve to the new Smartisan deck style.

Full diff: `git log v0.7.20..v0.7.21`

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
