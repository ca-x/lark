import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as mygo from "../features/plugins/mygo.ts";

const plugin = (id = "demo", extra = {}) => ({ manifest: { id, name: `${id} source` }, enabled: true, exports: ["search"], identity: `identity-${id}`, digest: "digest", origin: "origin", ...extra });
const track = (id, extra = {}) => ({ id, name: `Track ${id}`, duration: 12000, ...extra });
const jsx = (type, props, key) => ({ type, props, key });

function findAll(node, predicate) {
  if (!node || typeof node !== "object") return [];
  const found = !Array.isArray(node) && predicate(node) ? [node] : [];
  for (const child of [Array.isArray(node) ? node : node.props?.children].flat()) found.push(...findAll(child, predicate));
  return found;
}

function harness() {
  let current;
  let timerId = 0;
  const timers = new Map();
  const calls = [];
  const exports = {};
  const source = readFileSync(new URL("./MygoSearchResults.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, {
    exports, AbortController, Error,
    window: { setTimeout(callback, delay) { assert.equal(delay, 300); timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); } },
    require(name) {
      if (name === "react") return {
        useState(initial) {
          const instance = current;
          const index = instance.cursor++;
          if (!(index in instance.slots)) instance.slots[index] = initial;
          return [instance.slots[index], (value) => { instance.writes++; instance.slots[index] = typeof value === "function" ? value(instance.slots[index]) : value; }];
        },
        useRef(initial) {
          const index = current.cursor++;
          return current.slots[index] ||= { current: initial };
        },
        useEffect(effect, dependencies) {
          const instance = current;
          const index = instance.cursor++;
          const previous = instance.slots[index];
          if (!previous || dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))) {
            instance.pending.push(() => { previous?.cleanup?.(); instance.slots[index] = { dependencies, cleanup: effect() }; });
          }
        },
      };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@phosphor-icons/react") return { MusicNotes: "MusicNotes", Play: "Play", ArrowSquareOut: "ArrowSquareOut" };
      if (name === "../features/plugins/mygo") return mygo;
      if (name === "../services/api") return { api: { mygoCall(...args) { return new Promise((resolve, reject) => calls.push({ args, resolve, reject })); } } };
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected module ${name}`);
    },
  });
  const props = { query: "test", sources: [plugin()], t: (key) => key, onPlay() {}, onOpenSource() {} };
  function mount(component, values) {
    const instance = { cursor: 0, slots: [], pending: [], writes: 0 };
    return {
      instance,
      render() {
        current = instance; instance.cursor = 0;
        const tree = component(values);
        instance.pending.splice(0).forEach((effect) => effect());
        return tree;
      },
      unmount() { instance.slots.forEach((slot) => slot?.cleanup?.()); },
    };
  }
  function parent(values = {}) { return exports.MygoSearchResults({ ...props, ...values }); }
  function groups(values = {}) { return findAll(parent(values), (node) => typeof node.type === "function").map((node) => mount(node.type, node.props)); }
  function flushTimers() { const ready = [...timers.values()]; timers.clear(); ready.forEach((callback) => callback()); }
  return { calls, timers, parent, groups, mount, flushTimers };
}

function button(tree, text) { return findAll(tree, (node) => node.type === "button" && node.props.children === text)[0]; }
function rows(tree) { return findAll(tree, (node) => node.props.className === "mygo-search-track"); }

test("only enabled sources exporting search render, and query/source identity isolate result instances", () => {
  const host = harness();
  assert.equal(host.parent({ query: "  " }), null);
  assert.equal(host.parent({ sources: [plugin("disabled", { enabled: false }), plugin("stream", { exports: ["stream"] })] }), null);
  const group = (values) => findAll(host.parent(values), (node) => typeof node.type === "function")[0];
  assert.equal(group({ query: " test " }).key, group({ query: "test" }).key);
  assert.notEqual(group({ query: "next" }).key, group({}).key);
  assert.notEqual(group({ sources: [plugin("demo", { identity: "replacement" })] }).key, group({}).key);
  assert.notEqual(group({ sources: [plugin("demo", { digest: "replacement" })] }).key, group({}).key);
});

test("debounce cancels unmounted queries and aborts pending requests without late state writes", async () => {
  const host = harness();
  const [previous] = host.groups();
  previous.render();
  assert.equal(host.calls.length, 0);
  previous.unmount(); host.flushTimers();
  assert.equal(host.calls.length, 0);
  const [current] = host.groups({ query: "next" });
  current.render(); host.flushTimers();
  assert.equal(host.calls.length, 1);
  const call = host.calls[0];
  assert.equal(call.args[0], "demo");
  assert.equal(call.args[1], "search");
  assert.deepEqual({ ...call.args[2] }, { query: "next", kind: "tracks", offset: 0 });
  assert.equal(call.args[3], "identity-demo");
  current.unmount();
  assert.equal(call.args[4].aborted, true);
  const writes = current.instance.writes;
  call.resolve({ tracks: [track("late")] }); await setImmediate();
  assert.equal(current.instance.writes, writes);
});

test("sources settle independently and source headings open their original source", async () => {
  const host = harness();
  const sources = [plugin("slow"), plugin("fast")];
  let opened;
  const [slow, fast] = host.groups({ sources, onOpenSource: (source) => { opened = source; } });
  slow.render(); fast.render(); host.flushTimers();
  host.calls[1].resolve({ tracks: [track("ready")] }); await setImmediate();
  assert.equal(slow.render().props["aria-busy"], true);
  const tree = fast.render();
  assert.equal(tree.props["aria-busy"], false);
  assert.equal(rows(tree).length, 1);
  findAll(tree, (node) => node.props.className === "mygo-search-source-link")[0].props.onClick();
  assert.equal(opened, sources[1]);
  slow.unmount(); fast.unmount();
});

test("pagination is manual, counts raw tracks plus episodes, and retries its failed offset", async () => {
  const host = harness();
  const [group] = host.groups();
  group.render(); host.flushTimers();
  host.calls[0].resolve({ tracks: [track("one"), track("blocked", { unavailable: true })], episodes: [track("episode")], more: true });
  await setImmediate();
  assert.equal(host.calls.length, 1);
  let tree = group.render();
  assert.equal(rows(tree)[1].props.disabled, true);
  button(tree, "nextPage").props.onClick();
  assert.equal(host.calls[1].args[2].offset, 3);
  host.calls[1].reject(new Error("temporary failure")); await setImmediate();
  tree = group.render();
  assert.equal(rows(tree).length, 3);
  assert.equal(findAll(tree, (node) => node.props.role === "alert")[0].props.children, "temporary failure");
  button(tree, "retry").props.onClick();
  assert.equal(host.calls[2].args[2].offset, 3);
  host.calls[2].resolve({ tracks: [track("last")], more: false }); await setImmediate();
  tree = group.render();
  assert.equal(rows(tree).length, 4);
  assert.equal(button(tree, "nextPage"), undefined);
  group.unmount();
});

test("playback receives all loaded playable songs from only this source and identity-bound artwork", async () => {
  const host = harness();
  let played;
  const [group] = host.groups({ onPlay: (song, list) => { played = { song, list }; } });
  group.render(); host.flushTimers();
  host.calls[0].resolve({ tracks: [track("one", { album: { imageUrl: "https://cdn.example/art.jpg" } }), track("blocked", { unavailable: true })], episodes: [track("episode")] });
  await setImmediate();
  const tree = group.render();
  rows(tree)[2].props.onClick();
  assert.equal(played.song.mygo.track, "episode");
  assert.deepEqual(Array.from(played.list, (song) => song.mygo.track), ["one", "episode"]);
  assert.ok(played.list.every((song) => song.mygo.plugin === "demo" && song.mygo.identity === "identity-demo"));
  const imageNode = findAll(tree, (node) => typeof node.type === "function" && node.props.src)[0];
  assert.equal(new URL(imageNode.props.src, "https://lark.example").searchParams.get("identity"), "identity-demo");
  const artwork = host.mount(imageNode.type, imageNode.props);
  findAll(artwork.render(), (node) => node.type === "img")[0].props.onError();
  assert.equal(findAll(artwork.render(), (node) => node.type === "img").length, 0);
  assert.equal(findAll(artwork.render(), (node) => node.type === "MusicNotes").length, 1);
  group.unmount();
});

test("empty responses show a per-source status and failed first pages can retry", async () => {
  const host = harness();
  const [group] = host.groups();
  group.render(); host.flushTimers();
  host.calls[0].reject(new Error("offline")); await setImmediate();
  button(group.render(), "retry").props.onClick();
  assert.equal(host.calls[1].args[2].offset, 0);
  host.calls[1].resolve({}); await setImmediate();
  assert.ok(findAll(group.render(), (node) => node.props.role === "status" && node.props.children === "mygoSearchEmpty").length);
  group.unmount();
});
