/**
 * Songloft Plugin — WebF 兼容垫片层（songloft-org/songloft#341）
 * 由主程序自动注入到所有插件 HTML 页面（在 common.js 之后）。
 *
 * WebF 是自研 W3C 运行时，有一批 HTML/CSS 能力缺失。本文件由后端注入到**每个**
 * 插件页，而插件是独立仓库、第三方可自由发布 —— 我们改不了别人的插件，所以这里
 * 是统一垫掉这些缺口的唯一位置。
 *
 * 三条铁律（本文件由后端服务给**所有**客户端版本和普通浏览器）：
 *   ① 纯增量 ② 特性探测 ③ 全部关在 isWebFEngine() 分支里。
 * 绝不能改变浏览器与系统 WebView 下的既有行为。
 *
 * 依赖 common.js 先建好的内部句柄 `window.__SongloftInternal`
 * （invokeHost / forceStyleRecalc）与 `window.SongloftPlugin`（回填 applyShims /
 * lastPickedFiles）。common.js 是 <head> 内先于本文件的阻塞脚本，故此刻已就绪。
 *
 * ── 两个时机，刻意分开 —— 不是代码风格，是能力边界 ────────────────────
 *
 *   installEarly()   立即执行。本文件是 <head> 内阻塞脚本，此刻 <body> 还没解析。
 *                    **原型 / 属性访问器级的拦截只能放这里**：它必须早于插件自己的
 *                    脚本安装，晚一步就漏掉别人已经跑过的赋值。代价是不能碰 DOM。
 *
 *   applyOnReady()   DOMContentLoaded 后执行。**就地替换 / 改造元素只能放这里**：
 *                    要等解析器把节点建出来才有东西可改。
 *
 * ── 两类垫片的分界线 ────────────────────────────────────────────────
 * 判据是「这个缺口会不会在**解析期**就产生不可撤销的副作用（发请求 / 起解码）」：
 *   会 → applyOnReady 根本来不及（如 <img src=""> 的加载在解析期就发起，最终在
 *        服务端 injectHTMLHead 里剥掉；这里只剩运行时 img.src='' 访问器 + DOM 兜底）。
 *   不会 → <details>、<table> 这类纯渲染/交互缺口晚到 DOMContentLoaded 再改造即可。
 */
(function() {
    'use strict';

    function isWebFEngine() {
        return !!window.webf;
    }

    // 复用 common.js 建好的内部句柄。宿主桥与样式重算逻辑只此一份。
    var INTERNAL = window.__SongloftInternal || {};
    var invokeHost = INTERNAL.invokeHost || function() {
        return Promise.reject(new Error('songloft host bridge unavailable'));
    };
    var forceStyleRecalc = INTERNAL.forceStyleRecalc || function() {};

    // 每个垫片各自包 try/catch，一个失败不能拖垮其它垫片。
    // 本文件是一个 IIFE，任一垫片抛出都会中断其余全部代码 —— 垫片失效只意味着
    // 「某个元素退回 WebF 的原生表现」，绝不该连带打掉别的垫片。
    function runShims(shims, phase) {
        for (var i = 0; i < shims.length; i++) {
            try {
                shims[i].apply();
            } catch (e) {
                console.warn('[songloft] shim "' + shims[i].name + '" failed (' + phase + '):', e);
            }
        }
    }

    // 按标签名收集元素并快照成数组。
    // ① 优先 querySelectorAll，但对 WebF 里**未注册的标签**（details/summary 落到
    // _UnknownHTMLElement）不敢假定类型选择器一定能匹配，空结果时退回
    // getElementsByTagName；② 一律拷成普通数组 —— getElementsByTagName 返回 live
    // 集合，垫片会改 DOM，边改边遍历不安全。
    function collectByTag(tag) {
        var list = null;
        try {
            list = document.querySelectorAll(tag);
        } catch (e) {
            list = null;
        }
        if (!list || !list.length) {
            try {
                list = document.getElementsByTagName(tag);
            } catch (e) {
                list = null;
            }
        }
        var out = [];
        if (list) {
            for (var i = 0; i < list.length; i++) out.push(list[i]);
        }
        return out;
    }

    // ── 垫片：空 img src（early 段 —— 属性访问器）──────────────────────────
    //
    // 按 HTML 规范 src="" 是无效值，浏览器不会为它发请求。WebF 却把空 src
    // **解析成当前文档 URL**，于是把插件页自己的 HTML 抓回来当图片解码，报
    // 「Failed to decode image ... (mime=text/html)」。实测命中 miot / stats /
    // music-feed 等多个插件，所以在宿主侧统一挡掉，而不是逐个插件改。
    var emptyImgSrcAccessorShim = {
        name: 'img-src-accessor',
        apply: function() {
            var imgProto = window.HTMLImageElement && window.HTMLImageElement.prototype;
            var srcDesc = imgProto && Object.getOwnPropertyDescriptor(imgProto, 'src');
            if (!srcDesc || !srcDesc.set || !srcDesc.configurable) return;
            Object.defineProperty(imgProto, 'src', {
                configurable: true,
                enumerable: srcDesc.enumerable,
                get: srcDesc.get,
                set: function(value) {
                    // 改为移除属性，语义上等价于「没有图」
                    if (value === '' || value === null || value === undefined) {
                        this.removeAttribute('src');
                        return;
                    }
                    srcDesc.set.call(this, value);
                }
            });
        }
    };

    // ── 垫片：空 img src（ready 段 —— DOM 兜底扫描）─────────────────────────
    //
    // 服务端 stripEmptySrcAttrs 已经剥掉插件页里写死的 src=""，这道扫描是兜底：
    // 覆盖「插件运行时用 innerHTML 插进来的 <img src="">」——那条路径既不过服务端
    // 正则，也不过上面的属性访问器（innerHTML 走的是解析器，不是 setter）。
    var emptyImgSrcSweepShim = {
        name: 'img-src-sweep',
        apply: function() {
            var imgs = collectByTag('img');
            for (var i = 0; i < imgs.length; i++) {
                if (imgs[i].getAttribute('src') === '') imgs[i].removeAttribute('src');
            }
        }
    };

    // ── 垫片：<details> / <summary>（ready 段 —— 就地改造）─────────────────
    //
    // WebF 的标签注册表里没有 details/summary，它们降级为 _UnknownHTMLElement
    // （display:block）：子内容照常渲染成块，但**没有折叠交互、没有 open 属性语义、
    // 没有三角标记** —— 「详情」永远是摊开的。
    //
    // 刻意**不**把 details/summary 换成 div：真实插件按标签名选样式，换标签会静默丢
    // 掉这些样式，插件里的 querySelector('summary') 也会失配。所以保留原元素，只做
    // 四件事：① 把非 summary 子节点收进可折叠容器 ② 给 summary 挂 click/键盘切换
    // ③ 补 open 属性访问器 ④ 插一个 Material Symbols 连字做三角标记。
    // 样式走 webf-shims.css 里的 .sl-details* 变量，自动跟随主题。
    var DETAILS_MARK = 'data-sl-details-shim';

    function shimOneDetails(el) {
        // 幂等：applyShims 可被插件在动态插入 HTML 后重复调用
        if (el.hasAttribute(DETAILS_MARK)) return;
        el.setAttribute(DETAILS_MARK, '');

        var content = document.createElement('div');
        content.className = 'sl-details-content';

        // 第一个 <summary> 当触发器，其余子节点（含文本节点）全进 content。
        // 先把 childNodes 快照成数组：appendChild 会改动这个 live 集合。
        var kids = [];
        for (var i = 0; i < el.childNodes.length; i++) kids.push(el.childNodes[i]);

        var summary = null;
        for (var j = 0; j < kids.length; j++) {
            var node = kids[j];
            if (!summary && node.nodeType === 1 && node.tagName &&
                node.tagName.toLowerCase() === 'summary') {
                summary = node;
                continue;
            }
            content.appendChild(node);
        }
        el.appendChild(content);

        // 没写 <summary> 时规范要求显示 "Details"。这里补一个同名元素，否则折叠后
        // 内容永远打不开 —— 宁可多一行占位文字，也不能做出打不开的黑洞。
        if (!summary) {
            summary = document.createElement('summary');
            summary.textContent = 'Details';
            el.insertBefore(summary, content);
        }
        el.classList.add('sl-details');
        summary.classList.add('sl-details-summary');
        summary.setAttribute('role', 'button');
        if (!summary.getAttribute('tabindex')) summary.setAttribute('tabindex', '0');

        var marker = document.createElement('span');
        marker.className = 'material-symbols-outlined sl-details-marker';
        marker.setAttribute('aria-hidden', 'true');
        summary.insertBefore(marker, summary.firstChild);

        // 尊重原有 open 属性的初始状态
        var open = el.hasAttribute('open');

        function render() {
            // 刻意写死 'block' 而不是复位成 ''：WebF 对「把 inline style 置空
            // 是否等于撤销声明」没有稳定表现，content 是我们自己建的 div，
            // block 就是它的正确显示值。
            content.style.display = open ? 'block' : 'none';
            // 三角用连字文本切换，而不是 CSS transform 旋转：WebF 的 transform /
            // 伪元素 content 支持面不确定，换字是最稳的一条路。
            marker.textContent = open ? 'arrow_drop_down' : 'arrow_right';
            summary.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) el.setAttribute('open', '');
            else el.removeAttribute('open');
        }

        function toggle() {
            open = !open;
            render();
            // 与规范对齐：状态变化派发 toggle（浏览器里插件本来就能收到这个事件，
            // 垫片不补的话 WebF 下监听 toggle 的插件会静默失灵）
            try {
                el.dispatchEvent(new CustomEvent('toggle', { bubbles: false }));
            } catch (e) { /* 事件构造不可用不影响折叠本身 */ }
        }

        render();
        summary.addEventListener('click', toggle);
        summary.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        });

        // open 在浏览器里是反射属性（details.open = true 即展开），WebF 的未知元素
        // 没有这层语义。补个访问器，让插件既有的 el.open 读写照常工作。
        try {
            Object.defineProperty(el, 'open', {
                configurable: true,
                get: function() { return open; },
                set: function(v) {
                    var next = !!v;
                    if (next === open) return;
                    open = next;
                    render();
                }
            });
        } catch (e) {
            // 访问器装不上时仍可点击展开，不致命
            console.warn('[songloft] details.open accessor unavailable:', e);
        }
    }

    var detailsShim = {
        name: 'details',
        apply: function() {
            var list = collectByTag('details');
            for (var i = 0; i < list.length; i++) {
                // 逐元素兜底：页面里某个畸形 details 不该让其余的一起失去折叠
                try {
                    shimOneDetails(list[i]);
                } catch (e) {
                    console.warn('[songloft] details shim skipped one element:', e);
                }
            }
        }
    };

    // ── 垫片：input[type=range] → <songloft-slider>（ready 段）────────────
    //
    // WebF 的 <input> 实现只认 radio/checkbox/button/submit/date/time/hidden，
    // **没有 range 分支**，于是 input[type=range] 落到 default 走 TextField；min/max/
    // step 也**完全没有实现**。纯 JS 补不出滑块（mousedown/pointermove 在 WebF 里
    // 压根不存在），拖动必须由 Dart 侧的 <songloft-slider> 提供，这里只做「就地嫁接」。
    //
    // ── 为什么保留原 <input>（不换标签）──
    // 插件按 id/标签名 querySelector 后**直接读写 .value**（miot 音量条 9 处），还有
    // `.disabled = x` 与 `addEventListener('input')`。换标签会静默打断插件自己的 JS。
    // 所以：原 input 留在 DOM 里当**数据宿主**，<songloft-slider> 只当**视图**，双向同步。
    //
    // ── 架构依据（scripts/webf-verify 第 14 组实测，非推断）──
    //   ① `Object.defineProperty(input,'value',...)` 能遮蔽 WebF 原生访问器（哨兵
    //      往返 77→77 验证）；.value 本来就是实例上 configurable 的 own 访问器。
    //      故 JS→滑块方向可事件驱动，不需轮询。**判据必须是哨兵往返**（QuickJS 的
    //      exotic get_own_property 优先级高于普通 own property，装上了也可能读写照旧
    //      走原生）——下面 install() 里那段自检就是为此。
    //   ② `input.matches` 同样能遮蔽（复原 `:active` 语义）。
    //   ③ `querySelectorAll('input[type=range]')` 可用。
    //   ④ Dart→JS dispatchEvent 通得过，`event.data` 能带回新值。
    //
    // ── 遮蔽失败就整体放弃（verified-or-abort）──
    // 若 ① 自检没过，**把滑块删掉、原 input 还原**，退回 WebF 原生表现。刻意不写
    // 「退化成定时轮询」的第二条路：那条路在本环境永远跑不到、也测不到；而「隐藏了
    // input、又同步不上」比「难看但能用」严重得多。
    var RANGE_MARK = 'data-sl-range-shim';
    var RANGE_OPT_OUT = 'data-sl-no-slider';
    // 兜底清 dragging 的时间。正常情况下滑块一定会在抬手时派 change，但万一元素被
    // 插件在拖动中途 innerHTML 掉，change 就永远不来，dragging 卡 true 会抑制所有
    // JS→滑块同步。
    var RANGE_DRAG_TIMEOUT_MS = 1500;

    function collectRangeInputs() {
        var list = [];
        try {
            var found = document.querySelectorAll('input[type="range"]');
            for (var i = 0; i < found.length; i++) list.push(found[i]);
        } catch (e) {
            list = [];
        }
        if (!list.length) {
            var all = collectByTag('input');
            for (var j = 0; j < all.length; j++) {
                var t = all[j].getAttribute('type');
                if (t && t.toLowerCase() === 'range') list.push(all[j]);
            }
        }
        return list;
    }

    // 派发一个「像浏览器那样」的事件给原 input，好让插件既有的监听器照常跑。
    // bubbles:true 是因为浏览器里 input/change 都冒泡，插件可能监听在祖先上；
    // WebF 的 Event 构造若不认第二个参数，退回无参形态（只丢冒泡，不致命）。
    function fireOnInput(input, type) {
        var ev;
        try {
            ev = new Event(type, { bubbles: true });
        } catch (e) {
            try { ev = new Event(type); } catch (e2) { return; }
        }
        input.dispatchEvent(ev);
    }

    function shimOneRange(input) {
        // 幂等：applyShims 可被插件在动态插入 HTML 后重复调用
        if (input.hasAttribute(RANGE_MARK)) return;
        // 插件的正式退出开关：某些 range 就是想保持原生表现（或插件自己已经处理了）
        if (input.hasAttribute(RANGE_OPT_OUT)) return;
        // 游离节点没地方插滑块。**在打标记之前**判掉：打了标记再失败，下一轮
        // applyShims 会跳过它，那个 input 就永久停在 WebF 的文本框形态了。
        if (!input.parentNode) return;
        input.setAttribute(RANGE_MARK, '');

        var slider = document.createElement('songloft-slider');
        slider.className = 'sl-range-slider';

        // 几何：**不拷 class**，只拷 inline style。
        // 新标签匹配不到插件 CSS 里 `input[type="range"]` 的选择器，尺寸拿不到。三条
        // 路里选了拷 inline style（作者对**这一个元素**的显式意图）+ 朝向由插件用
        // data-sl-orientation 显式声明 + 其余几何由插件针对 songloft-slider /
        // .sl-range-slider / [data-sl-for=...] 另写。
        var inlineStyle = input.getAttribute('style');
        if (inlineStyle) slider.setAttribute('style', inlineStyle);

        // 朝向：**只认显式声明**，不猜。
        var orientation = input.getAttribute('data-sl-orientation');
        if (orientation) slider.setAttribute('orientation', orientation);

        // min/max/step 必须自己从 attribute 读 —— WebF 没实现这三个属性反射
        // （实测 el.min 是空串，不是 "0"）。
        var passthrough = ['min', 'max', 'step', 'aria-label'];
        for (var p = 0; p < passthrough.length; p++) {
            var v = input.getAttribute(passthrough[p]);
            if (v !== null) slider.setAttribute(passthrough[p], v);
        }
        // 给插件 CSS 一个精确选择器（原 input 的 id 留在 input 上不能挪走）
        if (input.id) slider.setAttribute('data-sl-for', input.id);

        var store = input.value;
        if (store === null || store === undefined || store === '') {
            store = input.getAttribute('value') || '0';
        }
        store = String(store);
        slider.setAttribute('value', store);
        if (input.disabled) slider.setAttribute('disabled', '');

        // 插在原 input 之后：位置、DOM 顺序、flex 里的排布都最接近它替代的那个元素
        if (input.nextSibling) input.parentNode.insertBefore(slider, input.nextSibling);
        else input.parentNode.appendChild(slider);

        var dragging = false;
        var dragTimer = null;

        function pushToSlider() {
            slider.setAttribute('value', store);
        }

        // ── ① .value 遮蔽 + 自检 ──────────────────────────────────────
        var nativeDesc = null;
        var installed = false;
        var origValue = store;
        // 自检期间不回推滑块。不挡的话哨兵字符串会被 setAttribute('value','sl-probe')
        // 写到滑块上，Dart 侧当即打一条「不是有效数字」的警告，滑块的值也脏了。
        var booting = true;
        try {
            nativeDesc = Object.getOwnPropertyDescriptor(input, 'value');
            Object.defineProperty(input, 'value', {
                configurable: true,
                get: function () { return store; },
                set: function (v) {
                    store = (v === null || v === undefined) ? '' : String(v);
                    // 拖动期间**不回推**滑块：插件通常会定时轮询设备状态并回写滑块，
                    // 浏览器里它靠 `el.matches(':active')` 判断「用户正在拖，别覆盖」，
                    // 而隐藏后的 input 永远进不了 :active。这里连同下面的 matches 遮蔽
                    // 是双保险；第三道闸在 Dart 侧（拖动中忽略外部 value）。
                    if (!dragging && !booting) pushToSlider();
                }
            });
            // 哨兵往返自检，见本段顶部注释 ①
            var probe = 'sl-probe';
            input.value = probe;
            installed = (input.value === probe);
        } catch (e) {
            installed = false;
        }
        booting = false;
        // 复原用本地变量，而不是读回 slider.getAttribute('value')：那边只能拿到我们
        // 刚写进去的东西，多一次跨语言往返、多一个失效点。
        store = origValue;
        if (!installed) {
            // verified-or-abort：还原现场，退回 WebF 的原生表现。
            // 哨兵那一行在遮蔽没生效时是**真的写进了原生存储**，所以除了恢复描述符，
            // 还必须把原值写回去，否则输入框里会留下哨兵字符串。
            try {
                if (nativeDesc) Object.defineProperty(input, 'value', nativeDesc);
                else delete input.value;
                input.value = origValue;
            } catch (e2) { /* 还原失败也只能到此为止 */ }
            try { slider.parentNode.removeChild(slider); } catch (e3) {}
            input.removeAttribute(RANGE_MARK);
            console.warn('[songloft] range shim aborted: input.value not interceptable');
            return;
        }

        // ── ② matches(':active') 遮蔽（best-effort）───────────────────
        // 语义：拖动中 :active 为真。这是插件用来判断「用户正在操作，别用轮询结果
        // 覆盖」的标准写法，而隐藏后的 input 在 WebF 里永远不会置 isActive。
        // 装不上只损失这一条便利，不影响主流程。
        try {
            var nativeMatches = input.matches;
            if (typeof nativeMatches === 'function') {
                Object.defineProperty(input, 'matches', {
                    configurable: true,
                    writable: true,
                    value: function (selector) {
                        if (dragging && typeof selector === 'string' &&
                            selector.indexOf(':active') >= 0) return true;
                        return nativeMatches.call(input, selector);
                    }
                });
            }
        } catch (e) {
            console.warn('[songloft] range shim: matches(":active") not interceptable:', e);
        }

        // ── ③ .disabled 遮蔽（best-effort）───────────────────────────
        // 插件写 `input.disabled = !hasDevice` 要能传导到滑块。装不上就只是滑块不
        // 变灰、仍可拖，不阻塞主流程。
        try {
            var disabledState = !!input.disabled;
            Object.defineProperty(input, 'disabled', {
                configurable: true,
                get: function () { return disabledState; },
                set: function (v) {
                    disabledState = !!v;
                    if (disabledState) slider.setAttribute('disabled', '');
                    else slider.removeAttribute('disabled');
                }
            });
        } catch (e) {
            console.warn('[songloft] range shim: disabled not interceptable:', e);
        }

        // ── 隐藏原 input ─────────────────────────────────────────────
        // 加 class（样式在 webf-shims.css）**并**写 inline display：前者可被插件覆盖
        // 调试，后者保证即使 CSS 没加载上也一定隐藏。隐藏不影响取值：WebF 把 live
        // value 存在**元素**上，不在 widget state 里，所以 widget 不建也不丢。
        input.classList.add('sl-range-hidden');
        try { input.style.display = 'none'; } catch (e) {}

        // ── 滑块 → 原 input ──────────────────────────────────────────
        slider.addEventListener('input', function (e) {
            dragging = true;
            if (dragTimer) clearTimeout(dragTimer);
            dragTimer = setTimeout(function () { dragging = false; }, RANGE_DRAG_TIMEOUT_MS);
            // Dart 侧把新值塞在 event.data 里（与 WebF 自己的 <input> 同一种写法）。
            // 刻意**不做**「拿不到 data 就退回读 slider.getAttribute('value')」的兜底：
            // 那个属性只反映我们上一次**推给**滑块的值，拖动期间不会更新，拿它当兜底
            // 等于把把手往回拽。宁可这一次不同步（并留一条日志）。
            var next = (e && e.data !== undefined && e.data !== null && e.data !== '')
                ? e.data : null;
            if (next === null) {
                console.warn('[songloft] range shim: slider input event carried no data');
                return;
            }
            // 直接改 store 而不是走 input.value = ...：后者会触发上面的 setter，
            // 把值再回推给滑块，绕一圈没意义。
            store = String(next);
            fireOnInput(input, 'input');
        });
        slider.addEventListener('change', function () {
            dragging = false;
            if (dragTimer) { clearTimeout(dragTimer); dragTimer = null; }
            fireOnInput(input, 'change');
        });
    }

    var rangeSliderShim = {
        name: 'range-slider',
        apply: function () {
            var list = collectRangeInputs();
            for (var i = 0; i < list.length; i++) {
                // 逐元素兜底：页面里某个畸形 range 不该让其余的一起失去滑块
                try {
                    shimOneRange(list[i]);
                } catch (e) {
                    console.warn('[songloft] range shim skipped one element:', e);
                }
            }
        }
    };

    // ── 垫片：安全区内边距 --sl-safe-*（宿主注入，songloft-org/songloft#341）───
    //
    // WebF 不实现 `env(safe-area-inset-*)`，于是刘海屏 / 圆角屏 / 手势条上插件页会顶
    // 到状态栏或被下巴切掉。**刻意不做「把 CSS 里的 env() 自动改写成 var()」**（写入
    // 面不存在、且 env() 全套在 calc()/max() 里而 WebF 没 max）。改成「宿主只注入
    // 变量，插件作者直接写 var(--sl-safe-*)」：默认值由 theme.css 承担，这里只负责把
    // 宿主推来的真实 inset 写成 documentElement 的**内联**自定义属性（内联优先级最高）。
    var SAFE_AREA_SIDES = ['top', 'right', 'bottom', 'left'];
    // 记住最后一次收到的值：消息可能早于 DOM 就绪到达（宿主在 onLoad 回调里推），
    // 存下来由 ready 相补一次。
    var lastSafeArea = null;

    function applySafeAreaInsets(insets) {
        if (!insets || typeof insets !== 'object') return;
        lastSafeArea = insets;
        var de = document.documentElement;
        // 特性探测而不是假定：setProperty 拿不到就静默留给 ready 相重试。
        if (!de || !de.style || typeof de.style.setProperty !== 'function') return;
        for (var i = 0; i < SAFE_AREA_SIDES.length; i++) {
            var side = SAFE_AREA_SIDES[i];
            var v = insets[side];
            // 只接受有限非负数字。宿主推的是 MediaQuery.viewPadding 的逻辑像素，
            // 单位固定 px；拿到别的形态（字符串 / NaN / 负数）一律跳过而不是写进去。
            if (typeof v !== 'number' || !isFinite(v) || v < 0) continue;
            de.style.setProperty('--sl-safe-' + side, v + 'px');
        }
        // 同色板：WebF 改完根变量不会让后代重新求值（根因见 common.js 的
        // forceNestedStyleRecalc）。插件写的是 `calc(16px + var(--sl-safe-bottom))`
        // 这类**后代**声明，不补这一下，本函数在 DOM 已样式化之后调用时一个像素都不会变。
        forceStyleRecalc();
    }

    var safeAreaShim = {
        name: 'safe-area',
        apply: function () {
            // DOM 就绪后补写一次。宿主的推送时机（onLoad）与本函数的先后没有保证，
            // 没收到过值时什么都不做 —— 默认值在 theme.css 里，不需要 JS 兜。
            if (lastSafeArea) applySafeAreaInsets(lastSafeArea);
        }
    };

    // ── 垫片：input[type=file] → 宿主原生选择器（ready 段）─────────────────
    //
    // WebF 的 <input> 里 **file 落到 default → 一个 Flutter TextField**，点了什么都
    // 不会发生。验证容器实测（scripts/webf-verify 第 18 组）：
    //   ① `FileReader` / `FileList` **不存在** → 绝不能伪造 `input.files`+FileReader，
    //      这直接决定「插件必须改调用点」。
    //   ② WebF **不认 HTML `hidden` 属性**（带/不带 hidden 盒子都是 170x24）→ 垫片
    //      必须自己强制 display:none。
    //   ③ 程序化 `el.click()` **确实会**派发 DOM click 到监听器。
    //
    // 两条入口都装（③ 已通也装第二条）：真实插件是「隐藏 input + 外部按钮代点」。
    // ③ 说明只拦 click 事件在当前 WebF 版本够用，但那是无契约的实现细节；覆写实例
    // click 方法成本只有 5 行。两条互不冲突：覆写版**不调**原生 click。
    //
    // 结果经 `SongloftPlugin.lastPickedFiles`（普通 JS 数组，主通道）交给插件；派发的
    // change 事件上**尝试**挂 event.data 但那是 best-effort。刻意不派发 input 事件。
    var FILE_MARK = 'data-sl-file-shim';
    var FILE_OPT_OUT = 'data-sl-no-file-picker';
    // 载荷形态：'text'（默认）/ 'bytes'（base64）/ 'none'。插件用 data-sl-file-as 声明；
    // 不声明就是 text —— 真实用例只要文本，base64 让 20MB 文件变 ~27MB 字符串跨两次桥。
    var FILE_AS_ATTR = 'data-sl-file-as';

    function collectFileInputs() {
        var list = [];
        try {
            var found = document.querySelectorAll('input[type="file"]');
            for (var i = 0; i < found.length; i++) list.push(found[i]);
        } catch (e) {
            list = [];
        }
        if (!list.length) {
            var all = collectByTag('input');
            for (var j = 0; j < all.length; j++) {
                var t = all[j].getAttribute('type');
                if (t && t.toLowerCase() === 'file') list.push(all[j]);
            }
        }
        return list;
    }

    function shimOneFileInput(input) {
        // 幂等：applyShims 可被插件在动态插入 HTML 后重复调用
        if (input.hasAttribute(FILE_MARK)) return;
        // 插件的正式退出开关（想保留 WebF 原生表现，或自己已经处理了）
        if (input.hasAttribute(FILE_OPT_OUT)) return;
        input.setAttribute(FILE_MARK, '');

        // 隐藏原 input：见本段顶部实测事实 ②。class + inline 双保险。
        input.classList.add('sl-file-hidden');
        try { input.style.display = 'none'; } catch (e) {}

        // 一次只允许一个选择器在飞。没有这道闸时，插件那种「按钮 handler 里调
        // click()」的写法配上用户连点，会同时挂起两次宿主调用，回来的两个 change
        // 里后到的那个未必是用户最后选的文件。
        var pending = false;

        function openPicker() {
            if (pending) return;
            if (input.disabled) return;
            pending = true;
            var as = (input.getAttribute(FILE_AS_ATTR) || 'text').toLowerCase();
            invokeHost('files', 'pickFile', {
                // accept 原样透传（radio 写的是扩展名形式 '.m3u,.m3u8,.json,.txt'）——
                // 由 Dart 侧决定怎么翻译给 file_picker。
                accept: input.getAttribute('accept') || '',
                multiple: input.hasAttribute('multiple'),
                as: as
            }).then(function (res) {
                pending = false;
                var files = (res && res.files) || null;
                // 用户取消：**不派发 change**（浏览器语义也是如此）。派发一个空 change
                // 会让插件走进「读不到文件」的错误分支，弹一个用户没做错任何事的报错。
                if (!files || !files.length) return;
                try {
                    if (window.SongloftPlugin) {
                        window.SongloftPlugin.lastPickedFiles = files;
                    }
                } catch (e) { /* 主通道写不进去也还有下面的 event.data */ }
                var ev;
                try {
                    ev = new Event('change', { bubbles: true });
                } catch (e) {
                    try { ev = new Event('change'); } catch (e2) { ev = null; }
                }
                if (!ev) {
                    console.warn('[songloft] file shim: cannot construct change event');
                    return;
                }
                // best-effort：WebF 的 Event 是 binding object，挂自定义属性没有契约。
                try { ev.data = { files: files }; } catch (e) {}
                input.dispatchEvent(ev);
            }, function (err) {
                pending = false;
                console.warn('[songloft] file shim: host pickFile failed:', err);
            });
        }

        // 入口①：拦 click 事件（覆盖「用户直接点可见的 file input」）。
        input.addEventListener('click', function (e) {
            try { e.preventDefault(); } catch (e2) {}
            openPicker();
        });

        // 入口②：覆写实例 click 方法（覆盖「隐藏 input + 外部按钮 fileInput.click()」）。
        // 装不上不致命 —— 入口① 已实测可承接程序化 click，所以这里**不做**
        // verified-or-abort：两条入口是冗余而非串联。
        try {
            Object.defineProperty(input, 'click', {
                configurable: true,
                writable: true,
                value: function () { openPicker(); }
            });
        } catch (e) {
            console.warn('[songloft] file shim: click() not interceptable:', e);
        }
    }

    var filePickerShim = {
        name: 'file-picker',
        apply: function () {
            var list = collectFileInputs();
            for (var i = 0; i < list.length; i++) {
                // 逐元素兜底：页面里某个畸形 input 不该让其余的一起失去选择器
                try {
                    shimOneFileInput(list[i]);
                } catch (e) {
                    console.warn('[songloft] file shim skipped one element:', e);
                }
            }
        }
    };

    // ── 垫片：<table> 只警告不改写（ready 段）──────────────────────────────
    //
    // WebF 的标签注册表里**一个表格标签都没有**，于是 <table>/<thead>/<tbody>/<tr>/
    // <th>/<td> 全部降级为 _UnknownHTMLElement（display:block）→ 6 列的表变成
    // 「6N 行无标签文本」，sticky 表头还会互相叠住。**这个失败是完全静默的**。
    //
    // 「把 <table> 改写成 WebF 自带的 <webf-table>」已证伪（<webf-table> 只看直接
    // childNodes，thead/tbody 不拆就是空表；拆了又让插件 $('#tbody').innerHTML 抛错；
    // 列宽只认表头 column-width；colspan/rowspan 零支持会 assert）—— 改写能把「丑」
    // 变成「崩」。所以只警告，把修复责任交给唯一有能力做对的人（插件作者，改用 Grid）。
    //
    // ⚠️ **不要**顺手给 <table> 补 `display:table`：CSSDisplay 枚举里没有 table 取值，
    // resolveDisplay 落到 default 返回 inline，从 block 退化成 inline，比什么都不写更糟。
    var TABLE_MARK = 'data-sl-table-unsupported';

    var tableWarnShim = {
        name: 'table-warn',
        apply: function () {
            var list = collectByTag('table');
            var fresh = 0;
            for (var i = 0; i < list.length; i++) {
                // 幂等：applyShims 可被重复调用，不该每次刷一遍同样的 warn
                if (list[i].hasAttribute(TABLE_MARK)) continue;
                // 打标记也是页面内省的定位手段（DIAGNOSE 脚本 / 插件都能 querySelectorAll）
                list[i].setAttribute(TABLE_MARK, '');
                fresh++;
            }
            if (!fresh) return;
            console.warn('[songloft] WebF 不支持原生 <table>（会退化成纵向堆叠的 ' +
                'block，且完全静默）。请改用 CSS Grid，见插件开发指南「WebF 渲染' +
                '引擎」章节。本页命中 ' + fresh + ' 处，已标记 ' + TABLE_MARK + '。');
        }
    };

    // ── 垫片注册表 ─────────────────────────────────────────────────────────
    var earlyShims = [emptyImgSrcAccessorShim];
    var readyShims = [
        emptyImgSrcSweepShim, detailsShim, rangeSliderShim, safeAreaShim,
        filePickerShim, tableWarnShim
    ];

    function installEarly() {
        if (!isWebFEngine()) return;
        // 根 class：给 theme/components CSS 与插件 CSS 一个 WebF-only 的作用域钩子。
        // 只在这里加，所以 `html.webf-engine` 在浏览器 / 系统 WebView 下永不出现。
        try {
            document.documentElement.classList.add('webf-engine');
        } catch (e) {
            console.warn('[songloft] webf-engine root class unavailable:', e);
        }
        runShims(earlyShims, 'early');
    }

    function applyOnReady() {
        if (!isWebFEngine()) return;
        runShims(readyShims, 'ready');
    }

    installEarly();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyOnReady);
    } else {
        applyOnReady();
    }

    // 安全区消息（WebF-only；浏览器 / 系统 WebView 下 env() 原生可用，宿主也不推）。
    // try/catch：本监听器里抛出会吞掉同一条消息的后续处理，安全区失效只该是「少几
    // 像素内边距」，不该连带打掉别的消息通道。
    window.addEventListener('message', function (e) {
        if (!e.data || e.data.type !== 'songloft-safe-area') return;
        if (!isWebFEngine()) return;
        try {
            applySafeAreaInsets(e.data.insets);
        } catch (err) {
            console.warn('[songloft] safe-area apply failed:', err);
        }
    });

    // 回填 common.js 里预留的公共 API。插件用 innerHTML 动态插入内容（新的 <details>
    // / range / file 等）后调 `SongloftPlugin.applyShims()` 即可重跑 ready 段；幂等，
    // 且在浏览器 / 系统 WebView 下是彻底的 no-op。
    if (window.SongloftPlugin) {
        window.SongloftPlugin.applyShims = applyOnReady;
    }
})();
