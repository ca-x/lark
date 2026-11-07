# MyGo Plugin Compatibility Implementation Plan

**状态：已被后续架构重设计草案取代，不按本文执行。** 用户追加 GitHub topic 发现、
双生态开关、MoeJS 与 Songloft 兼容回退要求后，原 ZIP-only / 共用 QuickJS 路线
不再适用。新规格见 `docs/superpowers/specs/2026-11-07-plugin-platform-redesign.md`。
原型代码与试加依赖已撤回；当前仅保留文档，未提交、未发布。

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans for native execution, or subagent-driven-development only if the user selects delegated execution. Steps use checkbox syntax for tracking.

**Goal:** 保留 SongLoft 插件，新增可实际配置、浏览、搜索、播放和收藏的 MyGo streaming 音源，并测试发布服务端补丁版本。

**Architecture:** 独立 `internal/mygo` 适配层管理安装、模块编译、运行、音源调用和用户状态；不改变 SongLoft manifest、权限或宿主身份。复用现有 QuickJS 引擎，但网络/bridge 策略按环境注入；MyGo 的 VM、Cookie、setting、storage 均按 `(userID, pluginID)` 隔离。外部歌曲不导入全站共享 Song 表，通过独立播放适配和用户私有队列状态接入现有播放器。

**Tech Stack:** Go 1.27 / Echo / Ent / existing QuickJS; React / TypeScript; proposed new Go dependency `github.com/evanw/esbuild/pkg/api` for JS/TS modules.

**Spec:** `docs/superpowers/specs/2026-11-07-mygo-plugin-compatibility.md`.

## Global Constraints

- 现有插件不迁移、不重新安装、不改 ID；两套协议明确区分。
- 首期以 `playback: stream` 的音源为目标；沿用 Lark 播放器、队列和主题。
- 服务端继续发布 `0.18.x`，不顺带发布桌面安装包。
- 仅 ZIP 安装；不顺带承诺 GitHub 插件市场、仓库安装或自动更新。
- 不新增数据库表；用现有 AppSetting KV 保存受控元数据与用户状态，私有文件放数据目录，禁止公共静态路由访问。
- 新增 esbuild Go 依赖需用户确认；固定实施时核验的稳定版本，不增加 Node/Bun 服务器运行前提。
- 不更改 logo、主题、旧插件市场、依赖这些功能之外的后端 schema。
- 不支持的原生能力返回稳定 `unsupported` 错误；`playback: remote` 不允许启用。
- 所有版本号与发布标签在发布前重新查询，不能假定 `v0.18.12` 仍空闲。

## Review Focus

1. 两个用户安装同一音源但使用不同账户：JS 全局变量、storage、Cookie、队列和认证媒体 URL 都不能串号。Task 2/4/5 测试。
2. 网络通配符、重定向和 DNS rebinding：声明域名不等于可访问内网，凭据不能随跨源重定向泄露。Task 3/5 测试。
3. 外部 ID 与本地整数 ID、不同音源 ID 相撞：不能误播放、误收藏、污染全站曲库或混入另一用户恢复的队列。Task 4/6 测试。
4. 切换音源、保存配置或禁用插件时旧请求返回：不能覆盖新页、复活旧会话或继续访问被禁用的媒体。Task 2/4/6 测试。
5. ZIP 合法但模块依赖越界/顶层 await 失败/异步任务卡住：安装预检、运行超时、取消及资源清理必须有效。Task 1/3 测试。

---

### Task 1: Manifest、ZIP 与真实模块编译

**Files:** Create `backend/internal/mygo/{manifest,package,compile}.go` and corresponding `_test.go`; Modify `backend/go.mod`, `backend/go.sum` only after dependency approval.

**Interfaces:** `ParseManifest(data []byte) (Manifest, error)`; `InspectPackage(ctx context.Context, archive []byte) (PackagePreview, error)`; `CompileModule(root string, manifest Manifest) (CompiledModule, error)`. Preview contains name/version/ID/settings/navigation/network/process/limitations and archive SHA256; compiled module contains bundled JS plus export metadata.

- [ ] Write failing tests for official demo manifest; absent optional main default; JS/TS + local imports; duplicate IDs; object permissions; process boolean/list; navigation/settings; malformed headers; ZIP path traversal, symlinks, duplicate paths, single-folder archive and decompression limits.
- [ ] Run `cd backend && go test ./internal/mygo -run 'TestManifest|TestPackage|TestCompile'` and confirm the new contract is not yet implemented.
- [ ] Implement manifest validation and ZIP preflight with the existing 50 MiB archive / 20 MiB per-file / 100 MiB extracted / 2048-entry limits; never execute code during permission preview.
- [ ] Use esbuild Go API with an in-memory entry importing the actual module, safe on-resolve/on-load containment, no external bare/remote/absolute dependencies, no tsconfig traversal or package install hooks. Bundle as ESM and capture exports without regex rewriting; preserve supported top-level await.
- [ ] Reject unsupported source/resource imports and malicious paths with actionable errors; do not execute or honor `.jsc` bytecode from another ecosystem.
- [ ] Re-run focused tests; stage this task for the final reviewed feature commit, not an unsolicited partial release.

### Task 2: 安装、持久化与按用户隔离的生命周期

**Files:** Create `backend/internal/mygo/{manager,repository,state}.go` and corresponding `_test.go`; consume Task 1 types.

**Interfaces:** `Manager.Preview(ctx, archive)`; `Manager.Install(ctx, archive, expectedSHA256)`; `Manager.List(ctx, userID)`; `Manager.Enable/Disable/Delete(ctx, pluginID)`; `Manager.Settings(ctx, userID, pluginID)`; `Manager.SaveSettings(ctx, userID, pluginID, settings)`; `Manager.Close()`. Concrete arguments/results use typed structs, not unbounded `any`.

- [ ] Write failing tests for two users' settings/storage isolation, conflicting IDs, restart persistence, mismatched confirmation digest, disabled access, delete/update concurrency and cancellation.
- [ ] Store global plugin metadata separately from `userID`-scoped state in existing AppSetting KV; validate positive authenticated user IDs; quota each plugin/user at 10 MiB and each value at 1 MiB.
- [ ] Atomically install below a new MyGo-only data root, with manifest-derived IDs never used as unchecked paths. Confirm preview digest before install; do not reuse or overwrite SongLoft IDs/directories.
- [ ] Key running sessions by `(userID, pluginID)` with per-session serialization, bounded idle sessions, cancellation and explicit invalidation on settings change/disable/delete. Never fall back to the administrator's identity.
- [ ] Run `cd backend && go test ./internal/mygo -run 'TestManager|TestState|TestLifecycle'` and race-test focused lifecycle/state code.

### Task 3: QuickJS 模块、host 契约与受控网络

**Files:** Create `backend/internal/mygo/{runtime,host,network,bootstrap}.go` and tests; Modify `backend/internal/jsruntime/runtime.go`, add `backend/internal/jsruntime/environment_options_test.go`.

**Interfaces:** `Runtime.Call(ctx context.Context, method string, params json.RawMessage) (json.RawMessage, error)`; typed `CallError` with code/message; a backward-compatible `CreateEnvWithOptions` for MyGo-specific evaluation mode and restricted host/network policy. Existing `CreateEnv` keeps its original behavior.

- [ ] Write failing tests for synchronous and Promise exports, local module imports, top-level await, `host.storage/get/set/remove`, setting/defaults, language/locales, MD5/AES helpers and structured plugin errors.
- [ ] Add environment-local policy at actual Go network entry points, not only a replaceable JS `fetch` wrapper; cover any alternate WebSocket/bridge fetch entry so MyGo cannot bypass restrictions.
- [ ] Implement DNS-pinned HTTP(S) allow-listing with domain/wildcard checks on every redirect and reject private, loopback, link-local, unspecified and multicast IPs. Production uses hardened transport; tests inject an explicit fake transport rather than relaxing production policy.
- [ ] Support request cancellation and a 30-second ordinary call limit; bound response bodies, VM memory/stack and pending sessions; stop timers/network work when destroying a VM.
- [ ] Implement browser-appropriate sign-in prompts via owner-bound jobs; reject native webSignIn, spawn, loopback listeners and remote playback with `unsupported`, not missing function TypeErrors.
- [ ] Run `cd backend && go test ./internal/mygo ./internal/jsruntime` and targeted DNS/redirect/bypass/timeout/cleanup regression tests.

### Task 4: 音源契约、歌词与私有外部队列

**Files:** Create `backend/internal/mygo/{source,music,lyrics,queue}.go` and tests; consume Task 2/3 interfaces.

**Interfaces:** typed `Track`, `Browse`, `Playlist`, `SearchResult`, `Stream`, `Lyrics`, `SourceRef{PluginID, TrackID}` and `Queue{Tracks, CurrentRef}`; manager source methods take `ctx, userID, pluginID` before operation parameters. `Manager.SaveQueue/Queue` persist only the current user's validated references and non-sensitive metadata.

- [ ] Use the official demo for home/browse/search offset, albums/artists/playlists, account status, settings, liked/isLiked/like, playlist CRUD/track reordering, lyrics and stream behavior.
- [ ] Enumerate actual exports; return only supported actions to the UI. Limit method dispatch to known source methods and validate parameter shapes rather than exposing arbitrary JS evaluation.
- [ ] Stamp source identity on every nested track; convert milliseconds exactly once at the player boundary; keep external opaque IDs separate from Lark song/album/artist IDs.
- [ ] Convert LRC/translation and representable timed words to Lark lyric DTOs; test missing lyrics, malformed timestamps and documented fallback.
- [ ] Persist source-only queue under user-scoped keys without adding rows to shared Song/Playlist tables. Do not serialize resolved media URLs, cookies or credentials. Reject client-supplied cross-user state and unavailable references.
- [ ] Run `cd backend && go test ./internal/mygo -run 'TestSource|TestLyrics|TestQueue|TestDemo'` with controlled network data; test duplicate external IDs across two plugins and two users.

### Task 5: 管理、用户音源 API 与媒体代理

**Files:** Create `backend/internal/api/{mygo_routes,mygo_media}.go` and tests; Modify `backend/internal/api/server.go` and server startup wiring where existing plugin options are constructed.

**Interfaces:** Admin `/api/mygo/plugins/{preview,install}` and plugin enable/disable/delete; authenticated `/api/mygo/sources`, source details/settings/calls, sign-in jobs, queue, stream and artwork. Media routes accept source references or owner-bound opaque handles, never arbitrary proxy URLs or user IDs from the client.

- [ ] Write failing API tests for administrator-only management, regular-user source access, anonymous denial, cross-user handle/job rejection and access revoked immediately on disable.
- [ ] Enforce method allow-lists, bounded JSON/upload data and current authenticated user at every source/media/job request; lifecycle-close the manager on server shutdown.
- [ ] Resolve `stream` server-side; apply network policy and `requestHeaders` scoped to host/resource/current user. Keep cookies/header values out of JSON lists, logs and URLs.
- [ ] Proxy GET/HEAD, Content-Type, Content-Length, Range/206/416 and cancellation without caching credentialed media across users. Strip sensitive/plugin headers on cross-origin redirects; never redirect browser requests to upstream authenticated URLs.
- [ ] Run `cd backend && go test ./internal/api ./internal/mygo` including full-body/range comparisons against a deterministic test upstream and a forged-media-handle test.

### Task 6: 插件设置与音源浏览界面

**Files:** Create `frontend/src/features/mygo/{types,api,useMygoSource}.ts`, `frontend/src/components/mygo/{MygoPluginSettings,MygoSourcePanel}.tsx`, scoped CSS and behavioral tests; Modify `frontend/src/components/PluginSettings.tsx`, user-accessible navigation/settings integration in `frontend/src/App.tsx`, and i18n files found alongside existing plugin strings.

**Interfaces:** source panel receives authenticated API and typed `onPlay(tracks, startIndex)` / `onAddToQueue(tracks)` callbacks; settings component receives manager capability and reports changes. It never executes plugin-provided HTML/JS in the browser.

- [ ] Add MyGo management alongside, not instead of, the existing installed/marketplace/registry interface; show ZIP preview, declared permissions and limitations before confirmation.
- [ ] Expose installed enabled sources to ordinary users, including their own settings and account state, without exposing administrator management controls.
- [ ] Render home/custom navigation, typed search/pagination, playlists/albums/artists, artwork, account/prompts, favorite and supported playlist actions; hide unsupported controls. Handle loading/error/empty state and focus restoration.
- [ ] Abort previous loads on navigation and reject stale results. Settings save success must follow the real successful HTTP response; preserve edits on failure.
- [ ] Verify desktop, tablet and phone layouts, all theme foregrounds and keyboard operation; source list/buttons use existing tokens and reduced-motion behavior.
- [ ] Run relevant Node behavioral tests, `cd frontend && npm run lint && npm run build`; browser-test actual upload/config/search/favorite requests rather than label presence alone.

### Task 7: 播放器、队列与歌词接线

**Files:** Create `frontend/src/features/mygo/{playback,useMygoPlayback}.ts` and behavioral tests; Modify `frontend/src/App.tsx`, `frontend/src/types.ts` and `frontend/src/utils/app.ts` only at external-source integration points.

**Interfaces:** playback adapter owns source references, source queue persistence, current index, resolve/lyrics/favorite requests and source-to-player display mapping. External queue identity uses a tagged source reference, never the numeric local ID as the authoritative reference.

- [ ] Add failing behavior tests for play/pause/next/previous, queue insertion/removal, seeking, favorites, lyrics, switching back to local/radio/network audio, stale resolves and reload restore.
- [ ] Map current MyGo metadata into existing player/theme presentation, use authenticated stream/artwork URLs, preserve a distinct external identity and avoid calls to local song favorite/album/share/download APIs for external tracks.
- [ ] Route source favorites and played notifications only to exported source methods; source-only queue changes persist to Task 4/5 API rather than the existing positive-ID local queue endpoint.
- [ ] Keep normal local/songloft queue behavior unchanged; stop obsolete audio work on source transitions and do not autoplay after an unrelated cancelled request finishes.
- [ ] Browser-verify demo search-to-audible-playback, seek/Range, next track, favorite, lyrics, queue restore and real HTTP save on desktop/phone. Add one real streaming plugin fixture or pinned local package; record authentication-dependent limits explicitly.
- [ ] Re-run existing plugin-host, playback, cassette and settings regressions; do not claim real-service login if only fixtures were tested.

### Task 8: 文档、完整验证与发布

**Files:** Create `docs/mygo-plugin-capability-matrix.md`; Modify README, bilingual CHANGELOG and `frontend/package.json`; regenerate tracked embedded frontend using the existing build command.

- [ ] Document ZIP preparation, installation, per-user configuration, supported capabilities, unsupported native features, public-network-only policy and real-plugin test evidence; register upstream reference without implying all desktop plugins work.
- [ ] Run `cd backend && go mod verify && go test ./... && go vet ./...`; run `cd frontend && npm run lint && npm run build && npm run test:settings`; run `git diff --check`.
- [ ] Self-review diff against every spec acceptance criterion and Review Focus item; inspect generated asset scope and rebuild clean-tree assets for byte equality.
- [ ] Re-read GitHub releases/tags and remote main, select next free `0.18.x`, commit and push only verified changes as authorized by the user. Do not tag while required verification is incomplete.
- [ ] Wait for CI / official binary / Docker workflows on the exact release SHA. Download and verify all official archives; smoke-test Linux binary, authentication boundaries and MyGo source flow.
- [ ] Publish the verified draft once, with explicit tag/target SHA/name/body/draft/prerelease fields; re-read numeric/tag/latest endpoints and verify assets. Report actual results and any unverified Docker-local-run limitation.

## Approval Checkpoint

Scope is approved. Before implementation, confirm this plan and the esbuild Go dependency; recommended execution is native in the current session. No schema change or new JavaScript runtime is proposed. If either becomes necessary, stop and ask rather than silently broadening the approved architecture.
