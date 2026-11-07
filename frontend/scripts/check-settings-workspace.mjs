import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { themes } from "../src/constants.ts";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../../backend/web/dist");
const exec = promisify(execFile);
const session = `lark-settings-${process.pid}`;
const artifacts = process.env.LARK_SETTINGS_ARTIFACTS || `/tmp/${session}`;
await mkdir(artifacts, { recursive: true });
const browser = async (...args) => {
  const { stdout } = await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 40000, maxBuffer: 4 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  assert.ok(result.success, result.error);
  return result.data;
};
const evaluate = async (source) => (await browser("eval", source)).result;
const clickVisible = async (selector) => {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'}); true`);
  await browser("click", selector);
};
let role = "admin";
let settings = { language: "zh-CN", theme: "apple-light", diagnostics_enabled: false, registration_enabled: false };
let preferences = {};
let sounds = { enabled: false, volume: 0.5 };
let history = { separate_by_device: false };
const writes = [];
const pluginFlow = process.argv.includes("--plugin-flow-only");
const sourceFixture = { manifest: { id: "netease", name: "网易云音乐", version: "0.1.3", playback: "stream", permissions: { network: ["music.163.com"] } }, identity: "github:sogud/mygo-music-netease", origin: "https://github.com/sogud/mygo-music-netease@v0.1.3", digest: "a".repeat(64), enabled: false, exports: ["home", "search", "stream", "signIn", "signOut"] };
let mygoPlugins = [];
let pluginPlatform = { mygo: false, songloft: true };
let toolPlugins = [{ id: 1, name: "Fixture tool", description: "Frontend capability", version: "1.0.0", entry_path: "tool", status: "active", has_frontend: true, permissions: [], render_engine: "web" }];
let canceledSignIns = 0;
let failDelete = false;
const pluginDeletes = [];
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path.startsWith("/api/")) {
    if (pluginFlow) {
      let result;
      if (path === "/api/plugin-platform") {
        if (request.method === "PATCH") {
          let body = "";
          for await (const chunk of request) body += chunk;
          pluginPlatform = { ...pluginPlatform, ...JSON.parse(body) };
        }
        result = pluginPlatform;
      }
      if (path === "/api/mygo/plugins") result = { plugins: mygoPlugins };
      if (path === "/api/plugins") result = { plugins: toolPlugins };
      if (path === "/api/mygo/marketplace") result = { plugins: [{ repository: "sogud/mygo-music-netease", name: "网易云音乐", description: "QR sign-in fixture", stars: 1 }], cache: { updated_at: new Date().toISOString() } };
      if (path === "/api/mygo/preview") result = { ...sourceFixture, token: "reviewed-package" };
      if (path === "/api/mygo/install") { mygoPlugins = [structuredClone(sourceFixture)]; result = mygoPlugins[0]; }
      if (path === "/api/mygo/plugins/netease/enabled") { mygoPlugins[0].enabled = true; result = {}; }
      if (path.endsWith("/call/signIn")) { response.on("close", () => { canceledSignIns++; }); return; }
      if (path.endsWith("/prompt")) result = { qr: "https://music.163.com/login?codekey=fixture", text: "请扫码并确认登录" };
      if (path.endsWith("/call/home")) result = { title: "Fixture source home", tracks: [] };
      if (request.method === "DELETE") {
        pluginDeletes.push(path);
        if (failDelete) { response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Fixture delete failure" })); return; }
        if (path === "/api/mygo/plugins/netease") mygoPlugins = [];
        if (path === "/api/plugins/1") toolPlugins = [];
        result = {};
      }
      if (path.includes("/static/index.html")) { response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><html><body>Fixture tool</body></html>"); return; }
      if (result !== undefined) { response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result)); return; }
    }
    let payload;
    if (request.method === "PUT") {
      let body = "";
      for await (const chunk of request) body += chunk;
      payload = JSON.parse(body);
      writes.push({ path, payload });
      if (path === "/api/settings") settings = payload;
      if (path === "/api/me/preferences") preferences = payload;
      if (path === "/api/me/ui-sounds") sounds = payload;
      if (path === "/api/me/playback-history") history = payload;
    }
    const responses = {
      "/api/auth/status": { initialized: true, user: { id: 1, username: "settings-review", role } },
      "/api/settings": settings,
      "/api/me/preferences": preferences,
      "/api/me/ui-sounds": sounds,
      "/api/me/playback-history": history,
      "/api/me/scrobbling": { enabled: false, provider: "listenbrainz", endpoint: "https://api.listenbrainz.org", configured: false },
      "/api/me/mcp-token": { configured: false },
      "/api/me/subsonic": { configured: false },
      "/api/playback/queue": { queue: { song_ids: [], current_id: 0 } },
      "/api/library/stats": { songs: 0, albums: 0, artists: 0, playlists: 0 },
      "/api/library/review-summary": { incomplete_songs: 0 },
      "/api/songs/page": { items: [], total: 0, page: 1, limit: 100 },
      "/api/albums/page": { items: [], total: 0, page: 1, limit: 100 },
      "/api/artists/page": { items: [], total: 0, page: 1, limit: 100 },
      "/api/playlists/page": { items: [], total: 0, page: 1, limit: 100 },
    };
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload || responses[path] || []));
    return;
  }
  const filename = resolve(dist, `.${path === "/" ? "/index.html" : path}`);
  if (!filename.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(filename);
    response.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[extname(filename)] || "application/octet-stream" }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
const openSettings = async () => {
  await browser("open", url);
  await browser("wait", "--fn", "!!document.querySelector('.sidebar nav button[aria-label=\"设置\"],.sidebar nav button[aria-label=\"Settings\"]')");
  if (await evaluate("getComputedStyle(document.querySelector('.mobile-bottom-nav')).display !== 'none'")) {
    await browser("click", ".mobile-bottom-nav button:last-child");
    await browser("wait", "--fn", "!!document.querySelector('.mobile-my-list')");
    await browser("wait", "--fn", "!document.querySelector('.mobile-my-view').getAnimations().some(animation => animation.playState === 'running')");
    await evaluate("document.querySelector('.mobile-my-list button:nth-child(4)').scrollIntoView({block:'center'}); true");
    await browser("click", ".mobile-my-list button:nth-child(4)");
  } else {
    await evaluate("document.querySelector('.desktop-sidebar').scrollTop = document.querySelector('.desktop-sidebar').scrollHeight; true");
    await browser("click", '.desktop-sidebar nav button[aria-label="设置"],.desktop-sidebar nav button[aria-label="Settings"]');
  }
  try { await browser("wait", "--fn", "!!document.querySelector('.settings-page')"); } catch (error) {
    await browser("screenshot", `${artifacts}/navigation-failure.png`);
    console.log(await browser("snapshot", "-i"));
    throw error;
  }
};
const selectCategory = async (id) => {
  if (await evaluate("getComputedStyle(document.querySelector('.settings-category-picker')).display !== 'none'")) await browser("select", ".settings-category-picker select", id);
  else {
    await evaluate(`(() => { const target = document.querySelector('#settings-tab-${id}'); const list = target.closest('.settings-navigation'); list.scrollTop += target.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - target.getBoundingClientRect().height) / 2; return true; })()`);
    try { await browser("click", `#settings-tab-${id}`); } catch (error) {
      await browser("screenshot", `${artifacts}/category-${id}-navigation-failure.png`);
      console.log(await evaluate("[...document.querySelectorAll('.settings-sidebar,.settings-navigation,.topbar,.player,.settings-page')].map(element=>({class:element.className,bounds:element.getBoundingClientRect().toJSON(),scrollTop:element.scrollTop,clientHeight:element.clientHeight,maxHeight:getComputedStyle(element).maxHeight}))"));
      throw error;
    }
  }
  await browser("wait", "--fn", `document.querySelector('.settings-category-picker select').value === '${id}'`);
};
const checkLayout = async () => {
  const result = await evaluate(`(() => {
    const root = document.querySelector('.settings-page');
    const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const rootBounds = root.getBoundingClientRect();
    const overflow = [...root.querySelectorAll('input:not([type="file"]),select,button,code,.settings-section,.switch-row')].filter(visible).filter(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left < rootBounds.left - 2 || bounds.right > rootBounds.right + 2;
    }).map(element => element.outerHTML.slice(0,180));
    const misaligned = [...root.querySelectorAll('.switch-row')].filter(visible).filter(row => {
      const checkbox = row.querySelector(':scope > input[type="checkbox"]');
      const label = row.querySelector(':scope > span');
      if (!checkbox || !label) return false;
      const controlBounds = checkbox.getBoundingClientRect(), labelBounds = label.getBoundingClientRect();
      return Math.abs((controlBounds.top + controlBounds.bottom - labelBounds.top - labelBounds.bottom) / 2) > 2;
    }).map(element => element.textContent.slice(0,100));
    return { overflow, misaligned, settingsOverflow: rootBounds.left < -1 || rootBounds.right > innerWidth + 1, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, panels: [...document.querySelectorAll('.settings-content[role="tabpanel"][aria-labelledby]')].filter(visible).length };
  })()`);
  assert.deepEqual(result.overflow, [], "Controls must stay inside the settings column");
  assert.deepEqual(result.misaligned, [], "Switches align with multiline labels");
  assert.equal(result.settingsOverflow, false, "Settings remain within the viewport");
  assert.equal(result.pageOverflow, false, "No horizontal page scrolling");
  assert.equal(result.panels, 1, "One visible labeled settings panel");
};
const checkNavigationColors = async () => {
  await browser("set", "media", "light", "reduced-motion");
  for (const { id: theme } of themes) {
    settings = { ...settings, theme };
    await browser("set", "viewport", "1440", "900");
    await openSettings();
    await browser("wait", "--fn", `document.documentElement.dataset.theme === '${theme}'`);
    for (const width of [1440, 1024, 390]) {
      await browser("set", "viewport", String(width), "900");
      await browser("mouse", "move", "0", "0");
      const checkColors = async () => {
        const colors = await evaluate(`(() => {
          const selected = document.querySelector('.settings-navigation [aria-selected="true"]');
          const picker = document.querySelector('.settings-category-picker select');
          const compact = getComputedStyle(picker.parentElement).display !== 'none';
          const element = compact ? picker : selected.querySelector('span');
          const probe = document.createElement('span');
          probe.style.color = ${JSON.stringify(theme === "smartisan-classic" && width > 720 ? "var(--smartisan-red)" : "var(--text)")};
          element.parentElement.append(probe);
          const result = {actual:getComputedStyle(element).color,expected:getComputedStyle(probe).color};
          probe.remove();
          return result;
        })()`);
        assert.equal(colors.actual, colors.expected, `${theme} ${width}px: selected settings text uses the surface foreground, not the accent-button foreground`);
      };
      try {
        await selectCategory("account");
        await checkColors();
        await selectCategory("appearance");
        await checkColors();
        if (width === 1440 && ["deep-space", "apple-dark", "apple-light"].includes(theme)) {
          await browser("screenshot", `${artifacts}/${theme}-navigation-colors.png`);
        }
      } catch (error) {
        await browser("screenshot", `${artifacts}/${theme}-${width}-navigation-colors-failure.png`);
        throw error;
      }
    }
    console.log(`PASS ${theme}: selected settings text at desktop, tablet and phone widths`);
  }
  settings = { ...settings, theme: "apple-light" };
  await browser("set", "media", "light", "no-preference");
};
const checkWorkspace = async () => {
  const viewports = process.argv.includes("--landscape-only") ? [[844, 390]] : [[360, 780], [390, 844], [768, 1024], [1024, 768], [1440, 600], [1440, 900], [1920, 1080], [844, 390]];
  for (const [width, height] of viewports) {
    await browser("set", "viewport", String(width), String(height));
    await openSettings();
    for (const id of ["account", "appearance", "playback", "lyrics", "offline", "services", "library", "system", "users", "plugins"]) {
      await selectCategory(id);
      try { await checkLayout(); } catch (error) {
        await browser("screenshot", `${artifacts}/${width}-${height}-${id}-failure.png`, "--full");
        console.log(await evaluate("[...document.querySelectorAll('.settings-content,.library-dir-card,.library-dir-form,.library-dir-head')].map(element => ({class:element.className,width:element.getBoundingClientRect().width,columns:getComputedStyle(element).gridTemplateColumns,container:getComputedStyle(element).containerType}))"));
        throw error;
      }
      if (["appearance", "playback", "services"].includes(id)) await browser("screenshot", `${artifacts}/${width}-${height}-${id}.png`, "--full");
    }
    console.log(`PASS ${width}x${height}: ten categories, aligned controls, no overflow, one panel`);
  }
  await browser("set", "viewport", "1440", "600");
  await selectCategory("appearance");
  await browser("click", "#settings-tab-appearance");
  await browser("press", "ArrowDown");
  assert.equal(await evaluate("document.activeElement.id"), "settings-tab-playback");
  await browser("press", "End");
  assert.equal(await evaluate("document.activeElement.id"), "settings-tab-users");
  assert.ok(await evaluate("(() => {const tab=document.activeElement.getBoundingClientRect();const list=document.querySelector('.settings-navigation').getBoundingClientRect();return tab.top>=list.top-1&&tab.bottom<=list.bottom+1;})()"), "Keyboard selection stays visible in short windows");
  await browser("set", "viewport", "1440", "900");
  await selectCategory("playback");
  const actualSoundLabel = await evaluate("document.querySelector('.switch-row .ui-sound-volume').closest('.switch-row').querySelector('input[type=checkbox]').getAttribute('aria-label')");
  await browser("click", `.switch-row input[aria-label=${JSON.stringify(actualSoundLabel)}]`);
  assert.equal(sounds.enabled, true);
  assert.ok(writes.some((write) => write.path === "/api/me/ui-sounds" && write.payload.enabled));
  await selectCategory("appearance");
  await browser("click", ".settings-section:has([data-player-style]) .settings-section-head");
  await selectCategory("account");
  await browser("fill", ".settings-search input", "首页播放样式");
  await browser("wait", "--fn", "!!document.querySelector('.settings-search-results [role=option]')");
  await browser("press", "Enter");
  await browser("wait", "--fn", "document.querySelector('.settings-category-picker select').value === 'appearance' && document.activeElement.matches('[data-player-style]')");
  assert.equal(await evaluate("document.querySelector('.settings-section:has([data-player-style]) .settings-section-head').getAttribute('aria-expanded')"), "true");
  await browser("fill", ".settings-search input", "不存在的设置项");
  await browser("wait", "--fn", "!!document.querySelector('.settings-search-empty')");
  await browser("click", "#settings-category-heading");
  assert.equal(await evaluate("document.querySelector('.settings-search-results') === null"), true);
  await browser("focus", ".settings-search input");
  await browser("wait", "--fn", "!!document.querySelector('.settings-search-empty')");
  await browser("press", "Escape");
  assert.equal(await evaluate("document.querySelector('.settings-search input').value"), "");
  console.log("PASS keyboard navigation, real sound-setting writes, cross-category search, reveal/focus and empty feedback");
  for (const theme of ["apple-light", "apple-dark"]) {
    settings = { ...settings, language: "en-US", theme };
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      await evaluate("localStorage.setItem('lark-interface-scale-v1', JSON.stringify({text:100, buttons:100, linked:false})); true");
      await browser("set", "viewport", String(width), String(height));
      await openSettings();
      await selectCategory("appearance");
      await browser("focus", "#interface-text-scale");
      await browser("press", "End");
      await browser("focus", "#interface-button-scale");
      await browser("press", "End");
      await browser("wait", "--fn", "JSON.parse(localStorage.getItem('lark-interface-scale-v1')).text === 160 && JSON.parse(localStorage.getItem('lark-interface-scale-v1')).buttons === 160");
      for (const id of ["appearance", "playback", "lyrics", "services", "system"]) {
        await selectCategory(id);
        try { await checkLayout(); } catch (error) {
          await browser("screenshot", `${artifacts}/${theme}-${width}-${id}-large-failure.png`, "--full");
          console.log(await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(element=>{const bounds=element.getBoundingClientRect();return bounds.width>0&&bounds.right>innerWidth+2}).slice(0,20).map(element=>({class:element.className,width:element.getBoundingClientRect().width,right:element.getBoundingClientRect().right,zoom:getComputedStyle(element).zoom}))})"));
          throw error;
        }
      }
      await browser("screenshot", `${artifacts}/${theme}-${width}-en-large.png`, "--full");
    }
    console.log(`PASS English / 160% scale / ${theme}: viewport boundaries, settings and control alignment`);
  }
  await browser("set", "media", "light", "reduced-motion");
  await selectCategory("playback");
  assert.ok(await evaluate("[...document.querySelectorAll('.settings-content .switch-row input[type=checkbox]')].every(element => parseFloat(getComputedStyle(element, '::after').transitionDuration) < .001)"));
  console.log("PASS reduced-motion switch feedback");
  role = "user";
  await evaluate("localStorage.removeItem('lark-interface-scale-v1'); true");
  await openSettings();
  assert.deepEqual(await evaluate("[...document.querySelector('.settings-category-picker select').options].map(option => option.value)"), ["account", "appearance", "playback", "lyrics", "offline", "services"]);
  assert.equal(await evaluate("document.querySelectorAll('[data-settings-owner=system],[data-settings-owner=library]').length"), 0);
  await browser("fill", ".settings-search input", "diagnostics");
  assert.equal(await evaluate("document.querySelectorAll('.settings-search-results [role=option]').length"), 0);
  console.log(`PASS ordinary-user category and search permissions; screenshots: ${artifacts}`);
};
try {
  if (pluginFlow) {
    settings = { ...settings, theme: "spotify-dark" };
    await browser("set", "viewport", "1440", "900");
    await openSettings();
    await selectCategory("plugins");
    await browser("wait", "--fn", "!!document.querySelector('#mygo-panel-marketplace .mygo-cards button')");
    assert.equal(await evaluate("document.querySelector('#mygo-tab-marketplace').getAttribute('aria-selected')"), "true");
    assert.equal(await evaluate("document.querySelector('.mygo-manual-install').open"), false);
    await browser("click", "#mygo-panel-marketplace .mygo-cards button");
    await browser("wait", "--fn", "!!document.querySelector('dialog.mygo-preview[open]')");
    assert.equal(mygoPlugins.length, 0, "Preview must not install or execute");
    await browser("click", "dialog.mygo-preview button:last-child");
    await browser("wait", "--fn", "document.querySelector('#mygo-tab-installed').getAttribute('aria-selected') === 'true'");
    assert.equal(mygoPlugins[0].enabled, false, "Installation must not enable a source");
    assert.ok(await evaluate("document.querySelector('#mygo-panel-installed .mygo-open-source').disabled"), "Disabled sources must not open");
    await browser("click", "#mygo-panel-installed .mygo-actions button:nth-child(2)");
    await browser("wait", "--fn", "document.querySelector('#mygo-panel-installed .mygo-actions button:nth-child(2)').textContent.includes('停用')");
    assert.ok(await evaluate("document.querySelector('#mygo-panel-installed .mygo-open-source').disabled"), "An enabled plugin must not bypass the ecosystem switch");
    await clickVisible(".plugin-platform .switch-row:nth-of-type(2) input");
    await browser("wait", "--fn", "!document.querySelector('#mygo-panel-installed .mygo-open-source').disabled");
    assert.ok(await evaluate("!!document.querySelector('#mygo-panel-installed .mygo-open-source')"), "Enabled installed sources need a direct entry to their interface");
    mygoPlugins.unshift({ ...structuredClone(sourceFixture), manifest: { ...sourceFixture.manifest, id: "other-source", name: "Other source" }, identity: "fixture:other", enabled: true });
    await clickVisible("#mygo-panel-installed .mygo-open-source");
    await browser("wait", "--fn", "!!document.querySelector('.mygo-source-tabs')");
    assert.equal(await evaluate("document.querySelector('.mygo-repository select').value"), "netease");
    await browser("wait", "--fn", "document.querySelector('.mygo-panel').textContent.includes('Fixture source home')");
    mygoPlugins = mygoPlugins.filter((plugin) => plugin.manifest.id !== "other-source");
    await evaluate("window.dispatchEvent(new Event('lark:plugins-changed')); true");
    await browser("set", "viewport", "390", "844");
    await openSettings(); await selectCategory("plugins");
    await browser("click", "#mygo-tab-installed");
    await clickVisible("#mygo-panel-installed .mygo-open-source");
    await browser("wait", "--fn", "!!document.querySelector('.mygo-source-tabs')");
    assert.equal(await evaluate("document.querySelector('.mygo-repository select').value"), "netease");
    await browser("screenshot", `${artifacts}/mygo-source-entry-phone.png`);
    await browser("set", "viewport", "1440", "900");
    const openLibrary = async () => {
      await evaluate("document.querySelector('.desktop-sidebar').scrollTop=0; true");
      await browser("click", '.desktop-sidebar nav button[aria-label="曲库"]');
      await browser("wait", "--fn", "!!document.querySelector('.library-view')");
    };
    const clickLibraryTab = async (text) => { await evaluate(`(() => {const button=[...document.querySelectorAll('.library-view button')].find(button=>button.textContent===${JSON.stringify(text)});button.click();return true;})()`); };
    await openLibrary();
    await browser("wait", "--fn", "document.querySelector('.library-view').textContent.includes('音乐源') && document.querySelector('.library-view').textContent.includes('插件工具')");
    await clickLibraryTab("插件工具");
    await browser("click", ".mygo-catalog button");
    await browser("wait", "--fn", "!!document.querySelector('.plugin-surface iframe')");
    assert.ok(await evaluate("document.querySelector('.plugin-surface iframe').src.includes('/api/v1/jsplugin/tool/static/index.html')"));
    await clickLibraryTab("音乐源");
    await browser("click", ".mygo-source-tabs button:first-child");
    await browser("wait", "--fn", "document.querySelector('.mygo-panel').textContent.includes('Fixture source home')");
    await evaluate("[...document.querySelectorAll('.mygo-source-tabs button')].find(button=>button.textContent==='登录音乐源').click(); true");
    await browser("wait", "--fn", "!!document.querySelector('.mygo-signin-qr')");
    assert.ok(await evaluate("document.querySelector('.mygo-signin-qr').src.startsWith('data:image/gif;base64,')"), "QR must be generated locally");
    await browser("screenshot", `${artifacts}/mygo-qr-desktop.png`);
    await browser("set", "viewport", "390", "844");
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth+1"));
    await browser("screenshot", `${artifacts}/mygo-qr-phone.png`);
    await browser("click", ".mygo-signin-prompt button");
    await browser("wait", "--fn", "!document.querySelector('.mygo-signin-prompt')");
    assert.ok(canceledSignIns >= 1, "Cancel must abort the login request");
    await browser("set", "viewport", "1440", "900");
    await openSettings(); await selectCategory("plugins");
    await browser("click", "#mygo-tab-installed");
    await clickVisible("#mygo-panel-installed .icon-danger");
    await browser("wait", "--fn", "!!document.querySelector('dialog.confirm-action-dialog[open]')");
    assert.ok(await evaluate("document.activeElement === document.querySelector('dialog.confirm-action-dialog button')"), "Cancel initially receives focus");
    await browser("press", "Escape");
    assert.equal(pluginDeletes.length, 0);
    assert.ok(await evaluate("document.activeElement === document.querySelector('#mygo-panel-installed .icon-danger')"), "Cancel restores trigger focus");
    await clickVisible("#mygo-panel-installed .icon-danger");
    failDelete = true;
    await browser("click", "dialog.confirm-action-dialog button:last-child");
    await browser("wait", "--fn", "!!document.querySelector('dialog.confirm-action-dialog [role=alert]')");
    failDelete = false;
    await browser("click", "dialog.confirm-action-dialog button:last-child");
    await browser("wait", "--fn", "!document.querySelector('dialog.confirm-action-dialog')");
    await clickVisible('.plugin-settings button[aria-label="删除插件"]');
    await browser("wait", "--fn", "!!document.querySelector('dialog.confirm-action-dialog[open]')");
    await browser("click", "dialog.confirm-action-dialog button:last-child");
    await browser("wait", "--fn", "!document.querySelector('dialog.confirm-action-dialog')");
    await openLibrary();
    await browser("wait", "--fn", "document.querySelector('.library-tabs button').classList.contains('active')");
    assert.ok(await evaluate("![...document.querySelectorAll('.library-view button')].some(button=>['音乐源','插件工具'].includes(button.textContent))"), "No usable capability means no tab");
    assert.equal(toolPlugins.length, 0);
    assert.equal(mygoPlugins.length, 0);
    console.log(`PASS marketplace install, permission preview, disabled default, ecosystem switch gating, installed-source direct entry, capability tabs/tool page, local QR, phone layout, login cancellation, custom deletion/failure/retry/focus and stale-tab fallback; screenshots: ${artifacts}`);
  } else if (process.argv.includes("--plugin-layout-only")) {
    settings = { ...settings, theme: "spotify-dark" };
    for (const [width, height] of [[2048, 1127], [1440, 900], [1024, 768], [390, 844]]) {
      await browser("set", "viewport", String(width), String(height));
      await openSettings();
      await selectCategory("plugins");
      await checkLayout();
      const geometry = await evaluate(`(() => { const bounds = selector => document.querySelector(selector).getBoundingClientRect().toJSON(); return { viewport: innerHeight, shell: bounds('.app-shell'), main: bounds('.main'), player: bounds('footer.player'), scroll: document.documentElement.scrollHeight }; })()`);
      console.log(JSON.stringify({ width, height, geometry }));
      await browser("screenshot", `${artifacts}/${width}-${height}-plugins.png`);
      assert.ok(Math.abs(geometry.shell.bottom - height) <= 1, "Shell must fit viewport");
      if (width > 720) assert.ok(Math.abs(geometry.player.bottom - height) <= 1, "Player must remain flush with viewport bottom");
      if (width >= 1440) assert.ok(geometry.scroll <= height + 1, "Decorative glow must not create document overflow");
      if (width > 720) {
        preferences = { home_player_style: "vinyl-collection" };
        await browser("open", url);
        await browser("wait", "--fn", "!!document.querySelector('.vinyl-collection-player')");
        await browser("wait", "--fn", "parseFloat(document.querySelector('.vinyl-collection-player').style.getPropertyValue('--vc-unit')) > 0");
        const home = await evaluate("({height:document.querySelector('.main').clientHeight,scroll:document.querySelector('.main').scrollHeight,documentScroll:document.scrollingElement.scrollHeight})");
        console.log(JSON.stringify({ width, height, home }));
        await browser("screenshot", `${artifacts}/${width}-${height}-vinyl.png`);
        if (width >= 1440 && home.scroll > home.height + 1) console.log(await evaluate(`[...document.querySelectorAll('.main,.home-view,.home-player-hero,.vinyl-collection-player,.vc-listening-room,.vc-shelf,.vc-deck,.vc-sleeve-stage,.topbar')].map(el=>({class:el.className,rect:el.getBoundingClientRect().toJSON(),height:el.offsetHeight,scroll:el.scrollHeight,unit:el.style.getPropertyValue('--vc-unit'),padding:getComputedStyle(el).padding,margin:getComputedStyle(el).margin,border:getComputedStyle(el).borderWidth}))`));
        if (width >= 1440) assert.ok(home.scroll <= home.height + 1, "Fitted vinyl scene must not cause a spurious scrollbar");
        if (width >= 1440) assert.ok(home.documentScroll <= height + 1);
      }
    }
  } else {
    await checkNavigationColors();
    if (!process.argv.includes("--navigation-colors-only")) await checkWorkspace();
  }
} finally {
  await browser("close").catch(() => {});
  await new Promise((done) => server.close(done));
}
