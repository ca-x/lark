import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const album = (id) => ({ id, title: `Album ${id}`, artist: `Artist ${id}`, artist_id: id, album_artist: `Artist ${id}`, year: 2026, favorite: false, song_count: 2 });
const song = (id, albumId) => ({ id, album_id: albumId, album: `Album ${albumId}`, artist: `Artist ${albumId}`, artist_id: albumId, year: 2026, title: `Song ${id}`, duration_seconds: 180 });

function host(current = song(1, 1)) {
  const slots = []; let cursor = 0, effects = [], layoutEffects = [];
  const observers = [], frames = [];
  const browserWindow = { innerHeight: 1000, setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {} };
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useMemo: (fn) => fn(),
    useLayoutEffect(fn) { layoutEffects.push(fn); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i][j]))) effects.push(fn); slots[i] = deps; },
  };
  const requests = [];
  const modules = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@phosphor-icons/react": new Proxy({}, { get: (_, key) => key }),
    "../../services/api": { api: {
      albumsPage: async () => ({ items: [album(1), album(2)], total: 1000, offset: 0, page: 1 }),
      albumSongs: async (id) => { requests.push(id); return [song(id * 10, id), song(id * 10 + 1, id)]; },
    } },
    "../../utils/app": { albumCoverUrl: (value) => value ? `/api/albums/${value.id}/cover` : undefined, coverUrl: (value) => value ? `/api/songs/${value.id}/cover` : undefined },
    "../../constants": { COLLECTION_LOAD_TIMEOUT_MS: 1000, MAX_PLAYBACK_QUEUE_SIZE: 500 },
    "../../hooks/useMediaQuery": { useMediaQuery: () => false },
    "./animationActivity": { createAnimationActivity: () => ({ dispose() {} }) },
    "./useDiscScratchSeek": { useDiscScratchSeek: ({ progress }) => ({ progress, pct: 0, scratching: false, scratchProps: {} }) },
    "./useCoverFallback": { useCoverFallback: (url) => ({ displayUrl: url }) },
  };
  const source = process.env.LARK_VINYL_TEST_SOURCE ? readFileSync(process.env.LARK_VINYL_TEST_SOURCE, "utf8") : process.env.LARK_UI_TEST_REF
    ? execFileSync("git", ["show", `${process.env.LARK_UI_TEST_REF}:frontend/src/components/player-themes/VinylCollectionPlayer.tsx`], { encoding: "utf8" })
    : readFileSync(new URL("./VinylCollectionPlayer.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require(name) { if (name.endsWith('.svg')) return name; assert.ok(name in modules, name); return modules[name]; }, AbortController, window: browserWindow,
    ResizeObserver: class { constructor(callback) { observers.push(callback); } observe() {} disconnect() {} },
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; }, cancelAnimationFrame() {},
    getComputedStyle: () => ({ paddingLeft: "26" }) });
  let props = { albums: [album(1), album(2)], current, playing: true, progress: 30, duration: 180, volume: .5, playMode: "sequence", playModeLabel: "mode", t: (key) => key, onPlay() {}, onToggle() {}, onPrevious() {}, onNext() {}, onSeek() {}, onVolume() {}, onCyclePlayMode() {} };
  const render = (next = {}) => { props = { ...props, ...next }; cursor = 0; effects = []; layoutEffects = []; const tree = exports.VinylCollectionPlayer(props); for (const effect of effects) effect(); return tree; };
  return { requests, render,
    sizingFixture(tree) {
      const values = new Map(), writes = [];
      const deck = { offsetHeight: 300, parentElement: { offsetHeight: 420 } };
      const sleeve = { offsetHeight: 250, parentElement: { offsetHeight: 320 } };
      const player = {
        clientWidth: 1252, offsetHeight: 800, closest: () => null, getBoundingClientRect: () => ({ top: 100 }),
        style: { getPropertyValue: (key) => values.get(key) ?? "", setProperty: (key, value) => { values.set(key, value); writes.push(value); } },
        querySelector: (selector) => ({ ".vc-listening-room": { offsetHeight: 420 }, ".vc-shelf": { offsetHeight: 160, querySelector: () => ({ offsetHeight: 104 }) }, ".vc-sleeve-stage": sleeve })[selector],
      };
      tree.props.ref.current = player;
      byClass(tree, "vc-deck").props.ref.current = deck;
      layoutEffects[0]();
      return { writes, resize() { browserWindow.innerHeight = 700; assert.ok(observers.length); observers[0](); }, flush() { const pending = frames.splice(0); for (const frame of pending) frame(); } };
    },
    async settle(next = {}) { render(next); await new Promise(setImmediate); return render(); } };
}
function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (!Array.isArray(node) && predicate(node)) return node;
  for (const child of [Array.isArray(node) ? node : node.props?.children].flat()) { const result = find(child, predicate); if (result) return result; }
}
const byClass = (tree, name) => find(tree, (node) => node.props?.className === name);
const selection = (tree) => byClass(tree, "vc-sleeve-front").props.children[1].props.children[0].props.children;

test("playing an album outside loaded pages keeps its sleeve and tracks after page loading", async () => {
  const h = host(song(990, 99));
  assert.equal(selection(h.render()), "Album 99");
  assert.equal(selection(await h.settle()), "Album 99");
  assert.ok(h.requests.includes(99));
});

test("external track changes synchronize album, active row and cover", async () => {
  const h = host(song(10, 1)); await h.settle();
  const tree = await h.settle({ current: song(20, 2) });
  assert.equal(selection(tree), "Album 2");
  assert.equal(find(tree, (node) => node.props?.['aria-current'] === 'true').props['aria-label'], 'play Song 20');
  const label = byClass(byClass(tree, 'vc-rotor'), 'vc-disc-label');
  assert.equal(label.props.children[0].props.src, '/api/albums/2/cover');
});

test("manual browsing survives progress updates but follows the next track, including repeat visits", async () => {
  const h = host(song(10, 1)); let tree = await h.settle();
  find(tree, (node) => node.props?.['aria-label'] === 'Album 2 · Artist 2').props.onClick();
  assert.equal(selection(h.render({ progress: 40 })), 'Album 2');
  assert.equal(selection(h.render({ current: song(990, 99) })), 'Album 99');
  assert.equal(selection(h.render({ current: song(10, 1) })), 'Album 1');
});

test("record texture and album art share the rotor while hardware remains stationary", () => {
  const tree = host().render(); const rotor = byClass(tree, 'vc-rotor');
  assert.ok(find(rotor, (node) => node.type === 'img' && node.props.src.endsWith('/record.svg')));
  assert.ok(byClass(rotor, 'vc-disc-label'));
  assert.equal(byClass(rotor, 'vc-deck-layer vc-fixtures'), undefined);
  assert.ok(byClass(tree, 'vc-deck-layer vc-fixtures'));
});


test("resize observation schedules size writes outside the observer callback", () => {
  const h = host(); const fixture = h.sizingFixture(h.render());
  const initialWrites = fixture.writes.length;
  assert.ok(initialWrites > 0);
  fixture.resize();
  assert.equal(fixture.writes.length, initialWrites, "must not resize the observed element inside its observer");
  fixture.flush();
  assert.ok(fixture.writes.length > initialWrites, "the next frame must apply the new available height");
});
