import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function host(filename, initial = {}, { reducedMotion = false, finePointer = true } = {}) {
  const slots = [];
  const modules = new Map();
  let cursor = 0;
  let effects = [];
  const react = {
    useState(initialValue) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initialValue) { const index = cursor++; return slots[index] ??= { current: initialValue }; },
    useId() { const index = cursor++; return slots[index] ??= `concept-${index}`; },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, dependency) => !Object.is(value, slots[index][dependency]))) effects.push(effect);
      slots[index] = dependencies;
    },
  };
  const jsx = (type, props) => typeof type === "function" ? type(props) : { type, props };
  const requireModule = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "@phosphor-icons/react") return new Proxy({}, { get: (_, icon) => String(icon) });
    if (name === "./useArtworkActivity") return { useArtworkActivity: () => ({ ref: { current: null }, visible: true }) };
    if (modules.has(name)) return modules.get(name);
    const sourceUrl = new URL(`${name}.tsx`, import.meta.url);
    const source = readFileSync(existsSync(sourceUrl) ? sourceUrl : new URL(`${name}.ts`, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
    const exports = {};
    modules.set(name, exports);
    vm.runInNewContext(outputText, {
      exports,
      require: requireModule,
      window: { matchMedia: (query) => ({ matches: query.includes("reduced-motion") ? reducedMotion : finePointer }) },
    });
    return exports;
  };
  const component = requireModule(`./${filename}`)[filename];
  let props = { playing: false, title: "夜航 · Night passage", artist: "菅野よう子", album: "海辺の記録", progress: 45, duration: 180, ...initial };
  return {
    render(next = {}) {
      props = { ...props, ...next };
      cursor = 0;
      effects = [];
      const tree = component(props);
      for (const effect of effects) effect();
      return tree;
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

const named = (tree, label) => find(tree, (node) => node.props?.["aria-label"] === label);

function renderHome(overrides = {}) {
  const source = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  const syntax = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const home = syntax.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "HomeView");
  const context = {
    exports: {},
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
    useState: (value) => [value, () => {}],
    coverUrl: () => "/cover.webp",
    resumePosition: () => 0,
  };
  const visit = (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) context[node.tagName.text] = node.tagName.text;
    ts.forEachChild(node, visit);
  };
  visit(home);
  const compiled = ts.transpileModule(`export ${home.getText(syntax)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, context);
  const current = { id: 1, title: "Night passage", artist: "Theme QA", album: "Reference checks", duration_seconds: 180 };
  return context.exports.HomeView({
    songs: [], recentPlayedSongs: [], recentAddedSongs: [], dailyMix: [], albums: [], artists: [], playlists: [],
    stats: null, currentRadio: null, currentNetworkTrack: null, current, playing: true, progress: 45, duration: 180,
    activeLyricText: "Matching lyrics", currentLyricText: "", homePlayerStyle: "soft-static", mobileViewport: false,
    t: (key) => key, ...overrides,
  });
}

test("Home forwards only actual lyrics to Soft Static, not loading or missing-lyrics messages", () => {
  const fallback = find(renderHome(), (node) => node.type === "SoftStaticPlayer");
  assert.equal(fallback.props.activeLyricText, "");
  const live = find(renderHome({ currentLyricText: "夜色落在唱片的另一面" }), (node) => node.type === "SoftStaticPlayer");
  assert.equal(live.props.activeLyricText, "夜色落在唱片的另一面");
});

test("Home keeps both concept themes out of mobile, radio and network playback", () => {
  for (const homePlayerStyle of ["soft-static", "prism"]) {
    const component = homePlayerStyle === "soft-static" ? "SoftStaticPlayer" : "PrismPlayer";
    assert.ok(find(renderHome({ homePlayerStyle }), (node) => node.type === component));
    for (const external of [{ mobileViewport: true }, { currentRadio: { name: "QA radio" } }, { currentNetworkTrack: { title: "QA network track" } }]) {
      assert.equal(find(renderHome({ homePlayerStyle, ...external }), (node) => node.type === component), undefined);
    }
  }
});

test("transport uses the real callbacks and updates play/pause labels", () => {
  const calls = [];
  const player = host("ConceptPlayerControls", {
    onToggle: () => calls.push("toggle"), onPrevious: () => calls.push("previous"),
    onNext: () => calls.push("next"), onCyclePlayMode: () => calls.push("mode"), playModeLabel: "随机播放",
    labels: { play: "播放", pause: "暂停", previous: "上一首", next: "下一首" },
  });
  const tree = player.render();
  for (const label of ["播放", "上一首", "下一首", "随机播放"]) named(tree, label).props.onClick();
  assert.deepEqual(calls, ["toggle", "previous", "next", "mode"]);
  assert.ok(named(player.render({ playing: true }), "暂停"));
});

test("seek is finite, bounded, keyboard-sized and reports readable time", () => {
  const seeks = [];
  const player = host("ConceptPlayerControls", { progress: 300, onSeek: (value) => seeks.push(value) });
  const range = named(player.render(), "Position");
  assert.equal(range.props.value, 180);
  assert.equal(range.props.step, 1);
  assert.equal(range.props["aria-valuetext"], "03:00 / 03:00");
  for (const value of ["22", "999", "-12", "NaN"]) range.props.onChange({ target: { value } });
  assert.deepEqual(seeks, [22, 180, 0]);
  assert.equal(named(player.render({ progress: Number.NaN }), "Position").props.value, 0);
});

test("unknown duration and unavailable actions expose disabled semantics", () => {
  const seeks = [];
  const player = host("ConceptPlayerControls", { duration: Number.POSITIVE_INFINITY, onSeek: (value) => seeks.push(value) });
  const tree = player.render();
  const range = named(tree, "Position");
  assert.equal(range.props.disabled, true);
  assert.equal(range.props.max, 0);
  assert.equal(range.props.value, 0);
  range.props.onChange({ target: { value: "90" } });
  assert.deepEqual(seeks, []);
  for (const label of ["Play", "Previous", "Next", "Play mode"]) assert.equal(named(tree, label).props.disabled, true);
});

test("Soft Static uses live lyrics, falls back to real metadata and follows playback state", () => {
  const player = host("SoftStaticPlayer", { activeLyricText: "夜が明けるまで、ここにいる" });
  let tree = player.render();
  assert.equal(tree.props["data-playing"], "false");
  assert.ok(find(tree, (node) => node.props?.className === "soft-static-lyric" && node.props.children === "夜が明けるまで、ここにいる"));
  tree = player.render({ activeLyricText: "", playing: true });
  assert.equal(tree.props["data-playing"], "true");
  assert.ok(find(tree, (node) => node.props?.className === "soft-static-lyric" && node.props.children === "夜航 · Night passage"));
});

for (const component of ["SoftStaticPlayer", "PrismPlayer"]) {
  test(`${component} survives failed covers and accepts the next track artwork`, () => {
    const player = host(component, { cover: "/cover-a.webp" });
    find(player.render(), (node) => node.type === "img").props.onError();
    assert.equal(find(player.render(), (node) => node.type === "img"), undefined);
    const next = player.render({ cover: "/cover-b.webp", title: "A much longer successor title" });
    assert.equal(find(next, (node) => node.type === "img").props.src, "/cover-b.webp");
  });
}

test("Prism split-light and color controls are real, labeled and independent of audio", () => {
  const seeks = [];
  const player = host("PrismPlayer", { onSeek: (seconds) => seeks.push(seconds) });
  let tree = player.render();
  assert.equal(named(tree, "Split light").props["aria-pressed"], true);
  const color = named(tree, "Spectrum color");
  color.props.onChange({ target: { value: "620" } });
  tree = player.render();
  assert.equal(named(tree, "Spectrum color").props.value, 620);
  assert.equal(named(tree, "Spectrum color").props["aria-valuetext"], "620 nm");
  assert.deepEqual(seeks, []);
  named(tree, "Split light").props.onClick();
  tree = player.render();
  assert.equal(named(tree, "Split light").props["aria-pressed"], false);
  assert.equal(named(tree, "Spectrum color").props.disabled, true);
});

for (const setting of [{ reducedMotion: true }, { finePointer: false }, { pointerType: "touch" }]) {
  test(`Prism respects pointer and motion constraints: ${JSON.stringify(setting)}`, () => {
    const player = host("PrismPlayer", {}, setting);
    const tree = player.render();
    const glass = { style: { transform: "" } };
    find(tree, (node) => node.props?.className === "prism-glass").props.ref.current = glass;
    find(tree, (node) => node.props?.className === "prism-optics").props.onPointerMove({
      pointerType: setting.pointerType ?? "mouse", clientX: 800, clientY: 100,
      currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) },
    });
    assert.equal(glass.style.transform, "");
  });
}

test("Prism fine-pointer tilt resets without a render loop or blocking controls", () => {
  const tree = host("PrismPlayer").render();
  const glass = { style: { transform: "" } };
  find(tree, (node) => node.props?.className === "prism-glass").props.ref.current = glass;
  const optics = find(tree, (node) => node.props?.className === "prism-optics");
  optics.props.onPointerMove({
    pointerType: "mouse", clientX: 800, clientY: 100,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) },
  });
  assert.match(glass.style.transform, /rotateY\(/);
  optics.props.onPointerLeave();
  assert.equal(glass.style.transform, "");
});

test("long metadata retains complete names when its visible layout is bounded", () => {
  const artist = "海風が運ぶ小さなメロディー ".repeat(20);
  const album = "慢慢经过每一片倒影中变换的光与夜色 ".repeat(20);
  const prism = host("PrismPlayer", { artist, album }).render();
  assert.equal(find(prism, (node) => node.type === "p" && node.props.children === artist).props.title, artist);
  assert.equal(find(prism, (node) => node.type === "span" && node.props.children === album).props.title, album);
  const soft = host("SoftStaticPlayer", { artist, album }).render();
  assert.equal(find(soft, (node) => node.props?.className === "soft-static-credit").props.title, `${artist} / ${album}`);
});

function cssDeclarations(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`).exec(source)?.[1] ?? "";
  return Object.fromEntries(block.split(";").filter((entry) => entry.includes(":")).map((entry) => entry.trim().split(/:\s*/)));
}

for (const variant of ["shared", "soft-static"]) {
  test(`${variant} tonearm keeps its tube and fingerlift attached to the headshell at every size`, () => {
    const shared = readFileSync(new URL("./player-craft.css", import.meta.url), "utf8");
    const concept = readFileSync(new URL("./concept-players.css", import.meta.url), "utf8");
    const part = (name) => ({
      ...cssDeclarations(shared, `.metal-${name}`),
      ...(variant === "soft-static" ? cssDeclarations(concept, `.soft-static-tonearm .metal-${name}`) : {}),
    });
    const shell = part("headshell");
    const lift = part("fingerlift");
    const tube = part("tube");
    for (const [width, height] of [[38, 160], [54, 240], [84, 460], [105, 487]]) {
      const shellLeft = parseFloat(shell.left) / 100 * width;
      const shellRight = shellLeft + parseFloat(shell.width) / 100 * width;
      const shellTop = parseFloat(shell.top) / 100 * height;
      const shellBottom = shellTop + parseFloat(shell.height) / 100 * height;
      const liftOriginX = (100 - parseFloat(lift.right) - parseFloat(lift.width)) / 100 * width;
      const liftOriginY = (parseFloat(lift.top) + parseFloat(lift.height) / 2) / 100 * height;
      assert.ok(liftOriginX >= shellLeft + 0.5 && liftOriginX <= shellRight - 0.5, `${width}×${height}: lift must overlap the headshell horizontally`);
      assert.ok(liftOriginY >= shellTop + 0.5 && liftOriginY <= shellBottom - 0.5, `${width}×${height}: lift must overlap the headshell vertically`);
      assert.ok((parseFloat(tube.top) + parseFloat(tube.height)) / 100 * height >= shellTop + 0.5, `${width}×${height}: tube must overlap the headshell`);
    }
  });
}

test("Soft Static's outer pink cursor follows finite playback progress and retains its position on pause", () => {
  const player = host("SoftStaticPlayer", { duration: 180, progress: 0, playing: true });
  const cursor = (tree) => find(tree, (node) => node.props?.className === "soft-static-progress-cursor");
  for (const [progress, angle] of [[0, -65], [45, -32.5], [90, 0], [135, 32.5], [180, 65], [999, 65], [-10, -65], [Number.NaN, -65]]) {
    assert.equal(cursor(player.render({ progress })).props.style.transform, `rotate(${angle}deg)`);
  }
  const playing = cursor(player.render({ progress: 90 }));
  const paused = cursor(player.render({ playing: false }));
  assert.equal(paused.props.style.transform, playing.props.style.transform);
  assert.equal(cursor(player.render({ duration: Number.POSITIVE_INFINITY })).props.style.transform, "rotate(-65deg)");
});
