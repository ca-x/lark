/**
 * Songloft Plugin Common JS — 由主程序自动注入到所有插件 HTML 页面
 * 职责：embed 检测、主题桥接、API 工具、宿主桥接、a11y（window.SongloftPlugin）
 *
 * WebF 引擎能力垫片（details / range 滑块 / file 选择器 / table / 空 img src /
 * 安全区）已抽离到 **webf-shims.js**，本文件只保留全环境通用的运行时核心。
 * 两个文件共享的内部句柄经 `window.__SongloftInternal` 传递（非公开 API）。
 */
(function() {
    'use strict';

    // WebF 引擎探测（主题落地的 forceNestedStyleRecalc 依赖它；函数声明会提升）。
    function isWebFEngine() {
        return !!window.webf;
    }

    // ── Embed 检测 ──
    if (new URLSearchParams(window.location.search).has('embed')) {
        document.documentElement.classList.add('embed');
    }

    // ── 主题桥接 ──
    var params = new URLSearchParams(window.location.search);
    var initialTheme = params.get('theme') || localStorage.getItem('songloft-theme') || 'light';

    function applyTheme(th) {
        var d = document.documentElement;
        // 用 setAttribute 而不是 d.dataset.theme：本脚本是 <head> 内的阻塞脚本，
        // 在 WebF 里此刻 documentElement.dataset 还是 null，赋值会抛
        // TypeError，而它会**中断整个 IIFE** —— window.SongloftPlugin 压根不会
        // 定义，宿主桥连带全废（songloft-org/songloft#341 实测）。
        // setAttribute 语义等价，且不依赖 dataset 何时就绪。
        d.setAttribute('data-theme', th);
        d.classList.remove('theme-light', 'theme-dark');
        d.classList.add('theme-' + th);
        localStorage.setItem('songloft-theme', th);
        // 亮暗色值在 theme.css 里是靠 `html[data-theme="dark"]` 覆盖 `:root` 的，
        // 而 WebF 改完根节点的变量**不会**让后代重新求值（根因详见
        // forceNestedStyleRecalc 的注释）。不补这一下，WebF 里切主题只会改到 `<html>`
        // 自己，整页停在加载那一刻的配色。
        forceNestedStyleRecalc();
        document.dispatchEvent(new CustomEvent('songloft-theme-change', { detail: { theme: th } }));
    }

    // 刻意包 try/catch：本文件是一个 IIFE，任何早期异常都会中断其余全部代码，
    // 包括最后那段 window.SongloftPlugin 的定义 —— 表现是宿主桥整体静默失效，
    // 极难归因（songloft-org/songloft#341 就踩过：dataset 在 WebF 里为 null）。
    // 主题失效只是外观问题，不该连带打掉插件的宿主能力。
    try {
        applyTheme(initialTheme);
    } catch (e) {
        console.warn('[songloft] applyTheme failed, continuing:', e);
    }

    if (params.has('theme')) {
        params.delete('theme');
        var cleanUrl = window.location.pathname;
        var remaining = params.toString();
        if (remaining) cleanUrl += '?' + remaining;
        history.replaceState(null, '', cleanUrl);
    }

    // ── 宿主真实色板（songloft-org/songloft#341）───────────────────────────
    //
    // theme.css 的 `--md-*` 只是**静态兜底**（由默认 seed 导出）。宿主在页面就绪后
    // 随 `songloft-theme` 消息把**真实的** ColorScheme 推来（含用户自定义 ThemePack），
    // 这里写成 documentElement 的**内联**自定义属性覆盖兜底值 —— 内联优先级最高，
    // 连插件自己在 `:root` 里重定义的同名变量也压得住。Dart 侧见
    // `songloft-player/lib/features/home/presentation/render/plugin_color_scheme.dart`。
    //
    // **为什么颜色挂在 `songloft-theme` 上而不单开一条消息**：亮暗标记（`data-theme`）
    // 与色值必须**同时**生效。分两条消息就会有一帧「`data-theme=dark` 但变量还是
    // 亮色」的错色闪烁。
    //
    // ⚠️ 插件想用 **JS** 读色必须调 `SongloftPlugin.getColorScheme()`，不能读 CSS：
    // WebF 的 `getComputedStyle` 对自定义属性一律返回空串，而 `<flutter-cupertino-*>`
    // 的属性值也不展开 `var()`、只吃字面 hex。
    //
    // **色板必须像 `songloft-theme`（亮暗）一样持久化到 localStorage 并在加载时恢复**
    // （songloft-org/songloft#341）。宿主的色板下推是一条 **fire-and-forget** 的
    // `window.postMessage`，没有回执。WebF 下二次进入插件页时页面是**全新加载**
    // （桌面端 Tab 切走即销毁 controller），而它的就绪信号是 `onBuildSuccess` 而非
    // 真正的 `load` 事件（第二次挂载 `onLoad` 根本不来）—— 这条推送可能早于本脚本
    // 注册 `message` 监听器而被静默丢弃，于是页面永久停在 `theme.css` 的**默认 seed
    // 静态兜底色**，而不是用户自定义 ThemePack 的颜色。表现正是「首次进入主题对、
    // 切走再进就丢了主题」。
    //
    // 恢复上一次的色板让页面**自给自足**、不再依赖推送时序：宿主推送退化为「运行中
    // 切主题」时的更新（去重后按需重推），加载首帧则直接用持久化的真实色板 ——
    // 对自定义主题包用户，这也顺带修掉了「首帧闪一下默认色再跳到自定义色」。
    var COLOR_SCHEME_STORAGE_KEY = 'songloft-color-scheme';

    function readPersistedColorScheme() {
        try {
            var raw = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (e) {
            // 损坏 / 不可用：当作没有持久化色板，回退到 theme.css 兜底 + 等宿主推送。
        }
        return null;
    }

    var lastColorScheme = readPersistedColorScheme();

    // camelCase → `--md-kebab-case`。key 用 Flutter `ColorScheme` 的字段名，
    // 好让两个仓库的表能逐字段对照审计，不必另记一套映射。
    function cssVarName(key) {
        return '--md-' + key.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
    }

    // 兼容别名：`--md-surface-variant` 不是 `ColorScheme` 的字段，但组件在用
    // （switch 轨道 / progress 底）。不一起写就会出现「一半变量跟随主题、一半停在
    // 静态兜底值」的割裂配色。
    var COLOR_ALIASES = {
        '--md-surface-variant': 'surfaceContainerHighest'
    };

    var HEX_RE = /^#[0-9a-fA-F]{6}$/;

    // ── WebF：改完根变量必须强制一次「带后代」的样式重算 ────────────────────
    //
    // **WebF 下运行时改 `<html>` 上的 CSS 变量，后代不会重新求值。** 这是 WebF
    // 0.24.27 的缺陷，读源码确证，两条路都断：
    //
    //   ① `css/variable.dart:191` 的 `setCSSVariable` 只通知**本元素自己**的
    //      `_propertyDependencies`，**没有向后代遍历**；
    //   ② 走 CSS 规则那条（`setAttribute('data-theme','dark')`）本该由
    //      `recalculateStyle(rebuildNested: true)` 递归后代，但批量刷时被
    //      `_shouldBatchRecalculateStyle` 分支整个丢掉，只 markElementStyleDirty，
    //      而 document 只在 reason 以 `childList-` 开头时才登记 rebuildNested。
    //
    // 症状：页面加载时色板对（首次样式解析带着正确值），此后**任何**主题切换都只
    // 改到 `<html>` 自己——整页停在加载那一刻的亮/暗，而原生 WidgetElement
    // （`<flutter-cupertino-input>` 等）跟着 Flutter 真实主题走 → 一半亮一半暗。
    //
    // 唯一能拿到 rebuildNested 的入口是 **childList 变更**。所以往 `<body>` 里插一个
    // 空 span 再立刻摘掉：两次变更把 body 标成「带后代重算」，body 子树因此重新解析
    // `var()`，从 html 的 renderStyle 上读到新值。同步完成、不绘制、无视觉副作用。
    //
    // **必须是 `<body>`，不能是 `documentElement`**：WebF 明确把 HTMLElement/HeadElement
    // 排除在 childList 标脏之外，poke 根节点等于什么都没做。
    // 只在 WebF 下做：浏览器 / 系统 WebView 的变量继承本来就是对的。
    function forceNestedStyleRecalc() {
        if (!isWebFEngine()) return;
        var body = document.body;
        if (!body || typeof document.createElement !== 'function') return;
        try {
            var probe = document.createElement('span');
            body.appendChild(probe);
            body.removeChild(probe);
        } catch (e) {
            // 拿不到 body（<head> 阻塞脚本期）或插入被拒：此时页面还没样式化，
            // 首次解析自然会带上正确的值，不需要补救。
        }
    }

    function applyColorScheme(colors) {
        if (!colors || typeof colors !== 'object') return;
        lastColorScheme = colors;
        // 持久化，供下次全新加载时同步恢复（见 lastColorScheme 声明处的注释）。
        // 失败只吞掉：localStorage 满 / 隐私模式下写不进不该连带打掉当次的色板落地。
        try {
            localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, JSON.stringify(colors));
        } catch (e) {
            // ignore
        }
        var de = document.documentElement;
        // 特性探测而不是假定：setProperty 拿不到就静默留给 ready 相重试。
        if (!de || !de.style || typeof de.style.setProperty !== 'function') return;
        var key;
        for (key in colors) {
            if (!Object.prototype.hasOwnProperty.call(colors, key)) continue;
            var v = colors[key];
            // 只接受 `#RRGGBB`。非法值一律跳过而不是写进去 —— 免得把坏值盖在
            // theme.css 的合法兜底值上。
            if (typeof v !== 'string' || !HEX_RE.test(v)) continue;
            de.style.setProperty(cssVarName(key), v);
        }
        for (key in COLOR_ALIASES) {
            if (!Object.prototype.hasOwnProperty.call(COLOR_ALIASES, key)) continue;
            var src = colors[COLOR_ALIASES[key]];
            if (typeof src !== 'string' || !HEX_RE.test(src)) continue;
            de.style.setProperty(key, src);
        }
        // 必须在派发事件**之前**：插件的监听器可能会去量元素（如按新底色重算控件配色），
        // 那时布局/样式应当已经是新的。
        forceNestedStyleRecalc();
        document.dispatchEvent(new CustomEvent('songloft-color-scheme-change', {
            detail: { colors: colors }
        }));
    }

    // 色板的 ready 相补写（三条下推链路都要用，故独立于 webf-shims 的 ready 注册表）。
    function applyColorSchemeOnReady() {
        if (lastColorScheme) applyColorScheme(lastColorScheme);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyColorSchemeOnReady);
    } else {
        applyColorSchemeOnReady();
    }

    // ── 宿主消息通道 ──
    // 注：`songloft-safe-area`（WebF-only）由 webf-shims.js 自己监听，不在这里。
    window.addEventListener('message', function(e) {
        if (!e.data || !e.data.type) return;
        if (e.data.type === 'songloft-theme' && (e.data.theme === 'light' || e.data.theme === 'dark')) {
            // ⚠️ 顺序不能反：色板必须先落地，再 applyTheme。插件是靠
            // `songloft-theme-change` 事件重算原生控件颜色的（如下载器插件的
            // SlSwitch 要把主色算成字面 hex 喂给 <flutter-cupertino-switch>），
            // 先 applyTheme 会让那些监听器读到**上一轮**的旧色板。
            //
            // try/catch：本监听器里抛出会吞掉同一条消息的后续处理 —— 色板失败不该
            // 连带把亮暗切换也打掉（兜底色还在 theme.css 里）。
            if (e.data.colors) {
                try {
                    applyColorScheme(e.data.colors);
                } catch (err) {
                    console.warn('[songloft] color-scheme apply failed:', err);
                }
            }
            applyTheme(e.data.theme);
        } else if (e.data.type === 'songloft-player-state') {
            dispatchPlayerState(e.data.state);
        } else if (e.data.type === 'songloft-host-reply') {
            // 安全：host 回执只接受来自父窗口的消息（native 顶层 parent===self 亦成立）。
            if (e.source && e.source !== window.parent) return;
            resolveHostReply(e.data);
        }
    });

    // ── API 工具 ──
    var API_BASE = '.';

    /**
     * 从 localStorage 获取 Songloft 认证 Token
     * @returns {string}
     */
    function getAuthToken() {
        try {
            var authData = localStorage.getItem('songloft-auth');
            if (authData) {
                var auth = JSON.parse(authData);
                return auth.accessToken || '';
            }
        } catch (e) {
            // ignore
        }
        return '';
    }

    function buildHeaders() {
        var headers = { 'Content-Type': 'application/json' };
        var token = getAuthToken();
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }
        return headers;
    }

    function parseResponse(response) {
        if (!response.ok) {
            return response.text().then(function(text) {
                var msg = response.statusText || ('HTTP ' + response.status);
                try {
                    var body = JSON.parse(text);
                    if (body && (body.message || body.error)) {
                        msg = body.message || body.error;
                    }
                } catch (_) {}
                throw new Error(msg);
            });
        }
        return response.text().then(function(text) {
            if (!text) return null;
            return JSON.parse(text);
        });
    }

    /**
     * 发送 GET 请求并返回 JSON
     * @param {string} path
     * @returns {Promise<any>}
     */
    function apiGet(path) {
        return fetch(API_BASE + path, {
            method: 'GET',
            headers: buildHeaders()
        }).then(parseResponse);
    }

    /**
     * 发送 POST 请求并返回 JSON
     * @param {string} path
     * @param {any} body
     * @returns {Promise<any>}
     */
    function apiPost(path, body) {
        return fetch(API_BASE + path, {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify(body)
        }).then(parseResponse);
    }

    /**
     * 发送 PUT 请求并返回 JSON
     * @param {string} path
     * @param {any} body
     * @returns {Promise<any>}
     */
    function apiPut(path, body) {
        return fetch(API_BASE + path, {
            method: 'PUT',
            headers: buildHeaders(),
            body: JSON.stringify(body)
        }).then(parseResponse);
    }

    /**
     * 发送 DELETE 请求并返回 JSON
     * @param {string} path
     * @returns {Promise<any>}
     */
    function apiDelete(path) {
        return fetch(API_BASE + path, {
            method: 'DELETE',
            headers: buildHeaders()
        }).then(parseResponse);
    }

    /**
     * Blob → `data:` URL（songloft-org/songloft#341）。
     *
     * 存在的理由：**WebF 没有 `URL.createObjectURL`**，而「带鉴权头 fetch 一张图 →
     * 显示」是插件常见写法（fetch 拿到的是 Blob，`<img src>` 不能直接吃 Blob）。
     * 也不可能给 WebF 垫一个返回 `blob:` 的 createObjectURL：它的资源加载器只认
     * http/https/assets/file/`data:`。而 `data:` URL 原生支持且确实能画出来。
     *
     * ⚠️ **本函数是异步的，而 `createObjectURL` 是同步的** —— blob → base64 只能经
     * `arrayBuffer()` / `FileReader`（都是异步）。所以插件**必须改调用点**。
     * 实现选 `blob.arrayBuffer()`：WebF 里 `FileReader` 不存在，而
     * `Blob.prototype.arrayBuffer` 在（浏览器/系统 WebView 亦然，三路共用一份）。
     *
     * ⚠️⚠️ **刻意不用 `btoa`，自带 base64 编码表。** WebF 的 `btoa` 不是二进制安全的：
     * 它把 > 0x7F 的码点当字符先做了一次 UTF-8 编码，不仅值错还静默丢字节
     * （256 字节里 0xC1..0xFF 共 63 个被丢）。`atob` 方向是正确的，故只需自己实现
     * encode 方向。分块处理（3 字节一组、每 8 KB 拼一次）避免 RangeError 与 O(n²)。
     *
     * @param {Blob} blob
     * @param {string} [mimeType] 覆盖 blob.type（WebF 下 blob.type 恒为空串）
     * @returns {Promise<string>} 形如 `data:image/jpeg;base64,...`
     */
    var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    /** Uint8Array → base64。不依赖 btoa，见 blobToDataURL 的注释。 */
    function bytesToBase64(bytes) {
        var out = '';
        var buf = [];
        var i = 0;
        var len = bytes.length;
        // 每次吃 3 字节产 4 个 base64 字符；余数在循环外单独补 padding
        var limit = len - (len % 3);
        for (i = 0; i < limit; i += 3) {
            var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
            buf.push(
                B64_CHARS.charAt((n >> 18) & 63),
                B64_CHARS.charAt((n >> 12) & 63),
                B64_CHARS.charAt((n >> 6) & 63),
                B64_CHARS.charAt(n & 63)
            );
            // 攒够一批再 join，避免 O(n²) 的字符串拼接
            if (buf.length >= 8192) {
                out += buf.join('');
                buf.length = 0;
            }
        }
        var rem = len % 3;
        if (rem === 1) {
            var a = bytes[len - 1];
            buf.push(
                B64_CHARS.charAt((a >> 2) & 63),
                B64_CHARS.charAt((a << 4) & 63),
                '=', '='
            );
        } else if (rem === 2) {
            var b0 = bytes[len - 2], b1 = bytes[len - 1];
            buf.push(
                B64_CHARS.charAt((b0 >> 2) & 63),
                B64_CHARS.charAt(((b0 << 4) | (b1 >> 4)) & 63),
                B64_CHARS.charAt((b1 << 2) & 63),
                '='
            );
        }
        out += buf.join('');
        return out;
    }

    function blobToDataURL(blob, mimeType) {
        if (!blob) return Promise.reject(new Error('blobToDataURL: no blob'));
        if (typeof blob.arrayBuffer !== 'function') {
            return Promise.reject(new Error('blobToDataURL: Blob.arrayBuffer unavailable'));
        }
        var mime = mimeType || blob.type || 'application/octet-stream';
        return blob.arrayBuffer().then(function(buf) {
            return 'data:' + mime + ';base64,' + bytesToBase64(new Uint8Array(buf));
        });
    }

    /**
     * 获取当前主题
     * @returns {'light' | 'dark'}
     */
    function getTheme() {
        // 与 applyTheme 对称，不走 dataset（WebF 早期为 null，见 applyTheme 注释）
        return document.documentElement.getAttribute('data-theme') || 'light';
    }

    /**
     * 监听主题变化
     * @param {(theme: 'light' | 'dark') => void} callback
     */
    function onThemeChange(callback) {
        document.addEventListener('songloft-theme-change', function(e) {
            callback(e.detail.theme);
        });
    }

    /**
     * 宿主真实色板。key 是 Flutter `ColorScheme` 的字段名（camelCase），
     * 值是 `#RRGGBB`，例如 `{primary: '#415F91', surfaceContainer: '#EDEDF4', ...}`。
     *
     * **这是插件用 JS 读色的唯一正确途径** —— WebF 的 `getComputedStyle` 对自定义
     * 属性一律返回空串；而 `<flutter-cupertino-*>` 的属性值不展开 `var()`，只吃字面 hex。
     *
     * 宿主还没推到时返回 `null`，此时页面用的是 `theme.css` 的静态兜底色。想在到达
     * 时收到通知就监听 `document` 上的 `songloft-color-scheme-change` 事件，或用
     * `onThemeChange` —— 色板保证在 `songloft-theme-change` 派发**之前**就已落地。
     *
     * 返回浅拷贝：调用方改了也不会污染内部缓存。
     * @returns {Object|null}
     */
    function getColorScheme() {
        if (!lastColorScheme) return null;
        var out = {};
        for (var k in lastColorScheme) {
            if (Object.prototype.hasOwnProperty.call(lastColorScheme, k)) out[k] = lastColorScheme[k];
        }
        return out;
    }

    // ── Accessibility ──

    function hideDecorationIcons() {
        document.querySelectorAll('.material-symbols-outlined, .mi').forEach(function(el) {
            if (!el.getAttribute('aria-hidden')) {
                el.setAttribute('aria-hidden', 'true');
            }
        });
    }

    function enhanceClickableElements() {
        document.querySelectorAll('[onclick]').forEach(function(el) {
            var tag = el.tagName.toLowerCase();
            if (tag !== 'button' && tag !== 'a' && tag !== 'input' && tag !== 'select') {
                if (!el.getAttribute('role')) el.setAttribute('role', 'button');
                if (!el.getAttribute('tabindex')) el.setAttribute('tabindex', '0');
                el.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        el.click();
                    }
                });
            }
        });
    }

    function announce(message, priority) {
        var region = document.getElementById('songloft-a11y-live');
        if (!region) {
            region = document.createElement('div');
            region.id = 'songloft-a11y-live';
            region.className = 'sr-only';
            region.setAttribute('aria-live', priority || 'polite');
            region.setAttribute('aria-atomic', 'true');
            document.body.appendChild(region);
        }
        region.textContent = '';
        setTimeout(function() { region.textContent = message; }, 100);
    }

    function initAccessibility() {
        hideDecorationIcons();
        enhanceClickableElements();
        var snackbar = document.getElementById('snackbar');
        if (snackbar && !snackbar.getAttribute('role')) {
            snackbar.setAttribute('role', 'status');
            snackbar.setAttribute('aria-live', 'polite');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAccessibility);
    } else {
        initAccessibility();
    }

    // ── 宿主客户端桥接（仅 Flutter 客户端 webview 有效）──
    //
    // 让 webview 打开的插件页调用 Flutter 宿主能力（改写正在播放队列、播放控制、
    // 状态订阅等）。请求走 flutter_inappwebview 的 callHandler（原生 Promise 返回值），
    // 事件（播放状态变更）复用上面的 postMessage 通道。
    // Web/iframe 或无原生桥接时优雅降级：isHostAvailable() 返回 false，调用会 reject。

    var HOST_HANDLER = 'songloftHost';
    var HOST_CALL_TIMEOUT_MS = 10000;

    // native（Android/iOS/桌面）webview：flutter_inappwebview 提供请求/响应式 callHandler。
    function isNativeHost() {
        return !!(window.flutter_inappwebview &&
            typeof window.flutter_inappwebview.callHandler === 'function');
    }

    // WebF 渲染引擎（songloft-org/songloft#341）：既没有 flutter_inappwebview，
    // 也不是 iframe（WebF 无 iframe 实现，window.parent === window），所以必须
    // 单独探测。走 WebF 自带的 methodChannel，语义与 callHandler 近乎一对一。
    function isWebFHost() {
        return !!(window.webf && window.webf.methodChannel &&
            typeof window.webf.methodChannel.invokeMethod === 'function');
    }

    // Web：插件页运行在宿主 iframe 内，走 postMessage 与父窗口通信。
    // 独立浏览器标签（parent === self）没有宿主，返回 false。
    function isIframeHost() {
        try {
            return !!window.parent && window.parent !== window;
        } catch (e) {
            return true; // 跨域访问 parent 抛错 → 视为嵌入
        }
    }

    function isHostAvailable() {
        return isWebFHost() || isNativeHost() || isIframeHost();
    }

    // ── Web/iframe postMessage 传输：请求/响应关联 ──
    var hostPending = {};
    var hostCallSeq = 0;

    function invokeViaPostMessage(ns, method, params) {
        return new Promise(function(resolve, reject) {
            var id = 'c' + (++hostCallSeq) + '_' + Date.now();
            var timer = setTimeout(function() {
                delete hostPending[id];
                reject(new Error('songloft host call timeout: ' + ns + '.' + method));
            }, HOST_CALL_TIMEOUT_MS);
            hostPending[id] = { resolve: resolve, reject: reject, timer: timer };
            window.parent.postMessage(
                { type: 'songloft-host-call', id: id, ns: ns, method: method, params: params || null },
                '*'
            );
        });
    }

    function resolveHostReply(msg) {
        var p = hostPending[msg.id];
        if (!p) return;
        clearTimeout(p.timer);
        delete hostPending[msg.id];
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new Error(msg.error || 'songloft host call failed'));
    }

    // ── WebF methodChannel 传输 ──
    //
    // 请求体与响应体两端都是 JSON 字符串：WebF 的 method channel 对复杂对象的
    // 序列化形态没有稳定契约，字符串是唯一两端都确定的载体。响应侧对 string
    // 与 object 都做兼容，不假定其中一种。
    function invokeViaWebF(ns, method, params) {
        return window.webf.methodChannel
            .invokeMethod(HOST_HANDLER, JSON.stringify({ ns: ns, method: method, params: params || null }))
            .then(function(res) {
                var parsed = res;
                if (typeof parsed === 'string') {
                    try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; }
                }
                if (parsed && parsed.ok) return parsed.data;
                throw new Error((parsed && parsed.error) || 'songloft host call failed');
            });
    }

    // 插件注册的「页面内返回」处理器，见 SongloftPlugin.onHostBack。
    var pluginBackHandler = null;

    /**
     * 注册「页面内返回」处理器：宿主的返回键（Android 硬件键 / 全屏页 AppBar 的
     * 返回箭头）会**先**问这里，返回 `true` 表示已消费，宿主就不退出路由 / 不退出应用。
     *
     * 用途是插件内部有多级页面（如「主页 → 设置页」）时，让返回键先退回上一级。
     *
     * ⚠️ **不要为此去用 `history.pushState`**。WebF 不实现 SPA history 路由，
     * `pushState` 之后 `history.length > 1` 会让下面那条兜底判断误报「已消费」，
     * 而 WebF 又不 fire `popstate` —— 页面毫无变化，**返回键变成死键**。
     *
     * ⚠️ 只对 **WebF** 渲染的插件页生效（`registerWebFBackHandler` 有
     * `isWebFHost()` 闸门）。系统 WebView / iframe / 浏览器走各自 `canGoBack()`。
     *
     * @param {() => boolean} fn 返回 true 表示本次返回已被页面消费
     */
    function onHostBack(fn) {
        pluginBackHandler = typeof fn === 'function' ? fn : null;
    }

    // 宿主请求页面回退（songloft-org/songloft#341）。
    // WebF 侧没有 canGoBack，宿主无法自行判断页面内还有没有历史，只能问页面。
    // 只在 WebF 下注册：另外两条链路的宿主用各自 webview 的 canGoBack。
    function registerWebFBackHandler() {
        if (!isWebFHost()) return;
        var mc = window.webf.methodChannel;
        if (typeof mc.addMethodCallHandler !== 'function') return;
        mc.addMethodCallHandler('requestBack', function() {
            // 插件的页面内层级优先于浏览历史。try/catch 是必须的：插件回调抛异常
            // 不能把返回键卡死（那会让用户既回不去也退不出），出错就当没消费。
            if (pluginBackHandler) {
                try {
                    if (pluginBackHandler() === true) return true;
                } catch (err) {
                    console.warn('[songloft] onHostBack handler failed:', err);
                }
            }
            if (window.history && window.history.length > 1) {
                window.history.back();
                return true;
            }
            return false;
        });
    }

    registerWebFBackHandler();

    /**
     * 调用宿主能力。约定返回 { ok, data } 或 { ok:false, error }。
     * WebF 走 methodChannel，native 走 callHandler，Web/iframe 走 postMessage 关联。
     * @returns {Promise<any>}
     */
    function invokeHost(ns, method, params) {
        if (isWebFHost()) {
            return invokeViaWebF(ns, method, params);
        }
        if (isNativeHost()) {
            return window.flutter_inappwebview
                .callHandler(HOST_HANDLER, { ns: ns, method: method, params: params || null })
                .then(function(res) {
                    if (res && res.ok) return res.data;
                    throw new Error((res && res.error) || 'songloft host call failed');
                });
        }
        if (isIframeHost()) {
            return invokeViaPostMessage(ns, method, params);
        }
        return Promise.reject(new Error('songloft host bridge unavailable (not running in a Songloft client webview)'));
    }

    // 播放状态订阅
    var playerStateListeners = [];

    function dispatchPlayerState(state) {
        for (var i = 0; i < playerStateListeners.length; i++) {
            try { playerStateListeners[i](state); } catch (e) { /* ignore */ }
        }
        document.dispatchEvent(new CustomEvent('songloft-player-state-change', { detail: state }));
    }

    var host = {
        isAvailable: isHostAvailable,
        getInfo: function() { return invokeHost('host', 'getInfo'); }
    };

    var player = {
        getState: function() { return invokeHost('player', 'getState'); },
        setQueue: function(ids, options) {
            options = options || {};
            return invokeHost('player', 'setQueue', {
                ids: ids,
                startIndex: options.startIndex,
                sourcePlaylistId: options.sourcePlaylistId
            });
        },
        addToQueue: function(ids) { return invokeHost('player', 'addToQueue', { ids: ids }); },
        insertToQueue: function(index, id) { return invokeHost('player', 'insertToQueue', { index: index, id: id }); },
        removeFromQueue: function(index) { return invokeHost('player', 'removeFromQueue', { index: index }); },
        reorderQueue: function(oldIndex, newIndex) { return invokeHost('player', 'reorderQueue', { oldIndex: oldIndex, newIndex: newIndex }); },
        clearQueue: function() { return invokeHost('player', 'clearQueue'); },
        play: function(id) { return invokeHost('player', 'play', { id: id }); },
        pause: function() { return invokeHost('player', 'pause'); },
        togglePlay: function() { return invokeHost('player', 'togglePlay'); },
        next: function() { return invokeHost('player', 'next'); },
        prev: function() { return invokeHost('player', 'prev'); },
        seek: function(seconds) { return invokeHost('player', 'seek', { seconds: seconds }); },
        setVolume: function(volume) { return invokeHost('player', 'setVolume', { volume: volume }); },
        setPlayMode: function(mode) { return invokeHost('player', 'setPlayMode', { mode: mode }); },
        playPlaylistById: function(playlistId) { return invokeHost('player', 'playPlaylistById', { playlistId: playlistId }); },
        onStateChange: function(handler) {
            playerStateListeners.push(handler);
            return function() {
                var idx = playerStateListeners.indexOf(handler);
                if (idx >= 0) playerStateListeners.splice(idx, 1);
            };
        }
    };

    /**
     * 读取指定 origin 的 Cookie（仅原生客户端可用，Web 不支持）。
     * @param {string} origin - 目标站点 origin，如 "https://example.com"
     * @returns {Promise<Record<string, string>>} name→value 映射
     */
    function getCookies(origin) {
        return invokeHost('cookies', 'get', { origin: origin });
    }

    window.SongloftPlugin = {
        getAuthToken: getAuthToken,
        apiGet: apiGet,
        apiPost: apiPost,
        apiPut: apiPut,
        apiDelete: apiDelete,
        getTheme: getTheme,
        onThemeChange: onThemeChange,
        getColorScheme: getColorScheme,
        onHostBack: onHostBack,
        // 插件如果**自己**在运行时改 `<html>` 上的 CSS 变量（自定义配色、密度开关等），
        // 改完必须调这个，否则在 WebF 下后代一个都不会重新求值 —— 根因见
        // forceNestedStyleRecalc 的注释。非 WebF 下是空操作，可以无条件调。
        forceStyleRecalc: forceNestedStyleRecalc,
        // Blob → data: URL。WebF 没有 URL.createObjectURL，见函数上方注释。
        // 三条渲染路径共用同一份实现（浏览器/WebView 下同样可用），插件不必分叉。
        blobToDataURL: blobToDataURL,
        // WebF 下 input[type=file] 垫片最近一次选到的文件数组（每项
        // {name, size, text?, bytesBase64?}）。由 webf-shims.js 回填；未选过时为 null。
        lastPickedFiles: null,
        announce: announce,
        hideDecorationIcons: hideDecorationIcons,
        enhanceClickableElements: enhanceClickableElements,
        // 重跑 WebF 垫片的 ready 段（插件用 innerHTML 动态插入内容后调用）。
        // 由 webf-shims.js 覆盖为真正实现；未加载 webf-shims 时是安全空操作。
        // 幂等，且在浏览器 / 系统 WebView 下是彻底的 no-op。
        applyShims: function() {},
        host: host,
        player: player,
        getCookies: getCookies
    };

    // 供 webf-shims.js 复用的内部句柄（**非公开 API**，插件请勿依赖）。
    // 这样宿主桥 / 样式重算逻辑只此一份，不必在垫片文件里重复实现。
    window.__SongloftInternal = {
        invokeHost: invokeHost,
        forceStyleRecalc: forceNestedStyleRecalc
    };
})();
