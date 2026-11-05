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
const clickVisible = async (selector) => {
  await evaluate(`(() => { const target = document.querySelector(${JSON.stringify(selector)}); const scroller = target.closest('.rewind-rack,.rewind-album-panel'); if (scroller) scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (scroller.clientHeight - target.getBoundingClientRect().height) / 2; return true; })()`);
  await browser("click", selector);
};
const themes = ["rewind-classic", "rewind-studio", "rewind-crystal"];
let selected = themes[0];
let preferences = {};
const albums = ["Home recordings", "山间来信", "Late Night Radio", "A Place in the Sun", "Blue Hours", "红色收音机", "纸上的夏天", "Quiet afternoons"].map((title, index) => ({ id: index + 1, title, artist: "Lark Studio", album_artist: "Lark Studio", song_count: 3, year: 2026, favorite: false }));
const songs = albums.flatMap(album => [1, 2, 3].map(track => ({ id: (album.id - 1) * 3 + track, title: `夜航磁带 ${track} / Night Passage`, artist: "Lark Studio", album: album.title, album_id: album.id, duration_seconds: 240, path: "fixture.wav", file_name: "fixture.wav", format: "WAV", mime: "audio/wav", size_bytes: 4800044, sample_rate: 8000, bit_rate: 128, favorite: false, has_lyrics: false })));
const failedAlbums = new Set();
let failRack = false;
let emptyRack = false;
let delayAlbum = 0;
const page = items => ({ items, total: items.length, page: 1, offset: 0, limit: 100 });
const audio = Buffer.alloc(4800044);
audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname.endsWith("/stream")) { response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": audio.length }).end(audio); return; }
  if (pathname.endsWith("/cover")) {
    const colors = ["#c4b68f", "#a1bdae", "#989eaf", "#d2a279", "#809caa", "#bc7369", "#b3b09c", "#afb897"];
    const color = colors[(Number(pathname.split("/")[3]) - 1) % colors.length];
    response.writeHead(200, { "Content-Type": "image/svg+xml" }).end(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${color}"/><circle cx="430" cy="160" r="65" fill="#f8ebc6"/><path d="M0 330L220 160L430 400L600 300V600H0" fill="#3d6059"/><path d="M0 460L270 360L600 480V600H0" fill="#25473f"/><text x="42" y="75" font-family="serif" font-style="italic" font-size="42" fill="#f5f1d5">Home recordings</text><text x="42" y="555" font-family="sans-serif" font-size="14" letter-spacing="5" fill="#d5dbb8">LARK STUDIO / VOL. 01</text></svg>`);
    return;
  }
  const albumTracks = pathname.match(/^\/api\/albums\/(\d+)\/songs$/);
  if (albumTracks) {
    const id = Number(albumTracks[1]);
    if (delayAlbum === id) await new Promise(resolve => setTimeout(resolve, 500));
    if (process.argv.includes("--trace")) console.log("ALBUM", id, failedAlbums.has(id) ? 503 : 200);
    response.writeHead(failedAlbums.has(id) ? 503 : 200, { "Content-Type": "application/json" }).end(JSON.stringify(failedAlbums.has(id) ? { error: "fixture unavailable" } : songs.filter(song => song.album_id === id)));
    return;
  }
  if (pathname === "/api/albums/page") {
    if (failRack) { response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "fixture unavailable" })); return; }
    const params = new URL(request.url, "http://localhost").searchParams;
    const selectedPage = Number(params.get("page")) || 1;
    const limit = 4;
    const items = emptyRack ? [] : albums.slice((selectedPage - 1) * limit, selectedPage * limit);
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ items, total: emptyRack ? 0 : albums.length, page: selectedPage, limit, offset: (selectedPage - 1) * limit }));
    return;
  }
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
      "/api/library/stats": { songs: songs.length, albums: albums.length, artists: 0, playlists: 0 },
      "/api/library/review-summary": { incomplete_songs: 0 },
      "/api/songs/page": page(songs),
      "/api/songs": songs,
      "/api/albums/page": page(albums),
      "/api/albums": albums,
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
  await browser("wait", "--fn", `document.querySelector('${player}').dataset.playing === 'true' && !document.querySelector('audio').paused && document.querySelector('audio').readyState >= 3`);
  await browser("click", `${player} .mobile-art-play`);
  await browser("wait", "--fn", `document.querySelector('${player}').dataset.playing === 'false' && document.querySelector('audio').paused`);
};
const pointer = async (events) => evaluate(`(() => {
  const tape = document.querySelector('${tape}');
  const bounds = tape.getBoundingClientRect();
  tape.setPointerCapture = () => {};
  for (const event of ${JSON.stringify(events)}) tape.dispatchEvent(new PointerEvent(event.type, { bubbles:true, pointerId:event.id ?? 11, isPrimary:event.primary ?? true, pointerType:'touch', button:0, clientX:bounds.x + bounds.width / 2 + (event.x ?? 0), clientY:bounds.y + bounds.height / 2 + (event.y ?? 0) }));
  return true;
})()`);
try {
  if (process.argv.includes("--review")) {
    for (selected of process.argv.includes("--quick") ? [themes[0]] : themes) {
      for (const [width, height] of process.argv.includes("--quick") ? [[390, 844]] : [[1440, 900], [390, 844], [390, 568], [844, 390]]) {
        await load(width, height);
        console.log(await evaluate(`(() => { const phone = document.querySelector('${player} .mobile-art-phone'); const meta = document.querySelector('${player} .mobile-art-meta'); const style = getComputedStyle(phone); return { app: document.querySelector('.app-shell').className, width:${width}, height:${height}, phone: { display:style.display, rows:style.gridTemplateRows, height:phone.getBoundingClientRect().height }, meta: { display:getComputedStyle(meta).display, rows:getComputedStyle(meta).gridTemplateRows, columns:getComputedStyle(meta).gridTemplateColumns, align:getComputedStyle(meta).textAlign }, children:[...meta.children].map(child => ({tag:child.tagName,order:getComputedStyle(child).order, row:getComputedStyle(child).gridRow,column:getComputedStyle(child).gridColumn})) }; })()`));
        await browser("wait", "--fn", `document.querySelector('${tape}').dataset.renderer === 'webgl' && Math.abs(Number(document.querySelector('${player} canvas.rewind-model').dataset.angle)) < .15`);
        await evaluate("document.activeElement?.blur(); true");
        await browser("screenshot", `/tmp/lark-redesign-${selected}-${width}-${height}.png`);
      }
    }
    await load(390, 844);
    await browser("click", `${player} .rewind-page-switch button:nth-child(3)`);
    await browser("wait", "--fn", "!!document.querySelector('.rewind-rack-more button')");
    await clickVisible(".rewind-rack-more button");
    await browser("wait", "--fn", "document.querySelectorAll('.rewind-rack-tape').length === 8");
    console.log(await evaluate(`Object.fromEntries(['.mobile-art-player','.mobile-art-phone','.rewind-listening-room','.rewind-screen-pages','.rewind-rack-page','.rewind-rack'].map(selector=>{ const element=document.querySelector('${player}'+(selector==='.mobile-art-player'?'': ' '+selector)); const style=getComputedStyle(element);return [selector,{height:element.getBoundingClientRect().height,rows:style.gridTemplateRows,display:style.display,min:style.minHeight,overflow:style.overflowY}];}))`));
    await browser("screenshot", "/tmp/lark-redesign-rack.png");
    await browser("click", ".rewind-rack-toolbar button");
    await browser("wait", "350");
    await browser("screenshot", "/tmp/lark-redesign-rack-expanded.png");
    await clickVisible(".rewind-rack li:first-child .rewind-rack-details");
    await browser("wait", "--fn", "document.querySelectorAll('.rewind-album-tracks li').length === 3");
    await browser("screenshot", "/tmp/lark-redesign-album-tracks.png");
    await load(390, 844);
    await browser("set", "media", "light", "no-preference");
    await browser("record", "start", "/tmp/lark-v0188-interactions.webm", "--cursor", "--fps", "30");
    await browser("click", `${player} .mobile-art-play`);
    await browser("wait", "700");
    await browser("click", tape);
    await browser("wait", "700");
    await browser("click", tape);
    await browser("wait", "700");
    const center = await evaluate(`(() => { const bounds = document.querySelector('${tape}').getBoundingClientRect(); return {x:Math.round(bounds.x + bounds.width / 2),y:Math.round(bounds.y + bounds.height / 2)}; })()`);
    await browser("mouse", "move", String(center.x), String(center.y));
    await browser("mouse", "down");
    await browser("mouse", "move", String(center.x + 32), String(center.y + 20));
    await browser("wait", "200");
    await browser("mouse", "move", String(center.x + 70), String(center.y + 10));
    await browser("mouse", "up");
    await browser("wait", "700");
    await browser("click", `${player} .rewind-page-switch button:nth-child(3)`);
    await browser("wait", "500");
    await browser("click", ".rewind-rack-toolbar button");
    await browser("wait", "700");
    await browser("click", ".rewind-rack li:first-child .rewind-rack-details");
    await browser("wait", "500");
    await browser("record", "stop");
    console.log("PASS visual captures: materials, desktop/phone/short/landscape, rack, album tracks");
  } else {
  if (!process.argv.includes("--collection-only")) {
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
      await browser("wait", "--fn", `document.querySelector('${tape}').dataset.renderer === 'webgl'`);
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
  await browser("wait", "--fn", "!!document.querySelector('.rewind-album-panel')");
  await pointer([{ type: "pointerup" }]);
  assert.equal(await evaluate(`document.querySelector('${tape}').getAttribute('aria-pressed')`), "false");
  await browser("click", ".rewind-album-back");
  console.log("PASS mobile: swipe, vertical/cancel/multitouch, long hold opens album tracks without flipping");
  for (selected of themes) {
    preferences = {};
    await load(1440, 900);
    await browser("set", "media", "light", "reduced-motion");
    await browser("click", `${player} .mobile-art-play`);
    await browser("wait", "--fn", `document.querySelector('${player}').dataset.playing === 'true' && document.querySelector('${player} .rewind-cassette').dataset.motion === 'running'`);
    const motion = await evaluate(`(() => { const reel = getComputedStyle(document.querySelector('${player} .rewind-tape-roll i')); return { name:reel.animationName, duration:reel.animationDuration, iterations:reel.animationIterationCount, tilt:getComputedStyle(document.querySelector('${player} .rewind-tape-tilt')).transform }; })()`);
    assert.deepEqual(motion, { name: "rewind-spool", duration: "18s", iterations: "infinite", tilt: "none" });
    const reelAngle = await evaluate(`document.querySelector('${player} .rewind-model').dataset.reelAngle`);
    await browser("wait", "--fn", `document.querySelector('${player} .rewind-model').dataset.reelAngle !== ${JSON.stringify(reelAngle)}`);
    await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); true");
    await browser("wait", "--fn", `document.querySelector('${player} .rewind-cassette').dataset.motion === 'paused'`);
    const hiddenAngle = await evaluate(`document.querySelector('${player} .rewind-model').dataset.reelAngle`);
    await browser("wait", "200");
    assert.equal(await evaluate(`document.querySelector('${player} .rewind-model').dataset.reelAngle`), hiddenAngle);
    await evaluate("delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); true");
    await browser("wait", "--fn", `document.querySelector('${player} .rewind-cassette').dataset.motion === 'running'`);
    await evaluate(`document.querySelector('${player} .rewind-cassette').style.transform = 'translateX(-10000px)'; true`);
    await browser("wait", "--fn", `document.querySelector('${player} .rewind-cassette').dataset.motion === 'paused'`);
    await evaluate(`document.querySelector('${player} .rewind-cassette').style.transform = ''; true`);
    await browser("wait", "--fn", `document.querySelector('${player} .rewind-cassette').dataset.motion === 'running'`);
    await browser("click", `${player} .mobile-art-play`);
    await browser("wait", "--fn", `document.querySelector('${player}').dataset.playing === 'false'`);
    await browser("wait", "--fn", `document.querySelector('${player} .rewind-model').dataset.rotating === 'false'`);
    const pausedAngle = await evaluate(`document.querySelector('${player} .rewind-model').dataset.reelAngle`);
    await browser("wait", "200");
    assert.equal(await evaluate(`document.querySelector('${player} .rewind-model').dataset.reelAngle`), pausedAngle);
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
  }
  for (const [width, height] of [[390, 844], [844, 390], [1440, 900]]) {
    if (process.argv.includes("--trace")) console.log("COLLECTION", width, height);
    await load(width, height);
    await browser("set", "media", "light", "no-preference");
    await browser("click", `${player} .rewind-page-switch button:nth-child(3)`);
    await browser("wait", "--fn", "document.querySelectorAll('.rewind-rack-tape').length === 4 && !document.querySelector('.rewind-rack').getAttribute('aria-busy').includes('true')");
    const rackBounds = await evaluate(`(() => { const phone = document.querySelector('${player} .mobile-art-phone').getBoundingClientRect(); const rack = document.querySelector('.rewind-rack'); return {phoneHeight:phone.height, scrolls:rack.scrollHeight>rack.clientHeight, roomFits:document.querySelector('.rewind-listening-room').getBoundingClientRect().bottom <= phone.bottom, controlsFit:[...document.querySelectorAll('${player} .mobile-art-controls button')].every(button=>button.getBoundingClientRect().bottom<=innerHeight)}; })()`);
    assert.ok(rackBounds.roomFits);
    if (width <= 960 && height <= 500 || width <= 720) assert.ok(rackBounds.phoneHeight <= height + 1 && rackBounds.controlsFit, JSON.stringify(rackBounds));
    await clickVisible(".rewind-rack-more button");
    await browser("wait", "--fn", "document.querySelectorAll('.rewind-rack-tape').length === 8");
    await browser("click", ".rewind-rack-toolbar button");
    assert.equal(await evaluate("document.querySelector('.rewind-rack').dataset.expanded"), "true");
    await browser("wait", "--fn", "!document.querySelector('.rewind-rack').getAnimations({subtree:true}).some(animation=>animation.playState==='running')");
    await clickVisible(".rewind-rack li:first-child .rewind-rack-details");
    await browser("wait", "--fn", "document.querySelectorAll('.rewind-album-tracks li').length === 3");
    assert.equal(await evaluate("document.activeElement.tagName"), "H3");
    await browser("press", "Escape");
    assert.equal(await evaluate("!!document.querySelector('.rewind-album-panel')"), false);
    assert.equal(await evaluate("document.activeElement.className"), "rewind-rack-details");
    failedAlbums.add(1);
    await browser("click", ".rewind-rack li:first-child .rewind-rack-details");
    await browser("wait", "--fn", "!!document.querySelector('.rewind-track-status[role=alert]')");
    failedAlbums.delete(1);
    await clickVisible(".rewind-track-status button");
    await browser("wait", "--fn", "document.querySelectorAll('.rewind-album-tracks li').length === 3");
    await browser("click", ".rewind-album-tracks li:nth-child(2) button");
    await browser("wait", "--fn", "!document.querySelector('.rewind-album-panel') && document.querySelector('.rewind-page-switch button').getAttribute('aria-pressed') === 'true'");
    await browser("click", `${player} .rewind-page-switch button:nth-child(2)`);
    assert.equal(await evaluate("document.querySelector('.rewind-artwork-page').hidden"), false);
    await browser("click", `${player} .rewind-page-switch button:first-child`);
    await browser("click", `${player} .mobile-art-play`);
    await browser("wait", "--fn", `document.querySelector('${player}').dataset.playing === 'false'`);
    console.log(`PASS collection ${width}x${height}: bounded rack, pagination, expansion, album tracks, focus/Escape, retry, real track playback, artwork`);
  }
  await load(390, 844);
  await browser("click", `${player} .rewind-page-switch button:nth-child(3)`);
  await browser("wait", "--fn", "document.querySelectorAll('.rewind-rack-tape').length === 4");
  delayAlbum = 1;
  await browser("click", ".rewind-rack li:first-child .rewind-rack-details");
  await browser("click", ".rewind-album-back");
  await browser("click", ".rewind-rack li:nth-child(2) .rewind-rack-details");
  await browser("wait", "--fn", "document.querySelector('.rewind-album-header h3').textContent === '山间来信' && document.querySelectorAll('.rewind-album-tracks li').length === 3");
  await browser("wait", "600");
  assert.equal(await evaluate("document.querySelector('.rewind-album-header h3').textContent"), "山间来信");
  delayAlbum = 0;
  console.log("PASS stale album request cannot overwrite a later selection");
  await load(390, 844);
  failRack = true;
  await browser("click", `${player} .rewind-page-switch button:nth-child(3)`);
  await browser("wait", "--fn", "!!document.querySelector('.rewind-rack-more[role=alert]')");
  failRack = false;
  await browser("click", ".rewind-rack-more button");
  await browser("wait", "--fn", "document.querySelectorAll('.rewind-rack-tape').length === 4 && !document.querySelector('.rewind-rack-more[role=alert]')");
  await browser("click", `${player} .rewind-page-switch button:first-child`);
  emptyRack = true;
  await browser("click", `${player} .rewind-page-switch button:nth-child(3)`);
  await browser("wait", "--fn", "!!document.querySelector('.rewind-empty') && document.querySelectorAll('.rewind-rack-tape').length === 0");
  emptyRack = false;
  await browser("click", `${player} .rewind-page-switch button:first-child`);
  await browser("wait", "--fn", `document.querySelector('${player} .rewind-model').dataset.loading === 'false'`);
  await evaluate(`document.querySelector('${player} .rewind-model').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext(); true`);
  await browser("wait", "--fn", `document.querySelector('${tape}').dataset.renderer === 'fallback'`);
  await browser("click", tape);
  assert.equal(await evaluate(`document.querySelector('${tape}').getAttribute('aria-pressed')`), "true");
  console.log("PASS rack error/retry and WebGL-loss fallback remains interactive");
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
  }
} catch (error) {
  await browser("screenshot", "/tmp/lark-rewind-failure.png").catch(() => undefined);
  console.error(await evaluate("({url:location.href,body:document.body.innerText.slice(-3500),audio:[...document.querySelectorAll('audio')].map(audio=>({paused:audio.paused,ready:audio.readyState,time:audio.currentTime,error:audio.error?.message,source:audio.currentSrc})),playing:document.querySelector('.rewind-player')?.dataset.playing})").catch(() => null));
  throw error;
} finally {
  await browser("close").catch(() => undefined);
  await new Promise(resolve => server.close(resolve));
}
