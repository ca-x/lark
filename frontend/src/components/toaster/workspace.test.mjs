import assert from "node:assert/strict";
import test from "node:test";
import { exportFilename, visibleCodeParts } from "./workspace.ts";

test("download names retain track identity and remove filename control characters", () => {
  const meta = { mediaKey: "one", artist: "夜航/Live", title: '风:雨?\u0000"' };
  assert.equal(exportFilename(meta, "strudel"), "夜航_Live - 风_雨___.strudel");
  assert.equal(exportFilename({ mediaKey: "empty", artist: "", title: "" }, "mid"), "lark-toaster.mid");
  assert.equal(exportFilename({ ...meta, title: ".".repeat(400), artist: "" }, "mid"), "lark-toaster.mid");
});

test("typing clips actual generated parts without changing their activity", () => {
  const line = { id: "bass", text: '$: note("c2")', parts: [{ text: '$: note("', active: false }, { text: "c2", active: true }, { text: '")', active: false }] };
  assert.deepEqual(visibleCodeParts(line, 10), [{ text: '$: note("', active: false }, { text: "c", active: true }]);
  assert.equal(visibleCodeParts(line, 100).map(part => part.text).join(""), line.text);
  assert.deepEqual(visibleCodeParts(line, 0), []);
});

test("the displayed code stays faithful if a part list does not match its source", () => {
  assert.deepEqual(visibleCodeParts({ id: "one", text: "real code", parts: [{ text: "stale", active: true }] }, 100), [{ text: "real code", active: false }]);
});
