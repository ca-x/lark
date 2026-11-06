import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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
let role = "admin";
let settings = { language: "zh-CN", theme: "apple-light", diagnostics_enabled: false, registration_enabled: false };
let preferences = {};
let sounds = { enabled: false, volume: 0.5 };
let history = { separate_by_device: false };
const writes = [];
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path.startsWith("/api/")) {
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
try {
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
} finally {
  await browser("close").catch(() => {});
  await new Promise((done) => server.close(done));
}
