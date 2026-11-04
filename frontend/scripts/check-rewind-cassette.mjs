import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = resolve(root, "backend/web/dist");
const exec = promisify(execFile);
const session = `lark-rewind-${process.pid}`;
const browser = async (...args) => {
  const { stdout } = await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 40000, maxBuffer: 1024 * 1024 });
  const response = JSON.parse(stdout);
  assert.ok(response.success, response.error);
  return response.data;
};
const evaluate = async (source) => (await browser("eval", source)).result;
const themes = ["rewind-classic", "rewind-studio", "rewind-crystal"];
let selected = themes[0];
let preferences = {};
const songs = [1, 2, 3].map(id => ({ id, title: `夜航磁带 ${id} / Night Passage`, artist: "Lark Studio", album: "Home recordings", album_id: 1, duration_seconds: 240, path: "fixture.wav", file_name: "fixture.wav", format: "WAV", mime: "audio/wav", size_bytes: 4800044, sample_rate: 8000, bit_rate: 128, favorite: false, has_lyrics: false }));
const page = items => ({ items, total: items.length, page: 1, offset: 0, limit: 100 });
const audio = Buffer.alloc(4800044);
audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname.endsWith("/stream")) { response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": audio.length }).end(audio); return; }
  if (pathname.endsWith("/cover")) { response.writeHead(404).end(); return; }
  if (pathname === "/api/me/preferences" && request.method === "PUT") {
    let body = "";
    for await (const chunk of request) body += chunk;
    preferences = JSON.parse(body);
  }
  if (pathname.startsWith("/api/")) {
    const responses = {
      "/api/auth/status": { initialized: true, user: { id: 1, username: "rewind-fixture", role: "admin" } },
      "/api/settings": { language: "zh-CN", theme: "apple-light" },
      "/api/me/preferences": { home_player_style: selected, mobile_home_player_style: selected, ...preferences },
      "/api/me/ui-sounds": { enabled: false, volume: .5 },
      "/api/me/playback-history": { separate_by_device: false },
      "/api/playback/queue": { queue: { song_ids: [1, 2, 3], current_id: 1 } },
      "/api/library/stats": { songs: 3, albums: 0, artists: 0, playlists: 0 },
      "/api/library/review-summary": { incomplete_songs: 0 },
      "/api/songs/page": page(songs),
      "/api/songs": songs,
      "/api/albums/page": page([]),
      "/api/artists/page": page([]),
      "/api/playlists/page": page([]),
      ...Object.fromEntries(songs.map(song => [`/api/songs/${song.id}`, song])),
    };
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(responses[pathname] ?? []));
    return;
  }
  const filename = resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!filename.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(filename);
    response.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" }[extname(filename)] || "application/octet-stream" }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const player = ".rewind-player";
const tape = `${player} .rewind-tape-stage`;
const load = async (width, height) => {
  await browser("set", "viewport", String(width), String(height));
  await browser("open", url);
  await evaluate(`localStorage.setItem('lark.persistent-queue-enabled','true'); location.reload(); true`);
  await browser("wait", "--fn", "!!document.querySelector('.desktop-sidebar') || !!document.querySelector('.mobile-bottom-nav')");
  if (width <= 720 || (width <= 960 && height <= 500)) {
    await browser("wait", "--fn", "!!document.querySelector('.mobile-mini-player')");
    await browser("click", ".mobile-mini-main");
  }
  await browser("wait", "--fn", `!!document.querySelector('${tape}')`);
  await browser("click", `${player} .mobile-art-play`);
  await browser("wait", "--fn", `document.querySelector('${player}').dataset.playing === 'true'`);
  await browser("click", `${player} .mobile-art-play`);
  await browser("wait", "--fn", `document.querySelector('${player}').dataset.playing === 'false'`);
};
const pointer = async (events) => evaluate(`(() => {
  const tape = document.querySelector('${tape}');
  const bounds = tape.getBoundingClientRect();
  tape.setPointerCapture = () => {};
  for (const event of ${JSON.stringify(events)}) tape.dispatchEvent(new PointerEvent(event.type, { bubbles:true, pointerId:event.id ?? 11, isPrimary:event.primary ?? true, pointerType:'touch', button:0, clientX:bounds.x + bounds.width / 2 + (event.x ?? 0), clientY:bounds.y + bounds.height / 2 + (event.y ?? 0) }));
  return true;
})()`);
try {
  for (selected of themes) {
    preferences = {};
    for (const [width, height] of [[1440, 900], [800, 900], [360, 740], [390, 844], [430, 932], [390, 568], [844, 390]]) {
      await load(width, height);
      const geometry = await evaluate(`(() => {
        const tape = document.querySelector('${tape}').getBoundingClientRect();
        const controls = [...document.querySelectorAll('${player} .mobile-art-controls button')].map(button => { const bounds = button.getBoundingClientRect(); return { width:bounds.width, height:bounds.height, fits:bounds.left >= 0 && bounds.right <= innerWidth }; });
        return { tapeWidth:tape.width, tapeFits:tape.left >= 0 && tape.right <= innerWidth, overflow:document.documentElement.scrollWidth > innerWidth + 1, controls };
      })()`);
      assert.ok(geometry.tapeWidth >= 180 && geometry.tapeFits && !geometry.overflow, `${selected} ${width}x${height}: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.controls.every(button => button.width >= 44 && button.height >= 44 && button.fits), `${selected} ${width}x${height}: touch targets`);
      await browser("click", tape);
      await browser("wait", "--fn", `document.querySelector('${tape}').getAttribute('aria-pressed') === 'true'`);
      await browser("focus", tape);
      await browser("press", "Enter");
      await browser("wait", "--fn", `document.querySelector('${tape}').getAttribute('aria-pressed') === 'false'`);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('${player} .rewind-tape-body')).transitionDuration`), "0s");
      if (width === 390 && height === 844 || width === 1440) await browser("screenshot", `/tmp/lark-${selected}-${width}.png`);
      console.log(`PASS ${selected} ${width}x${height}: layout, touch targets, pointer/keyboard flip`);
    }
  }
  await load(390, 844);
  const initialTitle = await evaluate(`document.querySelector('${player} .mobile-art-meta strong').textContent`);
  await pointer([{ type: "pointerdown" }, { type: "pointermove", x: -90 }, { type: "pointerup", x: -90 }]);
  await browser("wait", "--fn", `document.querySelector('${player} .mobile-art-meta strong').textContent !== ${JSON.stringify(initialTitle)}`);
  assert.equal(await evaluate(`document.querySelector('${tape}').getAttribute('aria-pressed')`), "false");
  const nextTitle = await evaluate(`document.querySelector('${player} .mobile-art-meta strong').textContent`);
  for (const events of [
    [{ type: "pointerdown" }, { type: "pointermove", x: 8, y: 100 }, { type: "pointerup", x: 8, y: 100 }],
    [{ type: "pointerdown" }, { type: "pointermove", x: -100 }, { type: "pointercancel" }],
    [{ type: "pointerdown" }, { type: "pointerdown", id: 12, primary: false }, { type: "pointerup", x: -100 }],
  ]) {
    await pointer(events);
    assert.equal(await evaluate(`document.querySelector('${player} .mobile-art-meta strong').textContent`), nextTitle);
    assert.equal(await evaluate(`document.querySelector('${tape}').getAttribute('aria-pressed')`), "false");
  }
  await pointer([{ type: "pointerdown" }]);
  await browser("wait", "--fn", "!!document.querySelector('.queue-panel')");
  await pointer([{ type: "pointerup" }]);
  assert.equal(await evaluate(`document.querySelector('${tape}').getAttribute('aria-pressed')`), "false");
  console.log("PASS mobile: swipe, vertical/cancel/multitouch, long hold opens queue without flipping");
  for (selected of themes) {
    preferences = {};
    await load(1440, 900);
    await browser("set", "media", "light", "reduced-motion");
    await browser("click", `${player} .mobile-art-play`);
    await browser("wait", "--fn", `document.querySelector('${player}').dataset.playing === 'true' && document.querySelector('${player} .rewind-cassette').dataset.motion === 'running'`);
    const motion = await evaluate(`(() => { const reel = getComputedStyle(document.querySelector('${player} .rewind-tape-roll i')); return { name:reel.animationName, duration:reel.animationDuration, iterations:reel.animationIterationCount, tilt:getComputedStyle(document.querySelector('${player} .rewind-tape-tilt')).transform }; })()`);
    assert.deepEqual(motion, { name: "rewind-spool", duration: "18s", iterations: "infinite", tilt: "none" });
    await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); true");
    await browser("wait", "--fn", `document.querySelector('${player} .rewind-cassette').dataset.motion === 'paused'`);
    await evaluate("delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); true");
    await browser("wait", "--fn", `document.querySelector('${player} .rewind-cassette').dataset.motion === 'running'`);
    await evaluate(`document.querySelector('${player} .rewind-cassette').style.transform = 'translateX(-10000px)'; true`);
    await browser("wait", "--fn", `document.querySelector('${player} .rewind-cassette').dataset.motion === 'paused'`);
    await evaluate(`document.querySelector('${player} .rewind-cassette').style.transform = ''; true`);
    await browser("wait", "--fn", `document.querySelector('${player} .rewind-cassette').dataset.motion === 'running'`);
    await browser("click", `${player} .mobile-art-play`);
    await browser("wait", "--fn", `document.querySelector('${player}').dataset.playing === 'false'`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('${player} .rewind-tape-roll i')).animationName`), "none");
    await browser("click", `${player} .mobile-art-queue`);
    await browser("wait", "--fn", "!!document.querySelector('.queue-panel')");
    console.log(`PASS ${selected}: reduced-motion cues, pause/hidden/offscreen stops reels, desktop queue button`);
  }
  await load(1440, 900);
  const beforeDrag = await evaluate(`document.querySelector('${player} .mobile-art-meta strong').textContent`);
  const point = await evaluate(`(() => { const bounds = document.querySelector('${tape}').getBoundingClientRect(); return {x:Math.round(bounds.x + bounds.width / 2),y:Math.round(bounds.y + bounds.height / 2)}; })()`);
  await browser("mouse", "move", String(point.x), String(point.y));
  await browser("mouse", "down");
  await browser("mouse", "move", String(point.x - 100), String(point.y));
  await browser("mouse", "up");
  await browser("wait", "--fn", `document.querySelector('${player} .mobile-art-meta strong').textContent !== ${JSON.stringify(beforeDrag)}`);
  assert.equal(await evaluate(`document.querySelector('${tape}').getAttribute('aria-pressed')`), "false");
  console.log("PASS desktop: native mouse drag changes track once without flipping");
  await load(1440, 900);
  await browser("click", '.desktop-sidebar nav button[aria-label="设置"]');
  await browser("click", "#settings-tab-playback");
  for (const theme of themes) {
    await browser("click", `button[data-player-style='${theme}']`);
    await browser("wait", "--fn", `localStorage.getItem('lark.home-player-style') === '${theme}'`);
    await browser("wait", "--fn", `document.querySelector("button[data-player-style='${theme}']").getAttribute('aria-pressed') === 'true'`);
  }
  await browser("set", "viewport", "390", "844");
  await browser("wait", "--fn", "!!document.querySelector('.mobile-material-picker')");
  await browser("click", ".mobile-material-picker button[data-theme='rewind-studio']");
  await browser("wait", "--fn", "localStorage.getItem('lark.mobile-home-player-style') === 'rewind-studio'");
  await browser("wait", "--fn", "fetch('/api/me/preferences').then(response => response.json()).then(value => value.home_player_style === 'rewind-crystal' && value.mobile_home_player_style === 'rewind-studio')");
  await browser("set", "viewport", "1440", "900");
  await browser("open", url);
  await browser("wait", "--fn", "!!document.querySelector('.desktop-sidebar')");
  await browser("click", '.desktop-sidebar nav button[aria-label="首页"]');
  await browser("wait", "--fn", "!!document.querySelector('.desktop-home-view[data-home-player-style=rewind-crystal]')");
  await browser("set", "viewport", "390", "844");
  await browser("wait", "--fn", "!!document.querySelector('.mobile-mini-player')");
  await browser("click", ".mobile-mini-main");
  await browser("wait", "--fn", "!!document.querySelector('.mobile-art-rewind-studio')");
  console.log("PASS settings: all three choices, independent desktop/mobile preferences, saved and restored after reload");
} catch (error) {
  await browser("screenshot", "/tmp/lark-rewind-failure.png").catch(() => undefined);
  console.error(await evaluate("({url:location.href,body:document.body.innerText.slice(-3500)})").catch(() => null));
  throw error;
} finally {
  await browser("close").catch(() => undefined);
  await new Promise(resolve => server.close(resolve));
}
