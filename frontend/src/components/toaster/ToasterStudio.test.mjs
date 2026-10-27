import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { exportFilename, visibleCodeParts } from "./workspace.ts";

function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (!Array.isArray(node) && predicate(node)) return node;
  for (const child of [Array.isArray(node) ? node : node.props?.children].flat()) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
const byClass = (tree, name) => find(tree, node => node.props?.className === name);
const button = (tree, key) => find(tree, node => node.type === "button" && node.props["aria-hidden"] !== true && find(node, child => child.type === "span" && child.props.children === key));
const recovery = tree => button(byClass(tree, "toaster-signal-status"), "toasterRetryAnalysis");

function host({ clipboard, bars = 0, songFiles = async () => null } = {}) {
  const slots = [], cleanups = new Map(), timers = new Map(), clicks = [], revoked = [], blobs = new Map();
  const calls = { enableAnalysis: 0, retry: 0 };
  let cursor = 0, effects = [], nextTimer = 0, nextURL = 0, disposed = false, lateUpdates = 0, selected = 0, focused = 0, now = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { if (disposed) lateUpdates++; slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useId() { return `toaster-${cursor++}`; },
    useMemo: fn => fn(), useCallback: fn => fn,
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, effect()); });
      slots[index] = deps;
    },
  };
  const code = '// 夜航\nsetcpm(120/4)\n$: note("c3").s("piano")';
  const state = {
    snapshot: { lines: [], bpm: 120, key: "C minor", bar: 0, step: 0, locked: true, energy: 0.3, bass: 0.3, treble: 0.1, beat: 0.2, bands: [], patterns: {}, recordedBars: bars },
    code, connection: "ready", visible: true, revision: 0,
    sessionRef: { current: { songFiles } }, revisionRef: { current: 0 }, retry() { calls.retry++; }, tap() {},
  };
  const query = { matches: false, addEventListener() {}, removeEventListener() {} };
  const browserWindow = {
    matchMedia: () => query,
    setTimeout(fn, delay = 0) { timers.set(++nextTimer, { fn, due: now + delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  };
  const document = {
    body: { append() {} },
    createElement: () => ({ click() { clicks.push({ href: this.href, filename: this.download }); }, remove() {} }),
  };
  const modules = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@phosphor-icons/react": new Proxy({}, { get: (_, key) => key }),
    "../../i18n": { createT: () => key => key },
    "../../features/toaster/session": { strudelLink: () => "https://strudel.cc/#source" },
    "./ToasterVisualizer": { default: "visualizer" },
    "./useToasterPlayback": { useToasterPlayback: () => state },
    "./workspace": { exportFilename, visibleCodeParts }, "./toaster-studio.css": {},
  };
  const source = readFileSync(new URL("./ToasterStudio.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, require: name => { assert.ok(name in modules, name); return modules[name]; },
    navigator: { clipboard }, document, window: browserWindow, Intl, Blob,
    URL: { createObjectURL(blob) { const url = `blob:toaster-${++nextURL}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } },
  });
  const props = { audio: {}, playing: true, available: true, meta: { mediaKey: "one", title: "夜航", artist: "乐队" }, language: "en-US", onBack() {}, onTogglePlayback() {}, onEnableAnalysis() { calls.enableAnalysis++; } };
  const render = (update = {}) => {
    Object.assign(props, update);
    cursor = 0;
    effects = [];
    const tree = exports.default(props);
    const textarea = find(tree, node => node.type === "textarea");
    if (textarea) textarea.props.ref.current = { focus() { focused++; }, select() { selected++; } };
    effects.forEach(effect => effect());
    return tree;
  };
  render();
  return {
    code, state, clicks, revoked, blobs, render, calls, props,
    get focused() { return focused; }, get selected() { return selected; }, get lateUpdates() { return lateUpdates; },
    get pendingTimers() { return timers.size; },
    advance(milliseconds) {
      const end = now + milliseconds;
      let next;
      while ((next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0])) {
        const [id, timer] = next;
        now = timer.due;
        timers.delete(id);
        timer.fn();
        if (!disposed) render();
      }
      now = end;
      return disposed ? undefined : render();
    },
    async click(key) { const target = button(render(), key); assert.ok(target, key); target.props.onClick(); await new Promise(setImmediate); },
    dispose() { disposed = true; state.revisionRef.current++; for (const cleanup of cleanups.values()) cleanup?.(); },
  };
}

test("clipboard denial retains source, reveals a selected manual copy field and keeps downloads available", async () => {
  const h = host({ clipboard: { writeText: async () => { throw new Error("permission denied"); } } });
  await h.click("toasterCopy");
  const tree = h.render();
  assert.equal(find(tree, node => node.type === "textarea").props.value, h.code);
  assert.equal(find(byClass(tree, "toaster-code-content"), node => node.type === "code").props.children, h.code);
  assert.equal(byClass(tree, "toaster-notice").props["data-error"], true);
  assert.equal(button(tree, "toasterDownloadCode").props.disabled, false);
  assert.ok(h.focused && h.selected);
  h.dispose();
});

test("current Strudel downloads before any recorded bars and its object URL is released on exit", async () => {
  const h = host();
  assert.equal(button(h.render(), "toasterDownloadMidi").props.disabled, true);
  await h.click("toasterDownloadCode");
  assert.equal(h.clicks.length, 1);
  assert.equal(h.clicks[0].filename, "乐队 - 夜航.strudel");
  assert.equal(await h.blobs.get(h.clicks[0].href).text(), h.code);
  h.dispose();
  assert.deepEqual(h.revoked, [h.clicks[0].href]);
});

test("MIDI uses the asynchronous song files and explains its four-bar gate", async () => {
  let resolve;
  const h = host({ bars: 3, songFiles: () => new Promise(done => { resolve = done; }) });
  let tree = h.render();
  const action = button(tree, "toasterDownloadMidi");
  assert.equal(action.props.disabled, true);
  assert.equal(byClass(tree, "toaster-export-hint").props.id, action.props["aria-describedby"]);
  h.state.snapshot = { ...h.state.snapshot, recordedBars: 4 };
  await h.click("toasterDownloadMidi");
  tree = h.render();
  assert.equal(button(tree, "toasterMidiExporting").props.disabled, true);
  assert.equal(button(tree, "toasterMidiExporting").props["aria-busy"], true);
  resolve({ code: h.code, midi: new Uint8Array([77, 84, 104, 100]), bars: 4 });
  await new Promise(setImmediate);
  assert.equal(h.clicks[0].filename, "乐队 - 夜航.mid");
  assert.equal(h.blobs.get(h.clicks[0].href).type, "audio/midi");
  assert.deepEqual([...new Uint8Array(await h.blobs.get(h.clicks[0].href).arrayBuffer())], [77, 84, 104, 100]);
  assert.equal(button(h.render(), "toasterDownloadMidi").props.disabled, false);
  h.dispose();
});

test("export rejection shows a useful failure and leaves generated code available", async () => {
  const h = host({ bars: 4, songFiles: async () => { throw new Error("worker failed"); } });
  await h.click("toasterDownloadMidi");
  const tree = h.render();
  assert.ok(find(byClass(tree, "toaster-notice"), node => node.type === "span" && node.props.children === "toasterMidiExportFailed"));
  assert.equal(button(tree, "toasterCopy").props.disabled, false);
  assert.equal(button(tree, "toasterDownloadCode").props.disabled, false);
  assert.equal(h.clicks.length, 0);
  h.dispose();
});

test("leaving during a pending MIDI export prevents late downloads and UI updates", async () => {
  let resolve;
  const h = host({ bars: 4, songFiles: () => new Promise(done => { resolve = done; }) });
  await h.click("toasterDownloadMidi");
  h.dispose();
  resolve({ code: h.code, midi: new Uint8Array([77, 84, 104, 100]), bars: 4 });
  await new Promise(setImmediate);
  assert.equal(h.clicks.length, 0);
  assert.equal(h.lateUpdates, 0);
});


test("sustained silence offers user-triggered recovery after 1.5 seconds while retaining its session and generated code", async () => {
  const h = host({ bars: 8 });
  h.state.snapshot = { ...h.state.snapshot, energy: 0 };
  const session = h.state.sessionRef.current;
  const revision = h.state.revisionRef.current;
  let tree = h.render();
  assert.equal(byClass(tree, "toaster-signal-status").props["data-active"], false);
  assert.equal(recovery(tree), undefined, "zero energy must not immediately offer recovery");
  for (let update = 0; update < 14; update++) {
    h.state.snapshot = { ...h.state.snapshot, energy: 0 };
    assert.equal(recovery(h.advance(100)), undefined, "100 ms snapshots must not expose recovery early");
  }
  assert.equal(recovery(h.advance(99)), undefined);
  tree = h.advance(1);
  assert.ok(recovery(tree));
  assert.equal(recovery(tree).props.disabled, false);
  assert.equal(byClass(tree, "toaster-source-state"), undefined, "the existing ready session needs no blocking source overlay");
  assert.deepEqual(h.calls, { enableAnalysis: 0, retry: 0 }, "rendering must not resume audio autonomously");
  await h.click("toasterRetryAnalysis");
  tree = h.render();
  assert.deepEqual(h.calls, { enableAnalysis: 1, retry: 1 });
  assert.equal(h.state.sessionRef.current, session);
  assert.equal(h.state.revisionRef.current, revision);
  assert.equal(h.state.snapshot.recordedBars, 8);
  assert.equal(h.state.code, h.code);
  assert.equal(find(byClass(tree, "toaster-code-content"), node => node.type === "code").props.children, h.code);
  h.dispose();
});

test("signal recovery is hidden for real signal, paused or hidden views and preserves source-blocked recovery", () => {
  const h = host();
  assert.equal(recovery(h.render()), undefined, "audible playback needs no recovery action");
  h.state.snapshot = { ...h.state.snapshot, energy: 0 };
  assert.equal(recovery(h.render({ playing: false })), undefined);
  h.state.visible = false;
  assert.equal(recovery(h.render({ playing: true })), undefined);
  h.state.visible = true;
  assert.equal(recovery(h.render({ available: false })), undefined);
  assert.equal(recovery(h.render({ available: true, audio: null })), undefined);
  h.state.connection = "waiting";
  let tree = h.render({ audio: {} });
  assert.equal(recovery(tree), undefined);
  assert.ok(find(byClass(tree, "toaster-source-state"), node => node.type === "button" && node.props.children === "toasterEnableAnalysis"));
  h.state.connection = "error";
  tree = h.render();
  assert.equal(recovery(tree), undefined);
  assert.ok(find(byClass(tree, "toaster-source-state"), node => node.type === "button" && node.props.children === "toasterRetryAnalysis"));
  h.dispose();
});

test("200 ms sound and 300 ms beat gaps keep recovery hidden in the same reserved action slot", () => {
  const h = host();
  const layoutSlots = tree => byClass(tree, "toaster-signal-status").props.children.map(child => child && [child.type, child.props?.className]);
  const slots = layoutSlots(h.render());
  for (let beat = 0; beat < 8; beat++) {
    h.state.snapshot = { ...h.state.snapshot, energy: 0.3 };
    assert.equal(byClass(h.render(), "toaster-signal-status").props["data-active"], true);
    h.advance(200);
    h.state.snapshot = { ...h.state.snapshot, energy: 0 };
    let tree = h.render();
    assert.equal(byClass(tree, "toaster-signal-status").props["data-active"], false, "measured silence stays truthful immediately");
    for (let update = 0; update < 3; update++) {
      assert.equal(recovery(tree), undefined, "an ordinary beat gap needs no recovery action");
      const reserved = byClass(tree, "toaster-button toaster-signal-retry");
      assert.ok(reserved, "keep the action footprint reserved while it is hidden");
      assert.equal(reserved.props["aria-hidden"], true);
      assert.equal(reserved.props.disabled, true);
      assert.equal(reserved.props.hidden, undefined, "do not remove the reserved action from layout");
      assert.deepEqual(layoutSlots(tree), slots);
      h.state.snapshot = { ...h.state.snapshot, energy: 0 };
      tree = h.advance(100);
    }
    assert.equal(recovery(tree), undefined);
  }
  assert.deepEqual(h.calls, { enableAnalysis: 0, retry: 0 });
  h.dispose();
});

test("the recovery delay resets on restored signal, pause, hiding, availability, audio and media changes", () => {
  const interruptions = [
    { name: "restored signal", reset(h) { h.state.snapshot = { ...h.state.snapshot, energy: 0.3 }; }, resume(h) { h.state.snapshot = { ...h.state.snapshot, energy: 0 }; } },
    { name: "pause", reset: () => ({ playing: false }), resume: () => ({ playing: true }) },
    { name: "hidden workspace", reset(h) { h.state.visible = false; }, resume(h) { h.state.visible = true; } },
    { name: "unavailable analysis", reset: () => ({ available: false }), resume: () => ({ available: true }) },
    { name: "missing audio", reset: () => ({ audio: null }), resume: () => ({ audio: {} }) },
    { name: "waiting connection", reset(h) { h.state.connection = "waiting"; }, resume(h) { h.state.connection = "ready"; } },
    { name: "media revision", reset(h) { h.state.revision++; h.state.revisionRef.current++; }, resume() {} },
    { name: "media key", reset(h) { return { meta: { ...h.props.meta, mediaKey: `${h.props.meta.mediaKey}-new` } }; }, resume() {} },
  ];
  for (const interruption of interruptions) {
    const h = host();
    h.state.snapshot = { ...h.state.snapshot, energy: 0 };
    h.render();
    for (let round = 0; round < 2; round++) {
      h.advance(1000);
      assert.equal(recovery(h.render(interruption.reset(h))), undefined, `${interruption.name} must immediately hide recovery`);
      assert.equal(recovery(h.render(interruption.resume(h))), undefined, `${interruption.name} must start a fresh delay`);
      assert.equal(h.pendingTimers, 1, `${interruption.name} must replace the previous timer`);
      assert.equal(recovery(h.advance(1499)), undefined, `${interruption.name} must not inherit elapsed silence`);
      assert.ok(recovery(h.advance(1)), `${interruption.name} must allow recovery after a new full delay`);
    }
    h.dispose();
    assert.equal(h.pendingTimers, 0);
  }
});

test("the recovery timer is cancelled on exit without late UI updates", () => {
  const h = host();
  h.state.snapshot = { ...h.state.snapshot, energy: 0 };
  h.render();
  h.advance(1499);
  assert.equal(h.pendingTimers, 1);
  h.dispose();
  assert.equal(h.pendingTimers, 0);
  h.advance(5000);
  assert.equal(h.lateUpdates, 0);
  assert.deepEqual(h.calls, { enableAnalysis: 0, retry: 0 });
});
