import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

// Set LARK_UI_TEST_REF to exercise the same assertions against a historical
// component without checking out files or changing the worktree.
const sourceRef = process.env.LARK_UI_TEST_REF;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const origin = "https://music.example";
const sampleShare = {
  token: "test-share",
  url: `${origin}/share/test-share`,
  type: "album",
  id: 1,
  title: "Test album",
};
const translate = (key) => key;
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Execute the real transpiled component and its rendered event handlers. The
// small hook host supplies state and mount effects; DOM focus, layout, and
// animation remain the responsibility of browser checks.
function loadComponent(filename, { share = sampleShare, clipboard } = {}) {
  const state = [];
  const calls = { create: 0, created: [], toasts: [], sounds: [], copied: [] };
  const navigator = { clipboard };
  let cursor = 0;
  let effects = [];
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (next) => {
        state[index] = typeof next === "function" ? next(state[index]) : next;
      }];
    },
    useRef: (initial) => ({ current: initial }),
    useMemo: (create) => create(),
    useCallback: (callback) => callback,
    useEffect: (effect) => effects.push(effect),
    useLayoutEffect: () => {},
    memo: (component) => component,
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@phosphor-icons/react": new Proxy({}, { get: (_, name) => name }),
    "../services/api": {
      api: {
        shares: async () => ({ shares: [share] }),
        createShare: async () => {
          calls.create++;
          return share;
        },
      },
    },
    "../services/uiSounds": { playUISound: (sound) => calls.sounds.push(sound) },
    "./share-duration": {
      SHARE_DURATION_OPTIONS: [],
      expiresAtFromDuration: () => undefined,
      durationValueFromExpiresAt: () => "",
    },
    "../hooks/useDialogLifecycle": { useDialogLifecycle: () => ({ current: null }) },
  };
  const source = sourceRef
    ? execFileSync("git", ["show", `${sourceRef}:frontend/src/components/${filename}`], {
      cwd: repoRoot,
      encoding: "utf8",
    })
    : readFileSync(new URL(filename, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unmocked component dependency: ${name}`);
      return modules[name];
    },
    navigator,
    window: { location: { origin } },
  }, { filename });

  function render(name, props) {
    cursor = 0;
    effects = [];
    return exports[name](props);
  }
  return {
    calls,
    render,
    async mount(name, props) {
      render(name, props);
      for (const effect of effects) effect();
      await settle();
      return render(name, props);
    },
    allowClipboard() {
      navigator.clipboard = { writeText: async (text) => calls.copied.push(text) };
    },
  };
}

function find(tree, predicate) {
  if (tree == null || typeof tree !== "object") return null;
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}

function required(tree, predicate, description) {
  const node = find(tree, predicate);
  assert.ok(node, `Expected rendered ${description}`);
  return node;
}

function primaryButton(tree) {
  return required(tree, (node) => node.props?.className === "primary", "primary action");
}

function copyButton(tree) {
  return required(tree, (node) => node.props?.["aria-label"] === "copyShareLink", "copy action");
}

function manualLink(tree) {
  return required(tree, (node) => node.type === "input" && node.props.readOnly, "manual-copy input");
}

for (const mode of ["denied", "unavailable"]) {
  const clipboard = mode === "denied"
    ? { writeText: async () => { throw new Error("Clipboard permission denied"); } }
    : undefined;
  const share = mode === "unavailable" ? { ...sampleShare, url: "" } : sampleShare;

  test(`share dialog retains the link when clipboard is ${mode} and retries without another share`, async () => {
    const host = loadComponent("ShareDialog.tsx", { clipboard, share });
    const props = {
      target: { type: "album", id: 1, title: sampleShare.title },
      t: translate,
      onCreated: (created) => host.calls.created.push(created),
      onClose: () => {},
    };
    primaryButton(host.render("ShareDialog", props)).props.onClick();
    await settle();

    assert.equal(host.calls.created.length, 0, "A failed copy must not report success");
    const failedTree = host.render("ShareDialog", props);
    const error = required(failedTree, (node) => node.props?.role === "alert", "copy error");
    assert.equal(error.props.children, "shareLinkCopyFailed");
    assert.equal(manualLink(failedTree).props.value, sampleShare.url);
    let selections = 0;
    manualLink(failedTree).props.onFocus({ currentTarget: { select: () => selections++ } });
    assert.equal(selections, 1, "The complete URL must be selectable for manual copying");

    host.allowClipboard();
    primaryButton(failedTree).props.onClick();
    await settle();
    assert.equal(host.calls.create, 1, "Retrying copy must reuse the share already created");
    assert.deepEqual(host.calls.copied, [sampleShare.url]);
    assert.deepEqual(host.calls.created, [share]);
  });

  test(`share management reports ${mode} clipboard access and only confirms a successful retry`, async () => {
    const host = loadComponent("ShareManagementView.tsx", { clipboard, share });
    const props = { t: translate, onToast: (message) => host.calls.toasts.push(message) };
    const tree = await host.mount("ShareManagementView", props);
    copyButton(tree).props.onClick();
    await settle();

    assert.equal(host.calls.toasts.length, 0, "A failed copy must not emit a success toast");
    assert.equal(host.calls.sounds.length, 0, "A failed copy must not play the success sound");
    const failedTree = host.render("ShareManagementView", props);
    assert.equal(manualLink(failedTree).props.value, sampleShare.url);
    assert.equal(required(failedTree, (node) => node.props?.role === "alert", "copy error").props.children, "shareLinkCopyFailed");

    host.allowClipboard();
    copyButton(failedTree).props.onClick();
    await settle();
    assert.deepEqual(host.calls.copied, [sampleShare.url]);
    assert.deepEqual(host.calls.toasts, ["shareLinkCopied"]);
    assert.deepEqual(host.calls.sounds, ["copy"]);
    assert.equal(find(host.render("ShareManagementView", props), (node) => node.props?.role === "alert"), null);
  });
}

function showcase() {
  const host = loadComponent("ArtistAlbumBrowser.tsx");
  const calls = { open: [], play: [] };
  const wrapper = host.render("ArtistAlbumBrowser", {
    albums: [sampleShare],
    displayStyle: "showcase",
    resetKey: 1,
    t: translate,
    onOpenAlbum: (album) => calls.open.push(album),
    onPlayAlbum: (album) => calls.play.push(album),
  });
  const tree = wrapper.type(wrapper.props);
  const stage = required(tree, (node) => node.props?.className === "artist-album-cover-flow-stage", "Cover Flow stage");
  const play = required(tree, (node) => node.props?.className === "artist-album-cover-flow-play", "play button");
  return { stage, play, calls };
}

test("Cover Flow leaves Enter on its play button to the button's own action", () => {
  const { stage, play, calls } = showcase();
  let prevented = false;
  stage.props.onKeyDown({
    key: "Enter",
    target: play,
    currentTarget: stage,
    preventDefault: () => { prevented = true; },
  });
  assert.equal(calls.open.length, 0, "A nested play button's Enter must not open the album");
  assert.equal(prevented, false, "The container must allow the native button activation");
  play.props.onClick();
  assert.deepEqual(calls.play, [sampleShare]);
});

test("Cover Flow still handles Enter and Space when the stage itself has focus", () => {
  const { stage, calls } = showcase();
  for (const key of ["Enter", " "]) {
    let prevented = false;
    stage.props.onKeyDown({
      key,
      target: stage,
      currentTarget: stage,
      preventDefault: () => { prevented = true; },
    });
    assert.equal(prevented, true);
  }
  assert.deepEqual(calls.open, [sampleShare]);
  assert.deepEqual(calls.play, [sampleShare]);
});
