import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { getSettingsCategories } from "./settingsCategories.ts";
import { createT } from "../../i18n.ts";

test("settings categories separate listening tasks without granting administrative access", () => {
  const personal = ["account", "appearance", "playback", "lyrics", "offline", "services"];
  assert.deepEqual(getSettingsCategories(createT("zh-CN"), false).map((tab) => tab.id), personal);
  const admin = getSettingsCategories(createT("en-US"), true);
  assert.equal(new Set(admin.map((tab) => tab.id)).size, 10);
  assert.deepEqual(admin.slice(6).map((tab) => tab.id), ["library", "plugins", "system", "users"]);
  for (const language of ["zh-CN", "en-US"]) {
    for (const tab of getSettingsCategories(createT(language), true)) {
      assert.ok(tab.label && tab.description && tab.group);
      assert.notEqual(tab.label, tab.description);
    }
  }
});

function renderNavigation(vertical) {
  const source = readFileSync(new URL("./SettingsNavigation.tsx", import.meta.url), "utf8");
  const context = {
    exports: {},
    window: { matchMedia: () => ({ matches: vertical }) },
    require(name) {
      if (name === "react") return { useEffect() {}, useRef: (current) => ({ current }), useState: (initial) => [initial(), () => {}] };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === "@phosphor-icons/react") return new Proxy({}, { get: (_, name) => name });
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, context);
  const changes = [];
  const tabs = getSettingsCategories(createT("en-US"), false);
  const tree = context.exports.SettingsNavigation({ activeTab: "appearance", tabs, label: "Settings", categoryLabel: "Category", onTabChange: (tab) => changes.push(tab) });
  const flatten = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(3).flatMap(flatten)];
  return { nodes: flatten(tree), changes };
}

for (const vertical of [true, false]) {
  test(`settings navigation supports ${vertical ? "vertical" : "horizontal"} keyboard order and panel linkage`, () => {
    const { nodes, changes } = renderNavigation(vertical);
    const buttons = nodes.filter((node) => node.props?.role === "tab");
    assert.equal(buttons.length, 6);
    assert.equal(buttons.filter((node) => node.props.tabIndex === 0).length, 1);
    for (const button of buttons) assert.equal(button.props["aria-controls"], "settings-panel");
    const tablist = nodes.find((node) => node.props?.role === "tablist");
    assert.equal(tablist.props["aria-orientation"], vertical ? "vertical" : "horizontal");
    const send = (index, key) => buttons[index].props.onKeyDown({ key, preventDefault() {} });
    send(1, vertical ? "ArrowDown" : "ArrowRight");
    send(0, vertical ? "ArrowUp" : "ArrowLeft");
    send(1, "Home");
    send(1, "End");
    assert.deepEqual(changes, ["playback", "services", "account", "services"]);
    const select = nodes.find((node) => node.type === "select");
    select.props.onChange({ target: { value: "offline" } });
    assert.equal(changes.at(-1), "offline");
  });
}

test("every new settings category has a searchable alias", async () => {
  const { settingsSearchAliases } = await import("./settingsSearchRegistry.ts");
  for (const tab of getSettingsCategories(createT("en-US"), true)) assert.ok(settingsSearchAliases[tab.id]?.length);
});
