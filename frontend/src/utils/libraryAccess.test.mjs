import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { canManageLibrary, resolveLibraryTab, resolveSettingsTab } from "./libraryAccess.ts";

test("only administrators can manage the library and open privileged settings", () => {
  assert.equal(canManageLibrary("admin"), true);
  assert.equal(canManageLibrary("user"), false);
  assert.equal(canManageLibrary(undefined), false);
  for (const tab of ["library", "plugins", "system", "users"]) {
    assert.equal(resolveSettingsTab(tab, "user"), "account");
    assert.equal(resolveSettingsTab(tab, "admin"), tab);
  }
  for (const tab of ["account", "playback", "services"]) {
    assert.equal(resolveSettingsTab(tab, "user"), tab);
  }
});

test("stale library tabs respect roles and mobile availability", () => {
  for (const mobile of [false, true]) {
    assert.equal(resolveLibraryTab("manage", "user", mobile), "songs");
    assert.equal(resolveLibraryTab("manage", "admin", mobile), "manage");
    assert.equal(resolveLibraryTab("folders", "user", mobile), "folders");
  }
  for (const tab of ["offline", "network", "radio"]) {
    assert.equal(resolveLibraryTab(tab, "user", false), tab);
    assert.equal(resolveLibraryTab(tab, "user", true), "songs");
  }
});

function componentHost(name, overrides = {}) {
  const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const syntax = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = syntax.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, `${name} exists`);
  const slots = [];
  let cursor = 0;
  const context = {
    exports: {},
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useEffect() {},
    useLayoutEffect() {},
    storedLibraryTab: () => "songs",
    rememberLibraryTab() {},
    canManageLibrary,
    resolveLibraryTab,
    ...overrides,
  };
  const visit = (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) context[node.tagName.text] = node.tagName.text;
    ts.forEachChild(node, visit);
  };
  visit(declaration);
  const compiled = ts.transpileModule(`export ${declaration.getText(syntax)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, context);
  return (props) => {
    cursor = 0;
    return context.exports[name](props);
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function libraryProps(overrides = {}) {
  return {
    searchRequest: 0, songs: [{ id: 2 }, { id: 1 }], folders: [], networkSources: [], radioSources: [], libraryDirectories: [],
    mobileBasic: false, language: "zh-CN", userRole: "user", current: null, stats: null, songPage: null,
    pageLoading: false, searchQuery: "", sort: "added_desc", review: "", scanStatus: { running: true },
    offlineCache: { entries: [] }, t: (key) => key, ...overrides,
  };
}

test("member library omits directory management, scan, upload and scan paths on desktop and mobile", () => {
  for (const mobileBasic of [false, true]) {
    const render = componentHost("LibraryView", { storedLibraryTab: () => "manage" });
    const tree = render(libraryProps({ mobileBasic }));
    const serialized = JSON.stringify(tree);
    assert.doesNotMatch(serialized, /LibraryDirectoryManager|ScanProgress|desktop-only-action|libraryDirectories|"upload"/);
    assert.ok(nodes(tree).some((node) => node.type === "SongTable"));
  }
});

test("admin library retains management on mobile and desktop controls", () => {
  const mobile = componentHost("LibraryView", { storedLibraryTab: () => "manage" });
  assert.ok(nodes(mobile(libraryProps({ mobileBasic: true, userRole: "admin" }))).some((node) => node.type === "LibraryDirectoryManager"));
  const desktop = componentHost("LibraryView");
  assert.equal(nodes(desktop(libraryProps({ userRole: "admin" }))).filter((node) => node.props?.className?.includes("desktop-only-action")).length, 2);
});

test("selected sharing forwards only selected songs in display order and follows the sharing switch", () => {
  const render = componentHost("LibraryView");
  let received;
  const props = libraryProps({ onShareSongs: (songs) => { received = songs; } });
  let tree = render(props);
  nodes(tree).find((node) => node.type === "SongTable").props.onToggleSelected(props.songs[1]);
  nodes(tree).find((node) => node.type === "SongTable").props.onToggleSelected(props.songs[0]);
  tree = render(props);
  const shareButton = nodes(tree).find((node) => node.type === "button" && node.props.children?.includes("share"));
  assert.ok(shareButton);
  shareButton.props.onClick();
  assert.deepEqual(Array.from(received, (song) => song.id), [2, 1]);
  const disabledTree = render({ ...props, onShareSongs: undefined });
  assert.equal(nodes(disabledTree).some((node) => node.type === "button" && node.props.children?.includes("share")), false);
});

test("member empty state never offers library mutations", () => {
  const render = componentHost("EmptyLibrary");
  const tree = render({ t: (key) => key, mobileBasic: false, canManage: false, scanStatus: { running: true } });
  assert.doesNotMatch(JSON.stringify(tree), /"upload"|ScanProgress|"button"/);
  assert.match(JSON.stringify(tree), /emptyLibraryMemberHint/);
});

test("oversized selections cannot create a share", () => {
  const render = componentHost("LibraryView");
  const props = libraryProps({ songs: Array.from({ length: 501 }, (_, index) => ({ id: index + 1 })), onShareSongs() {} });
  const table = nodes(render(props)).find((node) => node.type === "SongTable");
  for (const song of props.songs) table.props.onToggleSelected(song);
  const button = nodes(render(props)).find((node) => node.type === "button" && node.props.children?.includes("share"));
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.title, "shareSelectionLimit");
});
