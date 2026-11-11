import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const syntax = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["openLyricCandidates", "refreshLyricCandidates", "selectLyricCandidate", "FullLyrics", "saveSettings"]);
const declarations = [];
function collect(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) declarations.push(`export ${node.getText(syntax)}`);
  ts.forEachChild(node, collect);
}
collect(syntax);
assert.equal(declarations.length, names.size);
const { outputText } = ts.transpileModule(declarations.join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function host({ enabled = true, mygo = false } = {}) {
  const state = {};
  const requests = [];
  const context = {
    exports: {}, current: { id: mygo ? -1 : 1, mygo: mygo ? {} : undefined }, lyricCandidatesLoading: false,
    lyricRequestGeneration: { current: 0 }, onlineLyricsEnabledRef: { current: enabled },
    lyricCandidateCacheKey: (id) => String(id), getCandidateCache: () => undefined,
    loadCandidateCache: (_key, load) => load(), reloadCandidateCache: (_key, load) => load(),
    invalidateLyricCandidateCache() {}, t: (key) => key, showMessage() {},
    api: Object.fromEntries(["lyricCandidates", "selectLyrics"].map((name) => [name, () => {
      const request = deferred(); requests.push(request); return request.promise;
    }])),
    useState: (initial) => [initial, () => {}], useRef: (current) => ({ current }), useEffect() {},
    useEffectEvent: (callback) => callback, useMemo: (callback) => callback(), useCallback: (callback) => callback,
    hasOnlineLyricsSource: () => true, lyricsMatchConfidence: () => "high", coverUrl: () => "",
    formatLyricOffset: (value) => `${value} ms`, formatTime: () => "0:00", LYRIC_OFFSET_STEP_MS: [-500, -100, 100, 500], MiniCover: "MiniCover",
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
  };
  for (const statement of syntax.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === "@phosphor-icons/react") {
      for (const element of statement.importClause.namedBindings.elements) context[element.name.text] = element.name.text;
    }
  }
  context.currentRef = { current: context.current };
  for (const name of ["Lyrics", "LyricsLoading", "LyricCandidates", "LyricCandidatesOpen", "LyricCandidatesLoading", "Progress"]) {
    context[`set${name}`] = (value) => { state[name] = value; };
  }
  vm.runInNewContext(outputText, context);
  return { context, actions: context.exports, state, requests };
}

for (const options of [{ enabled: false }, { mygo: true }]) {
  test(`manual built-in actions do not call unavailable endpoints: ${JSON.stringify(options)}`, async () => {
    const app = host(options);
    await app.actions.openLyricCandidates();
    await app.actions.refreshLyricCandidates();
    await app.actions.selectLyricCandidate({ source: "fixture", id: "42" });
    assert.equal(app.requests.length, 0);
    assert.equal(app.state.LyricCandidatesOpen, true, "Offset tools remain openable");
  });
}

for (const name of ["openLyricCandidates", "refreshLyricCandidates", "selectLyricCandidate"]) {
  for (const transition of ["track", "disable-reenable"]) {
    test(`${name} ignores stale response after ${transition}`, async () => {
      const app = host();
      const pending = app.actions[name]({ source: "fixture", id: "42" });
      if (transition === "track") app.context.currentRef.current = { id: 2 };
      else app.context.lyricRequestGeneration.current += 2;
      app.requests[0].resolve([{ id: "stale" }]);
      await pending;
      assert.equal(app.state.Lyrics, undefined);
      assert.equal(app.state.LyricCandidates, undefined);
      assert.equal(app.state.Progress, undefined);
    });
  }
}

const flatten = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(3).flatMap(flatten)];
for (const enabled of [true, false]) {
  test(`FullLyrics exposes ${enabled ? "search and timing" : "timing only"}`, () => {
    const app = host();
    const tree = app.actions.FullLyrics({
      song: app.context.current, lines: [], lyricsSource: "fixture", lyricsDisplayStyle: "classic",
      lyricOffsetMs: 0, t: (key) => key, scrollRef: { current: null }, candidates: [],
      candidatesOpen: true, onlineLyricsEnabled: enabled,
    });
    const nodes = flatten(tree);
    assert.equal(nodes.some((node) => node.props?.["aria-label"] === "chooseLyrics"), enabled);
    assert.equal(nodes.filter((node) => node.props?.role === "tab").length, enabled ? 2 : 0);
    if (!enabled) {
      assert.ok(nodes.some((node) => node.props?.id === "lyrics-offset-panel"));
      assert.ok(!nodes.some((node) => node.props?.id === "lyrics-candidates-panel"));
      assert.ok(nodes.some((node) => node.props?.["aria-label"] === "lyricsOffsetReset"));
    }
  });
}

test("capability changes reload lyrics without reinitializing playback", () => {
  const effects = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(syntax) === "useEffect") effects.push(node);
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  const lyricsEffect = effects.find((node) => node.arguments[0].getText(syntax).includes("const lyricRequest ="));
  assert.match(lyricsEffect.arguments[1].getText(syntax), /settings.online_lyrics_enabled/);
  assert.doesNotMatch(lyricsEffect.arguments[0].getText(syntax), /setProgress|setStreamMode|setDuration/);
  const playbackEffect = effects.find((node) => node.arguments[0].getText(syntax).includes("const shouldResume ="));
  assert.equal(playbackEffect.arguments[1].getText(syntax), "[current?.id]");
});

for (const enabled of [true, false]) {
  test(`lyrics capability changes only after a delayed settings PUT commits (${enabled})`, async () => {
    const app = host();
    const pending = deferred();
    const changes = [];
    app.context.settings = { online_lyrics_enabled: !enabled, transcode_quality_kbps: 192 };
    app.context.defaultSettings = {};
    app.context.normalizeTheme = (theme) => theme;
    app.context.setSettings = (value) => changes.push(value.online_lyrics_enabled);
    app.context.setSmartPlaylists = () => {};
    app.context.api.saveSettings = () => pending.promise;
    app.context.api.smartPlaylists = async () => [];
    const saving = app.actions.saveSettings({ ...app.context.settings, online_lyrics_enabled: enabled });
    assert.deepEqual(changes, [!enabled], "Pending PUT must not trigger a premature lyric reload");
    pending.resolve({ online_lyrics_enabled: enabled });
    await saving;
    assert.deepEqual(changes, [!enabled, enabled]);
  });
}

test("failed settings saves retain the confirmed lyrics capability", async () => {
  const app = host();
  const changes = [];
  const messages = [];
  app.context.settings = { online_lyrics_enabled: true, transcode_quality_kbps: 192 };
  app.context.setSettings = (value) => changes.push(value.online_lyrics_enabled);
  app.context.showMessage = (message) => messages.push(message);
  app.context.api.saveSettings = async () => { throw new Error("offline"); };
  await app.actions.saveSettings({ ...app.context.settings, online_lyrics_enabled: false });
  assert.deepEqual(changes, [true, true]);
  assert.deepEqual(messages, ["settingsSaveFailed"]);
});
