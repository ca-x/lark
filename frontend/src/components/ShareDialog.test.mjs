import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import vm from "node:vm";
import ts from "typescript";
import { SHARE_DURATION_OPTIONS, expiresAtFromDuration } from "./share-duration.ts";

function host({ target = { type: "songs", id: 0, title: "Selected songs", songIDs: [3, 1] }, createShare, copy = async () => {} } = {}) {
  const slots = [];
  let cursor = 0;
  const requests = [];
  const created = [];
  const exports = {};
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = next; }];
    },
    useMemo: (factory) => factory(),
  };
  const jsx = (type, props) => ({ type, props });
  const source = readFileSync(new URL("./ShareDialog.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, {
    exports,
    Error,
    window: { location: { origin: "https://music.example" } },
    navigator: { clipboard: { writeText: copy } },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@phosphor-icons/react") return {};
      if (name === "../hooks/useDialogLifecycle") return { useDialogLifecycle: () => ({ current: null }) };
      if (name === "./share-duration") return { SHARE_DURATION_OPTIONS, expiresAtFromDuration };
      if (name === "../services/api") return { api: { createShare: async (...args) => {
        requests.push(args);
        return createShare ? createShare(...args) : { token: "selection-token", type: target.type };
      } } };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  return {
    requests, created,
    render() {
      cursor = 0;
      return exports.ShareDialog({ target, t: (key) => key, onCreated: (share) => created.push(share), onClose() {} });
    },
  };
}

function find(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (!Array.isArray(node) && predicate(node)) return node;
  for (const child of [Array.isArray(node) ? node : node.props?.children].flat()) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

async function submit(harness) {
  find(harness.render(), (node) => node.type === "button" && node.props.className === "primary").props.onClick();
  await setImmediate();
  return harness.render();
}

test("bulk share sends selected IDs, preserves expiration and copies an anonymous link", async () => {
  let copied;
  const harness = host({ copy: async (url) => { copied = url; } });
  find(harness.render(), (node) => node.type === "input" && node.props.value === "86400").props.onChange();
  const before = Date.now();
  await submit(harness);
  const [type, identifier, expiresAt, songIDs] = harness.requests[0];
  assert.equal(type, "songs");
  assert.equal(identifier, 0);
  assert.deepEqual(Array.from(songIDs), [3, 1]);
  assert.ok(new Date(expiresAt).getTime() >= before + 86400000);
  assert.ok(new Date(expiresAt).getTime() <= Date.now() + 86400000);
  assert.equal(copied, "https://music.example/share/selection-token");
  assert.equal(harness.created.length, 1);
});

test("legacy album share still uses the original target and permanent duration", async () => {
  const harness = host({ target: { type: "album", id: 12, title: "An album" } });
  await submit(harness);
  assert.deepEqual(Array.from(harness.requests[0]), ["album", 12, "", undefined]);
});

test("clipboard failure exposes a selectable link and retry does not create another share", async () => {
  let attempts = 0;
  const harness = host({ copy: async () => { if (++attempts === 1) throw new Error("denied"); } });
  let tree = await submit(harness);
  assert.equal(harness.created.length, 0);
  assert.equal(find(tree, (node) => node.props?.role === "alert").props.children, "shareLinkCopyFailed");
  assert.equal(find(tree, (node) => node.type === "input" && node.props.type === "url").props.value, "https://music.example/share/selection-token");
  tree = await submit(harness);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.created.length, 1);
  assert.equal(find(tree, (node) => node.props?.role === "alert"), undefined);
});

test("creation failure is visible and can be retried", async () => {
  let attempts = 0;
  const harness = host({ createShare: async () => {
    if (++attempts === 1) throw new Error("Sharing is disabled");
    return { token: "retry-token" };
  } });
  const tree = await submit(harness);
  assert.equal(find(tree, (node) => node.props?.role === "alert").props.children, "Sharing is disabled");
  await submit(harness);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.created.length, 1);
});
