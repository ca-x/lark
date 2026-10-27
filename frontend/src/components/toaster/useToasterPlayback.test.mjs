import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

class Events extends EventTarget {
  listeners = new Map();
  addEventListener(name, callback, options) {
    const listeners = this.listeners.get(name) || new Set();
    listeners.add(callback);
    this.listeners.set(name, listeners);
    super.addEventListener(name, callback, options);
  }
  removeEventListener(name, callback, options) {
    this.listeners.get(name)?.delete(callback);
    super.removeEventListener(name, callback, options);
  }
  emit(name) { this.dispatchEvent(new Event(name)); }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function host({ ready = true, hidden = false, available = true } = {}) {
  const slots = [], cleanups = new Map(), frames = new Map(), sessions = [], paints = [];
  let cursor = 0, effects = [], now = 0, nextFrame = 0, attempts = 0, observer, throwTick = false;
  const audio = Object.assign(new Events(), { paused: false, ended: false, seeking: false });
  const document = Object.assign(new Events(), { hidden });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index][i]))) {
        effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, effect()); });
      }
      slots[index] = deps;
    },
  };
  const snapshot = () => ({ lines: [], bpm: null, key: "", bar: null, step: null, locked: false, energy: 0, bass: 0, treble: 0, beat: 0, bands: [], patterns: {}, recordedBars: 0 });
  const createToasterSession = (_audio, initialMeta) => {
    attempts++;
    if (!ready) return null;
    let meta = initialMeta, source = "";
    const session = {
      ticks: [], disposed: false, resets: 0, metadata: [],
      tick(time, playing) {
        if (throwTick && playing) throw new Error("graph failed");
        this.ticks.push({ time, playing });
        if (playing) source = `// ${meta.title}`;
        return { ...snapshot(), energy: playing ? 0.5 : 0 };
      },
      setMeta(next) { this.metadata.push(next); if (next.mediaKey !== meta.mediaKey) source = ""; meta = next; },
      reset() { this.resets++; source = ""; },
      code: () => source,
      dispose() { this.disposed = true; },
      tap() {},
    };
    sessions.push(session);
    return session;
  };
  const source = readFileSync(new URL("./useToasterPlayback.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  const modules = { react, "../../features/toaster/session": { createToasterSession }, "../../services/audioAnalysis": { AUDIO_ANALYSIS_READY: "ready" } };
  vm.runInNewContext(outputText, {
    exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, document,
    performance: { now: () => now }, requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    IntersectionObserver: class {
      constructor(callback) { observer = { callback, disconnected: false }; }
      observe() {}
      disconnect() { observer.disconnected = true; }
    },
  });
  let props = { audio, playing: true, available, meta: { mediaKey: "one", title: "夜航", artist: "Test" }, hostRef: { current: {} }, onFrame: (...args) => paints.push(args) };
  const render = (update = {}) => {
    props = { ...props, ...update };
    cursor = 0;
    effects = [];
    const result = exports.useToasterPlayback(props);
    effects.forEach(effect => effect());
    return result;
  };
  render();
  return {
    audio, document, sessions, paints, render,
    get attempts() { return attempts; }, get pendingFrames() { return frames.size; }, get observer() { return observer; },
    setReady(value) { ready = value; }, setTickFailure(value) { throwTick = value; },
    advance(milliseconds = 120) { now += milliseconds; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); },
    setHidden(value) { document.hidden = value; document.emit("visibilitychange"); },
    setOnScreen(value) { observer.callback([{ isIntersecting: value, intersectionRatio: value ? 1 : 0 }]); },
    dispose() { for (const cleanup of cleanups.values()) cleanup?.(); },
  };
}

test("graph readiness retries the existing audio element and creates one mounted session", () => {
  const h = host({ ready: false });
  assert.equal(h.sessions.length, 0);
  assert.equal(h.render().connection, "waiting");
  assert.equal(h.pendingFrames, 0);
  h.setReady(true);
  h.audio.emit("ready");
  assert.equal(h.sessions.length, 1);
  h.audio.emit("canplay");
  h.audio.emit("playing");
  assert.equal(h.sessions.length, 1);
  assert.equal(h.render().connection, "ready");
  assert.equal(h.pendingFrames, 1);
  h.dispose();
});

test("pause, hidden documents and hidden workspace suspend sampling without losing code", () => {
  const h = host();
  h.advance();
  assert.equal(h.render().code, "// 夜航");
  h.render({ playing: false });
  assert.equal(h.pendingFrames, 0);
  assert.equal(h.sessions[0].ticks.at(-1).playing, false);
  assert.equal(h.render().code, "// 夜航");
  h.render({ playing: true });
  h.setHidden(true);
  assert.equal(h.pendingFrames, 0);
  const count = h.sessions[0].ticks.length;
  h.advance(20_000);
  assert.equal(h.sessions[0].ticks.length, count);
  h.setHidden(false);
  assert.equal(h.pendingFrames, 1);
  h.setOnScreen(false);
  assert.equal(h.pendingFrames, 0);
  assert.equal(h.render().visible, false);
  h.setOnScreen(true);
  assert.equal(h.pendingFrames, 1);
  assert.equal(h.sessions.length, 1);
  h.dispose();
});

test("seek and media replacement invalidate UI exports while the facade owns resets", () => {
  const h = host();
  h.advance();
  const before = h.render().revisionRef.current;
  h.audio.seeking = true;
  h.audio.emit("seeking");
  assert.equal(h.pendingFrames, 0);
  assert.equal(h.render().code, "");
  assert.ok(h.render().revisionRef.current > before);
  assert.equal(h.sessions[0].resets, 0, "the UI must not duplicate facade seek resets");
  h.audio.seeking = false;
  h.audio.emit("seeked");
  h.render({ meta: { mediaKey: "two", title: "新曲", artist: "Test" } });
  assert.equal(h.sessions[0].metadata.at(-1).mediaKey, "two");
  assert.equal(h.render().code, "");
  assert.equal(h.sessions.length, 1);
  h.dispose();
});

test("unavailable and initially hidden views do not create audio sessions", () => {
  const unavailable = host({ available: false });
  assert.equal(unavailable.attempts, 0);
  assert.equal(unavailable.render().connection, "unavailable");
  unavailable.dispose();
  const hidden = host({ hidden: true });
  assert.equal(hidden.attempts, 0);
  hidden.setHidden(false);
  assert.equal(hidden.sessions.length, 1);
  hidden.dispose();
});

test("changing audio availability invalidates pending export state and disconnects the previous session", () => {
  const h = host();
  h.advance();
  const before = h.render().revision;
  h.render({ available: false });
  const state = h.render();
  assert.ok(state.revision > before);
  assert.equal(state.revision, state.revisionRef.current);
  assert.equal(h.sessions[0].disposed, true);
  assert.equal(h.pendingFrames, 0);
  assert.equal(h.paints.at(-1)[1], false);
  assert.equal(state.code, "// 夜航", "the last generated source remains exportable");
  h.dispose();
});

test("graph errors stop and dispose sampling, then a user retry can reconnect", () => {
  const h = host();
  h.setTickFailure(true);
  h.advance();
  assert.equal(h.render().connection, "error");
  assert.equal(h.sessions[0].disposed, true);
  assert.equal(h.pendingFrames, 0);
  h.setTickFailure(false);
  h.render().retry();
  assert.equal(h.sessions.length, 2);
  assert.equal(h.render().connection, "ready");
  h.dispose();
});

test("exit cancels RAF, observers and listeners, disposes the session and invalidates pending exports", () => {
  const h = host();
  const state = h.render(), before = state.revisionRef.current;
  assert.ok(h.audio.listenerCount > 0);
  h.dispose();
  assert.equal(h.pendingFrames, 0);
  assert.equal(h.observer.disconnected, true);
  assert.equal(h.audio.listenerCount, 0);
  assert.equal(h.document.listenerCount, 0);
  assert.equal(h.sessions[0].disposed, true);
  assert.ok(state.revisionRef.current > before);
  const attempts = h.attempts;
  h.audio.emit("ready");
  h.advance();
  assert.equal(h.attempts, attempts);
});
