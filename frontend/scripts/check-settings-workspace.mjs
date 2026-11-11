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
const lyricsFlow = process.argv.includes("--lyrics-flow-only");
let lyricCandidateRequests = 0;
let failLyricsSettingsSave = false;
const sourceArtwork = process.env.LARK_MYGO_ARTWORK_FIXTURE ? await readFile(process.env.LARK_MYGO_ARTWORK_FIXTURE) : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=", "base64");
const sourceFixture = { manifest: { id: "netease", name: "网易云音乐", version: "0.1.3", playback: "stream", permissions: { network: ["music.163.com"] } }, identity: "github:sogud/mygo-music-netease", origin: "https://github.com/sogud/mygo-music-netease@v0.1.3", digest: "a".repeat(64), enabled: false, exports: ["account", "home", "search", "stream", "signIn", "signOut"] };
let mygoPlugins = [];
let pluginPlatform = { mygo: false, songloft: true };
let toolPlugins = [{ id: 1, name: "Fixture tool", description: "Frontend capability", version: "1.0.0", entry_path: "tool", status: "active", has_frontend: true, permissions: [], render_engine: "web" }];
let canceledSignIns = 0;
let sourceAccount = null;
let pendingSourceSignIn = null;
let sourceTracks = [];
let sourceCollections = [];
let sourcePlaylistPage = null;
let sourcePlaylistCalls = 0;
let streamRequests = 0;
let streamFailure = true;
let failAccount = false;
let sourceIntegrationFixture = false;
let sourceQueue = null;
const sourceHistory = [];
const sourceCalls = [];
const pluginRequests = [];
const toolSongs = [1, 2, 3].map(id => ({ id, title: `Tool fixture ${id}`, artist: "Fixture", album: "Fixture", duration_seconds: 2, favorite: false, source_type: "local", path: `fixture-${id}.wav`, file_name: `fixture-${id}.wav`, format: "wav", mime: "audio/wav" }));
const localCatalogSong = { ...toolSongs[0], title: "Playback local fixture", artist_id: 31, artist: "Local catalog artist", album_id: 41, album: "Local catalog album" };
const localCatalogAlbum = { id: 41, title: localCatalogSong.album, artist: localCatalogSong.artist, album_artist: localCatalogSong.artist, artist_id: 31, year: 2026, song_count: 1, favorite: false };
const sourceAudio = Buffer.alloc(44 + 32000);
sourceAudio.write("RIFF", 0); sourceAudio.writeUInt32LE(sourceAudio.length - 8, 4); sourceAudio.write("WAVEfmt ", 8);
sourceAudio.writeUInt32LE(16, 16); sourceAudio.writeUInt16LE(1, 20); sourceAudio.writeUInt16LE(1, 22);
sourceAudio.writeUInt32LE(8000, 24); sourceAudio.writeUInt32LE(16000, 28); sourceAudio.writeUInt16LE(2, 32); sourceAudio.writeUInt16LE(16, 34);
sourceAudio.write("data", 36); sourceAudio.writeUInt32LE(32000, 40);
const sourceIntegrationAudio = Buffer.alloc(44 + 30 * 16000);
sourceAudio.copy(sourceIntegrationAudio, 0, 0, 44);
sourceIntegrationAudio.writeUInt32LE(sourceIntegrationAudio.length - 8, 4);
sourceIntegrationAudio.writeUInt32LE(sourceIntegrationAudio.length - 44, 40);
let failDelete = false;
const pluginDeletes = [];
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path.startsWith("/api/")) {
    if (lyricsFlow) {
      if (path === "/api/settings" && request.method === "PUT" && failLyricsSettingsSave) {
        response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Fixture unavailable" })); return;
      }
      let result;
      if (path === "/api/playback/queue" && request.method === "GET") result = { queue: { song_ids: [1], current_id: 1 } };
      if (path === "/api/songs/page") result = { items: [{ ...localCatalogSong, duration_seconds: 30 }], total: 1, page: 1, limit: 100 };
      if (path === "/api/songs/1/lyrics") result = { song_id: 1, source: "embedded", lyrics: "[00:00.00]让旋律慢慢流淌\n[00:10.00]把此刻留在歌里" };
      if (path === "/api/songs/1/lyrics/candidates") { lyricCandidateRequests++; result = [{ id: "42", title: "让旋律慢慢流淌", artist: "测试歌手", source: "fixture" }]; }
      if (path === "/api/songs/1/lyrics/select") result = { song_id: 1, source: "fixture", lyrics: "[00:00.00]选择的歌词" };
      if (path === "/api/songs/1/stream") {
        const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), sourceIntegrationAudio.length - 1) : sourceIntegrationAudio.length - 1;
        response.writeHead(range ? 206 : 200, { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...(range ? { "Content-Range": `bytes ${start}-${end}/${sourceIntegrationAudio.length}` } : {}) }).end(sourceIntegrationAudio.subarray(start, end + 1)); return;
      }
      if (result !== undefined) { response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result)); return; }
    }
    if (pluginFlow) {
      pluginRequests.push({ path, method: request.method });
      let result;
      if (path === "/api/mygo/history" && request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const payload = JSON.parse(body);
        writes.push({ path, payload });
        const previous = sourceHistory.findIndex(entry => entry.song.id === payload.song.id);
        const timestamp = new Date().toISOString();
        const entry = { id: previous >= 0 ? sourceHistory[previous].id : 1000 + sourceHistory.length, ...payload, played_at: timestamp, updated_at: timestamp, progress_seconds: payload.progress_seconds || 0, duration_seconds: payload.duration_seconds || payload.song.duration_seconds, completed: payload.completed || false, device_type: "desktop" };
        if (previous >= 0) sourceHistory.splice(previous, 1);
        sourceHistory.unshift(entry);
        result = {};
      }
      if (path === "/api/mygo/queue" && request.method === "GET") result = sourceQueue;
      if (path === "/api/playback/history") result = [...sourceHistory, ...(sourceIntegrationFixture ? [{ id: 1, song: localCatalogSong, played_at: new Date().toISOString(), updated_at: new Date().toISOString(), progress_seconds: 0, duration_seconds: 2, completed: false, device_type: "desktop" }] : [])];
      if (path === "/api/songs/recent-played") result = [...sourceHistory.map(entry => entry.song), ...(sourceIntegrationFixture ? [localCatalogSong] : [])];
      if (/\/call\/(search|album|artist)$/.test(path)) {
        let body = "";
        for await (const chunk of request) body += chunk;
        const params = JSON.parse(body);
        const method = path.split("/").at(-1);
        sourceCalls.push({ method, params, identity: new URL(request.url, "http://localhost").searchParams.get("identity") });
        result = { title: `Fixture source ${method}`, tracks: sourceTracks.slice(0, 1), more: false };
      }
      if (sourceIntegrationFixture && path === "/api/songs") result = [localCatalogSong];
      if (sourceIntegrationFixture && path === "/api/songs/page") result = { items: [localCatalogSong], total: 1, offset: 0, page: 1, limit: Number(new URL(request.url, "http://localhost").searchParams.get("limit")) || 100 };
      if (sourceIntegrationFixture && path === "/api/albums/page") result = { items: [localCatalogAlbum], total: 1, offset: 0, page: 1, limit: Number(new URL(request.url, "http://localhost").searchParams.get("limit")) || 100 };
      if (sourceIntegrationFixture && path === "/api/albums/41/songs") result = [localCatalogSong];
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
      if (path.endsWith("/call/signIn")) { pendingSourceSignIn = response; response.on("close", () => { canceledSignIns++; }); return; }
      if (path.endsWith("/call/account")) {
        if (failAccount) { response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Fixture account check unavailable" })); return; }
        result = sourceAccount;
      }
      if (path.endsWith("/call/signOut")) { sourceAccount = null; result = null; }
      if (path.endsWith("/prompt")) result = { qr: "https://music.163.com/login?codekey=fixture", text: "请扫码并确认登录" };
      if (path.endsWith("/call/home")) result = { title: "Fixture source home", tracks: sourceTracks, playlists: sourceCollections };
      if (path.endsWith("/call/playlist")) {
        sourcePlaylistCalls++;
        result = sourcePlaylistPage || { title: "Fixture playlist", tracks: sourceTracks };
      }
      if (path.endsWith("/image")) {
        const broken = new URL(request.url, "http://localhost").searchParams.get("url")?.includes("broken");
        response.writeHead(broken ? 502 : 200, { "Content-Type": process.env.LARK_MYGO_ARTWORK_FIXTURE ? "image/jpeg" : "image/png" }).end(broken ? "unavailable" : sourceArtwork); return;
      }
      if (path === "/api/v1/playlists/1") result = { id: 1, type: "normal", name: "收藏" };
      if (path === "/api/v1/playlists/1000000001") result = { id: 1000000001, type: "normal", name: "Ordinary fixture" };
      if (path === "/api/v1/playlists/1/songs") result = { items: toolSongs.filter(song => song.favorite) };
      if (path === "/api/v1/playlists/2") { response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({message:"legacy playlist ID; reload playlists"})); return; }
      if (path === "/api/mygo/plugins/netease/stream") {
        streamRequests++;
        if (streamFailure) { response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "unavailable: fixture track cannot be played" })); return; }
        const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        const audio = sourceIntegrationFixture ? sourceIntegrationAudio : sourceAudio;
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
        response.writeHead(range ? 206 : 200, { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...(range ? { "Content-Range": `bytes ${start}-${end}/${audio.length}` } : {}) }).end(audio.subarray(start, end + 1)); return;
      }
      if (request.method === "DELETE" && /^\/api\/(mygo\/)?plugins\//.test(path)) {
        pluginDeletes.push(path);
        if (failDelete) { response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Fixture delete failure" })); return; }
        if (path === "/api/mygo/plugins/netease") mygoPlugins = [];
        if (path === "/api/plugins/1") toolPlugins = [];
        result = {};
      }
      if (path === "/api/v1/jsplugin-assets/common.js") { response.writeHead(200, { "Content-Type": "text/javascript" }).end(await readFile(new URL("../../backend/internal/api/pluginassets/common.js", import.meta.url))); return; }
      if (path.includes("/static/index.html")) { response.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><html><body>Fixture tool<script src="/api/v1/jsplugin-assets/common.js"></script><script>window.states=[];SongloftPlugin.player.onStateChange(state=>window.states.push(state));</script></body></html>'); return; }
      if (/^\/api\/songs\/\d+$/.test(path)) result = toolSongs.find(song => song.id === Number(path.split("/").at(-1)));
      if (/^\/api\/songs\/\d+\/stream$/.test(path)) { response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": sourceAudio.length }).end(sourceAudio); return; }
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
      if (path === "/api/mygo/queue") sourceQueue = payload;
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
      "/api/songs/page": { items: pluginFlow && new URL(request.url, "http://localhost").searchParams.get("favorites") === "true" ? toolSongs.filter(song => song.favorite) : [], total: pluginFlow ? toolSongs.filter(song => song.favorite).length : 0, page: 1, limit: 100 },
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
const openPlayingLyrics = async () => {
  await browser("click", '.desktop-sidebar nav button[aria-label="曲库"]');
  await browser("wait", "--fn", "!!document.querySelector('.song-row-play')");
  await browser("click", '.song-row-play');
  await browser("wait", "--fn", "!!document.querySelector('.player button[aria-label=\"暂停\"]')");
  await browser("click", '.player button[aria-label="歌词"]');
  await browser("wait", "--fn", "!!document.querySelector('.full-lyrics .lyrics-actions')");
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
  if (lyricsFlow) {
    await browser("set", "viewport", "1440", "900");
    await browser("open", url);
    await evaluate("localStorage.setItem('lark.persistent-queue-enabled', 'true'); true");
    await openSettings();
    await selectCategory("lyrics");
    await browser("wait", "--fn", "!!document.querySelector('.lyrics-font-preview')");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"内置在线歌词搜索\"]').checked"), true);
    await browser("screenshot", `${artifacts}/lyrics-settings-light.png`);
    for (const [width, height] of [[320, 740], [768, 1024], [1440, 900]]) {
      await browser("set", "viewport", String(width), String(height));
      await checkLayout();
      await evaluate("document.querySelector('.lyrics-type-settings').scrollIntoView({block:'center'}); true");
      await browser("screenshot", `${artifacts}/lyrics-typography-${width}.png`);
    }
    await clickVisible('[aria-label="内置在线歌词搜索"]');
    await browser("wait", "--fn", "!document.querySelector('[aria-label=\"内置在线歌词搜索\"]').checked");
    assert.ok(writes.some(write => write.path === "/api/settings" && write.payload.online_lyrics_enabled === false));
    await openSettings();
    await selectCategory("lyrics");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"内置在线歌词搜索\"]').checked"), false, "Switch survives reload");
    await openPlayingLyrics();
    assert.equal(await evaluate("!!document.querySelector('.full-lyrics [aria-label=\"选择歌词\"]')"), false);
    await browser("click", '.lyrics-actions button[aria-label="歌词偏移"]');
    await browser("wait", "--fn", "!!document.querySelector('#lyrics-offset-panel')");
    await browser("click", '#lyrics-offset-panel button[aria-label="+100 ms"]');
    assert.ok((await evaluate("document.querySelector('#lyrics-offset-panel output').textContent")).includes("100"));
    await browser("screenshot", `${artifacts}/lyrics-tools-disabled.png`);
    assert.equal(lyricCandidateRequests, 0, "Disabled tools must never request candidates");
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [1440, 900]]) {
      await browser("set", "viewport", String(width), String(height));
      await browser("wait", "--fn", "!document.querySelector('.lyrics-tools').getAnimations().some(animation => animation.playState === 'running')");
      const bounds = await evaluate("(() => { const panel=document.querySelector('.lyrics-tools'); return {width:panel.clientWidth,scroll:panel.scrollWidth,document:document.scrollingElement.scrollWidth,viewport:innerWidth}; })()");
      assert.ok(bounds.scroll <= bounds.width + 1, `Tools horizontal overflow ${width}: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.document <= bounds.viewport + 1);
      await browser("screenshot", `${artifacts}/lyrics-offset-${width}.png`);
    }
    await browser("set", "viewport", "1440", "900");
    settings = { ...settings, theme: "apple-dark" };
    await openSettings();
    await selectCategory("lyrics");
    assert.equal(await evaluate("document.documentElement.dataset.theme"), "apple-dark");
    await browser("wait", "--fn", "getComputedStyle(document.querySelector('.lyrics-style-control button.active')).color === getComputedStyle(document.querySelector('.lyrics-settings-heading strong')).color");
    await clickVisible('[aria-label="内置在线歌词搜索"]');
    await browser("screenshot", `${artifacts}/lyrics-settings-dark.png`);
    await openPlayingLyrics();
    await browser("click", '.lyrics-actions button[aria-label="选择歌词"]');
    await browser("wait", "--fn", "!!document.querySelector('.lyrics-candidate-item')");
    assert.equal(lyricCandidateRequests, 1);
    await browser("click", '#lyrics-candidates-tab');
    await browser("press", "ArrowRight");
    assert.equal(await evaluate("document.activeElement.id"), "lyrics-offset-tab");
    await browser("press", "Home");
    assert.equal(await evaluate("document.activeElement.id"), "lyrics-candidates-tab");
    await browser("screenshot", `${artifacts}/lyrics-candidates-dark.png`);
    await browser("click", '.full-lyrics-cover-button');
    await browser("click", '.desktop-sidebar nav button[aria-label="设置"]');
    await selectCategory("lyrics");
    await evaluate("document.querySelector('audio').currentTime = 12; document.querySelector('audio').dispatchEvent(new Event('timeupdate')); true");
    await browser("wait", "--fn", "document.querySelector('audio').currentTime >= 11.5 && !document.querySelector('audio').seeking");
    await clickVisible('[aria-label="内置在线歌词搜索"]');
    await browser("wait", "--fn", "!document.querySelector('[aria-label=\"内置在线歌词搜索\"]').checked && !document.querySelector('[aria-label=\"内置在线歌词搜索\"]').disabled");
    assert.ok(await evaluate("document.querySelector('audio').currentTime >= 11.5"), "Capability changes must not reset audio progress");
    failLyricsSettingsSave = true;
    await clickVisible('[aria-label="内置在线歌词搜索"]');
    await browser("wait", "--fn", "!document.querySelector('[aria-label=\"内置在线歌词搜索\"]').disabled");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"内置在线歌词搜索\"]').checked"), false, "Failed save must not enable search");
    failLyricsSettingsSave = false;
    role = "member";
    await openSettings();
    await selectCategory("lyrics");
    assert.equal(await evaluate("!!document.querySelector('[aria-label=\"内置在线歌词搜索\"]')"), false);
    assert.ok(await evaluate("!!document.querySelector('[data-settings-owner=\"lyrics\"]')"), "Personal lyric settings remain available");
    console.log(`PASS online lyrics default, save/reload, disabled entry, offset controls, no disabled request, reenable, keyboard tabs, member access, responsive layout and dark contrast; screenshots: ${artifacts}`);
  } else if (pluginFlow) {
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
    assert.equal(await evaluate("document.querySelector('.mygo-source-picker [aria-current=true]').dataset.source"), "netease");
    assert.equal(await evaluate("document.querySelectorAll('.mygo-source-picker button').length"), 2);
    assert.equal(await evaluate("document.querySelectorAll('.mygo-source-picker select, .mygo-source-picker input').length"), 0);
    await browser("wait", "--fn", "document.querySelector('.mygo-panel').textContent.includes('Fixture source home')");
    assert.ok(await evaluate("!!document.querySelector('.mygo-account-status')"), "Sources must display persistent account status");
    await browser("wait", "--fn", "document.querySelector('.mygo-account-status').textContent.includes('未登录')");
    await browser("fill", ".mygo-source-search input", "source-private query");
    await browser("click", '.mygo-source-picker button[data-source="other-source"]');
    await browser("wait", "--fn", "document.querySelector('.mygo-source-heading h3').textContent==='Other source'");
    assert.equal(await evaluate("document.querySelector('.mygo-source-search input').value"), "");
    assert.ok(await evaluate("document.activeElement === document.querySelector('.mygo-source-picker [data-source=\"other-source\"]')"), "Switching sources must retain navigation focus");
    await browser("press", "Tab");
    await browser("press", "Enter");
    await browser("wait", "--fn", "document.querySelector('.mygo-source-heading h3').textContent==='网易云音乐'");
    mygoPlugins = mygoPlugins.filter((plugin) => plugin.manifest.id !== "other-source");
    await evaluate("window.dispatchEvent(new Event('lark:plugins-changed')); true");
    await browser("set", "viewport", "390", "844");
    await openSettings(); await selectCategory("plugins");
    await browser("click", "#mygo-tab-installed");
    await clickVisible("#mygo-panel-installed .mygo-open-source");
    await browser("wait", "--fn", "!!document.querySelector('.mygo-source-tabs')");
    assert.equal(await evaluate("document.querySelector('.mygo-source-picker [aria-current=true]').dataset.source"), "netease");
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
    await browser("wait", "--fn", "!!document.querySelector('.plugin-surface iframe').contentWindow.SongloftPlugin");
    const inTool = async expression => evaluate(`(async () => { const tool = document.querySelector('.plugin-surface iframe').contentWindow; const sdk = tool.SongloftPlugin; return ${expression}; })()`);
    assert.equal(await inTool("typeof sdk.invokeHost"), "function");
    assert.equal(await inTool("typeof sdk.favorite?.refresh"), "function");
    await browser("click", ".plugin-surface-title");
    await inTool("sdk.player.setQueue([1,2,3],{startIndex:0,sourcePlaylistId:1000000001})");
    await browser("wait", "--fn", "document.querySelector('.plugin-surface iframe').contentWindow.states.some(state=>state.current_time>0.05)");
    await inTool("sdk.player.pause()");
    assert.equal((await inTool("sdk.player.getState()")).source_playlist_id, 1000000001);
    assert.ok(writes.some(write => write.path === "/api/playback/queue" && write.payload.source?.type === "playlist" && write.payload.source.source_id === 1), "Compatibility playlist IDs must persist as native source IDs");
    assert.match(await inTool("sdk.player.setQueue([1],{sourcePlaylistId:2}).then(()=>'',error=>error.message)"), /legacy playlist ID/);
    await inTool("sdk.player.reorderQueue(1,2)");
    await browser("wait", "--fn", "document.querySelector('.plugin-surface iframe').contentWindow.states.at(-1)?.queue[1]?.id===3");
    toolSongs[0].favorite = true;
    await inTool("sdk.favorite.refresh(1,true)");
    await browser("wait", "--fn", "document.querySelector('.plugin-surface iframe').contentWindow.states.at(-1)?.current_song?.favorite===true");
    await inTool("sdk.player.playPlaylistById(1)");
    await inTool("sdk.player.pause()");
    assert.equal((await inTool("sdk.player.getState()")).source_playlist_id, null, "Favorites must never resume from native ordinary playlist 1");
    toolSongs[0].favorite = false;
    await inTool("sdk.favorite.refresh()");
    await browser("wait", "--fn", "document.querySelector('.plugin-surface iframe').contentWindow.states.at(-1)?.current_song?.favorite===false");
    await inTool("sdk.player.clearQueue()");
    await clickLibraryTab("音乐源");
    await browser("click", ".mygo-source-tabs button:first-child");
    await browser("wait", "--fn", "document.querySelector('.mygo-panel').textContent.includes('Fixture source home')");
    await browser("click", ".mygo-sign-in");
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
    await browser("click", ".mygo-sign-in");
    await browser("wait", "--fn", "!!document.querySelector('.mygo-signin-qr')");
    sourceAccount = { id: "fixture-listener", name: "Fixture signed-in listener" };
    pendingSourceSignIn.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(sourceAccount));
    await browser("wait", "--fn", "document.querySelector('.mygo-account-status')?.dataset.state === 'signed-in'");
    assert.ok(await evaluate("document.querySelector('.mygo-account-status').textContent.includes('Fixture signed-in listener')"));
    await openSettings(); await selectCategory("plugins");
    await browser("click", "#mygo-tab-installed");
    await clickVisible("#mygo-panel-installed .mygo-open-source");
    await browser("wait", "--fn", "document.querySelector('.mygo-account-status')?.dataset.state === 'signed-in'");
    failAccount = true;
    await browser("click", ".mygo-account-status button");
    await browser("wait", "--fn", "document.querySelector('.mygo-account-status')?.dataset.state === 'unknown'");
    assert.ok(await evaluate("!document.querySelector('.mygo-account-status').textContent.includes('未登录')"), "Account lookup failure must not falsely report signed out");
    failAccount = false;
    await browser("click", ".mygo-account-status button");
    await browser("wait", "--fn", "document.querySelector('.mygo-account-status')?.dataset.state === 'signed-in'");
    sourceTracks = [
      { id: "playback-fixture", name: "Playback fixture", duration: 2000, artists: [{ id: "artist", name: "Fixture artist" }], album: { id: "album", name: "Fixture album", imageUrl: "/api/mygo/plugins/netease/image?url=https%3A%2F%2Fpublic-cdn.example%2Fcover.jpg&identity=fixture&proof=fixture" } },
      { id: "missing-artwork", name: "A long track title that should truncate without pushing the playback controls outside the viewport", duration: 2000, artists: [] },
      { id: "broken-artwork", name: "Broken artwork fallback", duration: 2000, album: { id: "broken", name: "Broken", imageUrl: "https://public-cdn.example/broken.jpg" } },
    ];
    mygoPlugins[0].exports.push("playlist", "liked", "playlists", "createPlaylist");
    sourceCollections = [
      { id: "collection", name: "Fixture playlist with artwork", imageUrl: sourceTracks[0].album.imageUrl },
      { id: "collection-empty", name: "Playlist without artwork" },
    ];
    await evaluate("window.dispatchEvent(new Event('lark:plugins-changed')); true");
    await browser("click", ".mygo-source-tabs button:first-child");
    await browser("wait", "--fn", "!!document.querySelector('.mygo-tracks li') && !document.querySelector('.mygo-tracks button').disabled");
    await browser("wait", "--fn", "document.querySelector('.mygo-tracks img')?.naturalWidth > 0 && document.querySelectorAll('.mygo-tracks .mygo-artwork > svg').length===2");
    assert.ok(await evaluate("!document.querySelector('.mygo-tracks img').src.includes('url=%2Fapi')"), "Signed artwork references must not be double-proxied");
    assert.ok(await evaluate("!document.querySelector('.mygo-playlist-tools').open"), "Secondary playlist actions must be collapsed by default");
    await browser("wait", "--fn", "document.querySelector('.mygo-collections img')?.naturalWidth > 0");
    await clickVisible(".mygo-collection-button:first-child");
    await browser("wait", "--fn", "document.querySelector('.mygo-source-content h4').textContent==='Fixture playlist'");
    assert.equal(await evaluate("document.querySelector('.mygo-play-all').textContent"), "全部播放");
    await browser("click", ".mygo-source-tabs button:first-child");
    await browser("wait", "--fn", "document.querySelector('.mygo-source-content h4').textContent==='Fixture source home'");
    assert.equal(await evaluate("document.querySelector('.mygo-source-tabs [aria-current=page]').textContent"), "首页");
    assert.equal(await evaluate("document.querySelector('.mygo-play-all')"), null, "Playlist playback must not appear on source home");
    for (const theme of ["spotify-dark", "apple-light"]) {
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}; true`);
      for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 740]]) {
        await browser("set", "viewport", String(width), String(height));
        assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth+1"), `${theme}/${width}: sources must not overflow the viewport`);
        assert.ok(await evaluate("[...document.querySelectorAll('.mygo-track-actions button')].every(button=>button.getBoundingClientRect().width >= 44)"));
        assert.ok(await evaluate("document.querySelector('.mygo-source-search input').getBoundingClientRect().width > document.querySelector('.mygo-source-search button').getBoundingClientRect().width"), "The search field must retain usable width on phones");
        await browser("screenshot", `${artifacts}/mygo-sources-${theme}-${width}.png`);
      }
    }
    await browser("set", "media", "dark", "reduced-motion");
    assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('.mygo-source-picker button')).transitionDuration) < .001"));
    await browser("set", "media", "dark", "no-preference");
    await browser("set", "viewport", "1440", "900");
    await clickVisible(".mygo-tracks li button:first-child");
    await browser("wait", "--fn", "!!document.querySelector('audio').error");
    assert.ok(streamRequests > 0, "Browser playback must request the plugin audio endpoint");
    await browser("wait", "--fn", "!document.querySelector('.player').textContent.includes('正在缓冲') && !!document.querySelector('.player button[aria-label=\"播放\"]')");
    assert.ok(await evaluate("document.body.textContent.includes('音乐源播放失败')"), "Terminal source errors must be visible instead of buffering forever");
    const failedStreamRequests = streamRequests;
    streamFailure = false;
    await browser("click", '.player .transport .play[aria-label="播放"]');
    await browser("wait", "--fn", "!document.querySelector('audio').error && document.querySelector('audio').currentTime > 0.05 && !document.querySelector('audio').paused");
    await browser("wait", "--fn", "document.querySelector('.player').style.getPropertyValue('--cover-url').includes('/api/mygo/plugins/netease/image?')");
    assert.ok(streamRequests > failedStreamRequests, "Retrying with the footer play button must reload the failed media request");
    await browser("screenshot", `${artifacts}/mygo-signed-in-playback.png`);
    await evaluate("document.querySelector('audio').pause(); true");
    streamFailure = true;
    const playlistTracks = sourceTracks.map(track => ({ ...track, id: `playlist-${track.id}` }));
    sourcePlaylistPage = {
      title: "A long source playlist title that must wrap without squeezing playback controls",
      tracks: [{ id: "unavailable", name: "Unavailable track", duration: 2000, unavailable: true }, ...playlistTracks],
      more: true,
    };
    await clickVisible(".mygo-collection-button:first-child");
    await browser("wait", "--fn", "document.querySelector('.mygo-play-all')?.textContent === '播放已加载' && !document.querySelector('.mygo-play-all').disabled");
    const playlistCallsBeforePlay = sourcePlaylistCalls;
    const writesBeforePlay = writes.length;
    await browser("click", ".mygo-play-all");
    await browser("wait", "--fn", "!!document.querySelector('audio').error");
    const savedSourceQueue = () => writes.slice(writesBeforePlay).filter(write => write.path === "/api/mygo/queue" && write.payload?.songs).at(-1)?.payload;
    assert.deepEqual(savedSourceQueue().songs.map(song => song.mygo.track), playlistTracks.map(track => track.id), "Play loaded must preserve order and skip unavailable tracks");
    assert.equal(savedSourceQueue().current, savedSourceQueue().songs[0].id, "Playlist playback must start at the first playable track");
    assert.ok(savedSourceQueue().songs.every(song => song.mygo.plugin === "netease" && song.mygo.identity === sourceFixture.identity), "Batch playback must preserve source identity");
    assert.equal(savedSourceQueue().songs[0].mygo.image, sourceTracks[0].album.imageUrl, "Batch playback must preserve signed artwork");
    assert.equal(sourcePlaylistCalls, playlistCallsBeforePlay, "Playback must not fetch missing playlist pages");
    for (const theme of ["spotify-dark", "apple-light"]) {
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}; true`);
      for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 740], [844, 390]]) {
        await browser("set", "viewport", String(width), String(height));
        assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth+1"), `${theme}/${width}: playlist header must not overflow`);
        assert.ok(await evaluate("document.querySelector('.mygo-play-all').getBoundingClientRect().height >= 44"));
        await browser("screenshot", `${artifacts}/mygo-playlist-${theme}-${width}.png`);
      }
    }
    await browser("set", "viewport", "1440", "900");
    sourcePlaylistPage = { tracks: [{ ...sourceTracks[1], id: "next-page" }], more: false };
    await clickVisible(".mygo-source-content > button:last-child");
    await browser("wait", "--fn", "document.querySelector('.mygo-play-all')?.textContent === '全部播放' && !document.querySelector('.mygo-play-all').disabled");
    streamFailure = false;
    await browser("click", ".mygo-play-all");
    await browser("wait", "--fn", "!document.querySelector('audio').error && document.querySelector('audio').currentTime > 0.05 && !document.querySelector('audio').paused");
    await evaluate("document.querySelector('audio').pause(); true");
    assert.deepEqual(savedSourceQueue().songs.map(song => song.mygo.track), [...playlistTracks.map(track => track.id), "next-page"], "Play all must include manually appended pages");
    await browser("click", ".mygo-source-tabs button:first-child");
    await browser("wait", "--fn", "!document.querySelector('.mygo-play-all')");
    sourcePlaylistPage = { tracks: [], more: false };
    await clickVisible(".mygo-collection-button:first-child");
    await browser("wait", "--fn", "!!document.querySelector('.mygo-play-all')?.disabled");
    sourcePlaylistPage = { tracks: [{ id: "unavailable", name: "Unavailable track", duration: 2000, unavailable: true }] };
    await browser("click", ".mygo-source-tabs button:first-child");
    await browser("wait", "--fn", "!document.querySelector('.mygo-play-all')");
    await clickVisible(".mygo-collection-button:first-child");
    await browser("wait", "--fn", "!!document.querySelector('.mygo-play-all')?.disabled");
    sourcePlaylistPage = null;
    sourceIntegrationFixture = true;
    sourceTracks = sourceTracks.map((track, index) => index === 0 ? { ...track, duration: 30000 } : track);
    const pauseSourcePlayback = async () => {
      await browser("wait", "--fn", "!!document.querySelector('.player .transport .play[aria-label=\"暂停\"]')");
      await browser("click", '.player .transport .play[aria-label="暂停"]');
      await browser("wait", "--fn", "document.querySelector('audio').paused");
    };
    mygoPlugins[0].exports.push("album", "artist");
    await evaluate("window.dispatchEvent(new Event('lark:plugins-changed')); true");
    await browser("click", ".mygo-source-tabs button:first-child");
    await browser("wait", "--fn", "document.querySelector('.mygo-source-content h4')?.textContent==='Fixture source home' && !!document.querySelector('.mygo-tracks li button:not(:disabled)')");
    await clickVisible(".mygo-tracks li button:first-child");
    await browser("wait", "--fn", "document.querySelector('.player .now strong')?.textContent==='Playback fixture' && document.querySelector('audio').currentTime > .05");
    await pauseSourcePlayback();
    const integrationRequests = pluginRequests.length;
    const latestSourceSong = () => sourceQueue?.songs?.find(song => song.id === sourceQueue.current);
    assert.equal(latestSourceSong().mygo.album, "album");
    assert.equal(latestSourceSong().mygo.artists[0].id, "artist");
    assert.equal(latestSourceSong().mygo.sourceName, sourceFixture.manifest.name);
    for (const [method, position, id] of [["album", 2, "album"], ["artist", 1, "artist"]]) {
      const before = sourceCalls.length;
      await clickVisible(`.player .now > div > span button:nth-of-type(${position})`);
      await browser("wait", "--fn", `document.querySelector('.mygo-source-content h4')?.textContent==='Fixture source ${method}'`);
      const call = sourceCalls.slice(before).find(call => call.method === method);
      assert.deepEqual(call?.params, { id }, `Footer ${method} must use the source entity identifier`);
      assert.equal(call?.identity, sourceFixture.identity);
      assert.ok(await evaluate("!!document.querySelector('.library-view .mygo-source-browser')"), "Source links must also work while LibraryView is already mounted");
    }
    await clickVisible(".player .now strong button");
    await browser("wait", "--fn", "document.querySelector('.mygo-source-content h4')?.textContent==='Fixture source home'");
    console.log("PASS source footer title/album/artist navigation within mounted LibraryView and original source metadata");

    await clickVisible(".library-tabs button:first-child");
    await browser("fill", ".song-search-combobox input", "Playback");
    await browser("press", "Escape");
    await browser("press", "Enter");
    await browser("wait", "--fn", "!!document.querySelector('.mygo-search-track') && document.querySelector('.library-view').textContent.includes('Playback local fixture')");
    assert.ok(sourceCalls.some(call => call.method === "search" && call.params.query === "Playback" && call.params.kind === "tracks" && call.params.offset === 0 && call.identity === sourceFixture.identity));
    for (const [width, height] of [[1440, 900], [320, 740]]) {
      await browser("set", "viewport", String(width), String(height));
      assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth+1"), `${width}: mixed local/source search must not overflow`);
      assert.ok(await evaluate("[...document.querySelectorAll('.mygo-search-results button')].every(button=>button.getBoundingClientRect().height >= 44)"));
      await browser("screenshot", `${artifacts}/mygo-unified-search-${width}.png`);
    }
    await browser("set", "viewport", "1440", "900");
    await clickVisible(".mygo-search-source-link");
    await browser("wait", "--fn", "document.querySelector('.mygo-source-content h4')?.textContent==='Fixture source search'");
    await clickVisible(".library-tabs button:first-child");
    await browser("fill", ".song-search-combobox input", "Playback");
    await browser("press", "Escape");
    await browser("press", "Enter");
    await browser("wait", "--fn", "!!document.querySelector('.mygo-search-track')");
    await clickVisible(".mygo-search-track");
    await browser("wait", "--fn", "document.querySelector('audio').currentTime > .05 && !document.querySelector('audio').paused");
    await pauseSourcePlayback();
    await browser("wait", "--fn", "fetch('/api/playback/history').then(response=>response.json()).then(entries=>entries.some(entry=>entry.song.mygo?.track==='playback-fixture'))");
    assert.ok(writes.some(write => write.path === "/api/mygo/history" && write.payload.song.mygo?.sourceName === sourceFixture.manifest.name), "Source playback must persist identity-bearing history metadata");
    await clickVisible('.desktop-sidebar nav button[aria-label="历史"]');
    await browser("wait", "--fn", "!!document.querySelector('.history-title-button') && document.querySelector('.history-view').textContent.includes('Playback local fixture')");
    await evaluate("(() => {const button=[...document.querySelectorAll('.history-title-button')].find(button=>button.textContent==='Playback fixture');button.scrollIntoView({block:'center'});button.click();return true;})()");
    await browser("wait", "--fn", "document.querySelector('audio').currentTime > .05 && !document.querySelector('audio').paused");
    await pauseSourcePlayback();
    assert.equal(latestSourceSong().mygo.track, "playback-fixture", "History resume must restore the MyGo source instead of reading a negative local ID");
    assert.ok(await evaluate("[...document.querySelectorAll('.history-entry-links')].some(element=>element.textContent.includes('网易云音乐'))"));
    console.log("PASS mixed local/source search, source-result navigation, history writes and source-aware history resume");

    for (const style of ["vinyl-collection", "rewind-classic"]) {
      await browser("set", "viewport", "1440", "900");
      preferences = { ...preferences, home_player_style: style, mobile_home_player_style: "rewind-classic" };
      const before = sourceCalls.length;
      await browser("open", url);
      const themeSelector = style === "vinyl-collection" ? ".vinyl-collection-player" : ".rewind-listening-room";
      try {
        await browser("wait", "--fn", `!!document.querySelector(${JSON.stringify(themeSelector)})`);
      } catch (error) {
        console.log(JSON.stringify({ style, preferences, sourceQueue, requests: pluginRequests.slice(-20) }));
        console.log(await browser("snapshot", "-i"));
        await browser("screenshot", `${artifacts}/mygo-${style}-restore-failure.png`);
        throw error;
      }
      await clickVisible('.desktop-sidebar nav button[aria-label="历史"]');
      await browser("wait", "--fn", "[...document.querySelectorAll('.history-title-button')].some(button=>button.textContent==='Playback fixture')");
      await evaluate("[...document.querySelectorAll('.history-title-button')].find(button=>button.textContent==='Playback fixture').click(); true");
      await browser("wait", "--fn", "document.querySelector('.player .now strong')?.textContent==='Playback fixture' && document.querySelector('audio').currentTime > .05 && !document.querySelector('audio').paused");
      await pauseSourcePlayback();
      await clickVisible('.desktop-sidebar nav button[aria-label="首页"]');
      await browser("wait", "--fn", `!!document.querySelector(${JSON.stringify(themeSelector)})`);
      if (style === "vinyl-collection") {
        await browser("wait", "--fn", "document.querySelector('.vc-shelf-record')?.textContent==='Fixture album' && !!document.querySelector('.vc-track-list button')");
        await clickVisible(".vc-sleeve-actions button:first-child");
        await browser("wait", "--fn", "document.querySelector('.vc-sleeve')?.dataset.flipped==='true' && !document.querySelector('.vc-sleeve').getAnimations({subtree:true}).some(animation=>animation.playState==='running')");
        await clickVisible(".vc-track-list button:first-child");
      } else {
        await browser("wait", "--fn", "!!document.querySelector('.rewind-current-details')");
        await clickVisible(".rewind-current-details");
        await browser("wait", "--fn", "!!document.querySelector('.rewind-album-tracks button')");
        await clickVisible(".rewind-album-tracks button:first-child");
      }
      try {
        await browser("wait", "--fn", "document.querySelector('audio').currentTime > .05 && !document.querySelector('audio').paused");
      } catch (error) {
        console.log(JSON.stringify({ style, calls: sourceCalls.slice(before), sourceQueue, state: await evaluate("({current:document.querySelector('.now strong')?.textContent, control:document.querySelector('.transport .play')?.getAttribute('aria-label'), audio:{src:document.querySelector('audio').currentSrc,time:document.querySelector('audio').currentTime,paused:document.querySelector('audio').paused,ended:document.querySelector('audio').ended,error:document.querySelector('audio').error?.message}})") }));
        await browser("screenshot", `${artifacts}/mygo-${style}-playback-failure.png`);
        throw error;
      }
      await pauseSourcePlayback();
      assert.ok(sourceCalls.slice(before).some(call => call.method === "album"), `${style}: album tracks must come from the source capability`);
      assert.ok(sourceQueue.songs.every(song => song.mygo?.plugin === "netease" && song.mygo?.identity === sourceFixture.identity));
      assert.ok(await evaluate(`!document.querySelector(${JSON.stringify(themeSelector)}).textContent.includes('Local catalog album')`), `${style}: local albums must not leak into a source collection`);
      await browser("screenshot", `${artifacts}/mygo-${style}-1440.png`);
      await browser("set", "viewport", "320", "740");
      await browser("wait", "--fn", "!!document.querySelector('.mobile-home-view')");
      assert.ok(await evaluate("![...document.querySelectorAll('.mobile-home-view img')].some(image=>/\\/api\\/songs\\/-\\d+\\/cover/.test(image.getAttribute('src')||''))"), "Mobile recent/resume artwork must use the source image endpoint instead of native negative-ID covers");
      await clickVisible(".mobile-mini-main");
      await browser("wait", "--fn", "!!document.querySelector('[role=dialog] .rewind-listening-room')");
      await browser("wait", "--fn", "!!document.querySelector('.rewind-current-details')");
      assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth+1"), `${style}/320: source playback must not overflow`);
      await clickVisible(".rewind-page-switch button:last-child");
      await browser("wait", "--fn", "document.querySelector('.rewind-rack-tape')?.getAttribute('aria-label')==='Fixture album · Fixture artist'");
      assert.ok(await evaluate("!document.querySelector('[role=dialog] .rewind-listening-room').textContent.includes('Local catalog album')"));
      await browser("screenshot", `${artifacts}/mygo-${style}-mobile-320.png`);
      await clickVisible(".mobile-art-phone [data-autofocus]");
      await browser("set", "viewport", "1440", "900");
      mygoPlugins[0].exports = mygoPlugins[0].exports.filter(method => method !== "album");
      await evaluate("window.dispatchEvent(new Event('lark:plugins-changed')); true");
      if (style === "vinyl-collection") await browser("wait", "--fn", "!!document.querySelector('.vc-shelf-empty') && !document.querySelector('.vc-shelf-record')");
      else {
        await browser("wait", "--fn", "!document.querySelector('.rewind-current-details')");
        await clickVisible(".rewind-page-switch button:last-child");
        await browser("wait", "--fn", "!!document.querySelector('.rewind-empty') && !document.querySelector('.rewind-rack-tape')");
      }
      assert.ok(await evaluate(`!document.querySelector(${JSON.stringify(themeSelector)}).textContent.includes('Local catalog album')`), `${style}: missing source album capability must stay empty, not invent a local fallback`);
      mygoPlugins[0].exports.push("album");
      await evaluate("window.dispatchEvent(new Event('lark:plugins-changed')); true");
    }
    assert.ok(pluginRequests.slice(integrationRequests).some(request => request.path === "/api/albums/page"), "Isolation fixtures must expose a real local catalog to catch accidental fallback");
    assert.equal(pluginRequests.slice(integrationRequests).filter(request => /^\/api\/(songs|albums|artists)\/-\d+(?:\/|$)/.test(request.path)).length, 0, "Source IDs must never be fetched through native song/album/artist endpoints");
    assert.equal(pluginRequests.slice(integrationRequests).filter(request => request.path === "/api/albums/41/songs").length, 0, "Source-themed collections must not fetch native local album tracks");
    sourceIntegrationFixture = false;
    preferences = {};
    await openLibrary();
    await clickLibraryTab("音乐源");
    await browser("wait", "--fn", "document.querySelector('.mygo-account-status')?.dataset.state === 'signed-in'");
    console.log("PASS vinyl-collection and rewind source-only collections, missing-capability empty state, 1440px desktop and 320px mobile rewind isolation");
    await browser("click", ".mygo-sign-out");
    await browser("wait", "--fn", "document.querySelector('.mygo-account-status')?.dataset.state === 'signed-out'");
    sourceTracks = [];
    sourceCollections = [];
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
} catch (error) {
  await browser("screenshot", `${artifacts}/failure.png`).catch(() => {});
  if (lyricsFlow) console.log(await browser("snapshot", "-i"));
  throw error;
} finally {
  await browser("close").catch(() => {});
  await new Promise((done) => server.close(done));
}
