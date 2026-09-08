import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function hookHost() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
    },
    useRef(initial) {
      const i = cursor++;
      return slots[i] ??= { current: initial };
    },
    useCallback: (callback) => callback,
    useEffect(effect, deps) {
      const i = cursor++;
      if (!slots[i] || deps.some((value, index) => !Object.is(value, slots[i][index]))) effects.push(effect);
      slots[i] = deps;
    },
  };
  const source = process.env.LARK_UI_TEST_REF
    ? execFileSync("git", ["show", `${process.env.LARK_UI_TEST_REF}:frontend/src/components/player-themes/useDiscScratchSeek.ts`], { encoding: "utf8" })
    : readFileSync(new URL("./useDiscScratchSeek.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: () => react });
  const seeks = [];
  let options = { duration: 180, progress: 90, trackKey: "A", onSeek: (value) => seeks.push(value) };
  let result;
  const render = (update = {}) => {
    options = { ...options, ...update };
    cursor = 0;
    effects = [];
    result = exports.useDiscScratchSeek(options);
    for (const effect of effects) effect();
    return result;
  };
  const target = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }), setPointerCapture() {} };
  const pointer = (x, y, id = 1) => ({ pointerId: id, button: 0, currentTarget: target, clientX: x, clientY: y, preventDefault() {} });
  render();
  return {
    render, seeks,
    down(id = 1) { result.scratchProps.onPointerDown(pointer(180, 100, id)); render(); },
    move(id = 1) { result.scratchProps.onPointerMove(pointer(100, 180, id)); render(); },
    up() { result.scratchProps.onPointerUp(pointer(100, 180)); render(); },
    cancel() { result.scratchProps.onPointerCancel(pointer(100, 180)); render(); },
    click(detail = 1) { let prevented = false; result.scratchProps.onClickCapture({ detail, preventDefault() { prevented = true; }, stopPropagation() {} }); return prevented; },
  };
}

test("scratching previews then commits once and suppresses the generated click", () => {
  const host = hookHost(); host.down(); host.move();
  assert.equal(host.seeks.length, 0);
  assert.ok(host.render().progress > 90);
  host.up(); assert.equal(host.seeks.length, 1);
  assert.equal(host.click(), true); assert.equal(host.click(), false);
});

test("switching tracks cancels a scratch instead of seeking the successor", () => {
  const host = hookHost(); host.down(); host.move();
  host.render({ trackKey: "B", progress: 0, duration: 60 }); host.up();
  assert.deepEqual(host.seeks, []);
  assert.equal(host.render().progress, 0);
  assert.equal(host.click(), true); // The old gesture must not toggle the new song either.
});

test("cancelled scratch keeps keyboard playback and the next pointer click usable", () => {
  const host = hookHost(); host.down(); host.move(); host.cancel();
  assert.equal(host.click(0), false);
  host.down(); host.up(); assert.equal(host.click(), false);
  assert.deepEqual(host.seeks, []);
});

test("a second pointer cannot replace the active scratch", () => {
  const host = hookHost(); host.down(); host.down(2); host.move(); host.up();
  assert.equal(host.seeks.length, 1);
});

test("losing seek availability cancels the pending seek", () => {
  const host = hookHost(); host.down(); host.move();
  host.render({ disabled: true }); host.up();
  assert.deepEqual(host.seeks, []);
});
