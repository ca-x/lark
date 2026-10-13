import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

// Exercise the built application, including the real SongRow and complete CSS
// cascade. Requires agent-browser and its Chromium installation on PATH.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = resolve(root, "backend/web/dist");
const session = `lark-song-layout-${process.pid}`;
const exec = promisify(execFile);
const browser = async (...args) => {
  const { stdout } = await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 40000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout);
  assert.ok(result.success, result.error);
  return result.data;
};
const themes = ["deep-space", "amber-film", "neon-coral", "arctic-aurora", "carbon-volt", "milk-porcelain", "oat-latte", "mint-soda", "sakura-washi", "dusk-amber", "apple-dark", "apple-light", "spotify-dark", "spotify-light", "netease-dark", "netease-light", "winamp-dark", "winamp-light", "foobar-dark", "foobar-light", "smartisan-classic"];
const checkedThemes = process.env.LARK_SONG_LAYOUT_THEMES?.split(",").filter(Boolean) || themes;
const checkedWidths = process.env.LARK_SONG_LAYOUT_WIDTHS?.split(",").map(Number).filter(Number.isFinite) || [800, 1100, 1280, 1920, 2560];
let theme = themes[0];
const songs = ["Fallen Angel", "天亮以后说分手", "一首包含中文与 Long English Title 的歌曲"].map((title, index) => ({
  id: index + 1, title, artist: "信乐团", artist_id: 1, album: "2004-海阔天空", album_id: 1,
  path: "fixture.flac", file_name: "fixture.flac", format: "FLAC", mime: "audio/flac", size_bytes: 14512800,
  duration_seconds: 231, sample_rate: 44100, bit_rate: 1411, bit_depth: 16, year: 2004,
  favorite: false, play_count: 0, resume_position_seconds: 0, has_lyrics: false, lyrics_source: "",
}));
const page = items => ({ items, total: items.length, page: 1, offset: 0, limit: 100 });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/")) {
    if (pathname.endsWith("/cover")) { res.writeHead(404).end(); return; }
    const favoriteMatch = pathname.match(/^\/api\/songs\/(\d+)\/favorite$/);
    if (favoriteMatch && req.method === "POST") {
      const song = songs.find(item => item.id === Number(favoriteMatch[1]));
      if (!song) { res.writeHead(404).end(); return; }
      song.favorite = !song.favorite;
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(song));
      return;
    }
    const responses = {
      "/api/auth/status": { initialized: true, user: { id: 1, username: "layout-fixture", nickname: "布局验证", role: "admin", avatar_data_url: "" } },
      "/api/settings": { language: "zh-CN", theme },
      "/api/me/preferences": {},
      "/api/me/ui-sounds": { enabled: false, volume: 0.5 },
      "/api/me/playback-history": { separate_by_device: false },
      "/api/playback/queue": { song_ids: [], current_id: 0 },
      "/api/library/stats": { songs: songs.length, albums: 1, artists: 1, playlists: 0 },
      "/api/library/review-summary": { incomplete_songs: 0 },
      "/api/songs/page": page(songs),
      "/api/songs": songs,
      "/api/albums/page": page([]),
      "/api/artists/page": page([]),
      "/api/playlists/page": page([]),
    };
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(responses[pathname] ?? []));
    return;
  }
  const path = resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!path.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
  try {
    const content = await readFile(path);
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon" };
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" }).end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const url = `http://127.0.0.1:${server.address().port}`;
  for (theme of checkedThemes) {
    await browser("set", "viewport", "1440", "900");
    await browser("open", url);
    await browser("wait", "--fn", `document.documentElement.dataset.theme === '${theme}' && !!document.querySelector('.desktop-sidebar')`);
    await browser("click", '.desktop-sidebar nav button[aria-label="曲库"]');
    await browser("wait", "--fn", "document.querySelectorAll('.song-row').length === 3");
    for (const width of checkedWidths) {
      await browser("set", "viewport", String(width), "900");
      const { result: rows } = await browser("eval", `Array.from(document.querySelectorAll('.song-row')).map(row => {
        const title = row.querySelector('.song-title-play strong');
        const artist = row.querySelector('.song-row-copy > .artist-link');
        const header = document.querySelector('.song-table-header > span:nth-child(2)');
        const actionHeader = document.querySelector('.song-table-header > span:last-child');
        const center = element => { const r = element.getBoundingClientRect(); return { x:r.x + r.width / 2, y:r.y + r.height / 2 }; };
        const textCenter = element => { const range = document.createRange(); range.selectNodeContents(element); const r = range.getBoundingClientRect(); return r.x + r.width / 2; };
        const cell = row.querySelector('.song-row-copy');
        const play = row.querySelector('.song-row-actions .song-row-play');
        const actionsElement = row.querySelector('.song-row-actions');
        const actions = actionsElement.getBoundingClientRect();
        const album = row.querySelector('.song-album');
        const quality = row.querySelector('.song-quality');
        const durationElement = row.querySelector('.song-duration');
        const duration = durationElement.getBoundingClientRect();
        const playBounds = play.getBoundingClientRect();
        return { title: title.textContent, titleX: textCenter(title), titleTruncated:title.scrollWidth > title.clientWidth, artistX: textCenter(artist), headerX: textCenter(header), cellX:center(cell).x, actionHeaderX:center(actionHeader).x, actionsX:center(actionsElement).x, albumVisible:getComputedStyle(album).display !== 'none', qualityVisible:getComputedStyle(quality).display !== 'none', durationVisible:getComputedStyle(durationElement).display !== 'none', playY:center(play).y, rowY:center(row).y, playInActions:playBounds.left >= actions.left && playBounds.right <= actions.right, playAfterDuration:playBounds.left > duration.right };
      })`);
      assert.equal(rows.length, songs.length, `${theme}: real song rows must render`);
      for (const row of rows) {
        if (!row.titleTruncated) assert.ok(Math.abs(row.titleX - row.cellX) <= 1, `${theme} ${width}px: ${row.title} title is not centered in its column`);
        assert.ok(Math.abs(row.artistX - row.cellX) <= 1, `${theme} ${width}px: ${row.title} artist is not centered in its column`);
        assert.ok(Math.abs(row.headerX - row.cellX) <= 1, `${theme} ${width}px: song header is not centered over its column`);
        assert.ok(Math.abs(row.actionHeaderX - row.actionsX) <= 1, `${theme} ${width}px: actions are not under the last column header`);
        assert.ok(row.albumVisible && row.durationVisible, `${theme} ${width}px: album and duration columns must remain visible`);
        if (width > 900) assert.ok(row.qualityVisible, `${theme} ${width}px: quality column must remain visible`);
        assert.ok(Math.abs(row.playY - row.rowY) <= 1, `${theme} ${width}px: play button is not vertically centered`);
        assert.ok(row.playInActions && row.playAfterDuration, `${theme} ${width}px: play button must be in the final actions column`);
      }
      if (theme === checkedThemes[0] && width === 1920 && process.env.LARK_SONG_LAYOUT_DESKTOP_SCREENSHOT)
        await browser("screenshot", process.env.LARK_SONG_LAYOUT_DESKTOP_SCREENSHOT);
    }
    console.log(`PASS ${theme}: titles, artists, headers and final-column playback controls align at ${checkedWidths.join("/")}px`);
  }
  await browser("set", "viewport", "375", "812");
  await browser("wait", "--fn", "document.querySelectorAll('.song-row').length === 3");
  const { result: mobileRows } = await browser("eval", `Array.from(document.querySelectorAll('.song-row')).map(row => {
    const cover = row.querySelector('.song-row-mobile-cover');
    const copy = row.querySelector('.song-row-copy');
    const actions = row.querySelector('.song-row-actions');
    const play = actions.querySelector('.song-row-play');
    const favorite = actions.querySelector('button[aria-pressed]');
    const more = actions.querySelector('.song-row-actions-more button');
    const rect = element => element.getBoundingClientRect();
    return { coverVisible:getComputedStyle(cover).display !== 'none', playVisible:getComputedStyle(play).display !== 'none', favoriteHidden:getComputedStyle(favorite).display === 'none', moreVisible:getComputedStyle(more).display !== 'none', inOrder:rect(cover).right < rect(copy).left && rect(copy).right < rect(actions).left, withinRow:rect(actions).right <= rect(row).right + 1 };
  })`);
  assert.equal(mobileRows.length, songs.length, "mobile: real song rows must render");
  for (const row of mobileRows) assert.ok(row.coverVisible && row.playVisible && row.favoriteHidden && row.moreVisible && row.inOrder && row.withinRow, "mobile: cover, title, play and more must fit with controls on the right");
  if (process.env.LARK_SONG_LAYOUT_SCREENSHOT) await browser("screenshot", process.env.LARK_SONG_LAYOUT_SCREENSHOT);
  await browser("click", ".song-row .song-row-actions-more button");
  await browser("wait", "--fn", "!!document.querySelector('.song-row-more-menu > button[role=menuitem]')");
  const { result: favoriteMenuVisible } = await browser("eval", `document.querySelector('.song-row-more-menu > button[role=menuitem]')?.textContent.includes('添加收藏')`);
  assert.ok(favoriteMenuVisible, "mobile: favorite must be available in the more menu");
  await browser("click", ".song-row-more-menu > button[role=menuitem]");
  await browser("wait", "--fn", "document.querySelector('.song-row .song-row-favorite')?.getAttribute('aria-pressed') === 'true'");
  console.log("PASS mobile 375px: cover, title, right-side controls and favorite menu work");
} finally {
  await browser("close").catch(() => undefined);
  await new Promise(resolve => server.close(resolve));
}
