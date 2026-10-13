import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INTERFACE_SCALE,
  changeInterfaceScale,
  isDefaultInterfaceScale,
  linkInterfaceScale,
  normalizeInterfaceScale,
} from "./interfaceScale.ts";

test("interface text and button sizes change independently, then link at the text size", () => {
  const text = changeInterfaceScale(DEFAULT_INTERFACE_SCALE, "text", 140);
  assert.deepEqual(text, { text: 140, buttons: 100, linked: false });
  const buttons = changeInterfaceScale(text, "buttons", 120);
  assert.deepEqual(buttons, { text: 140, buttons: 120, linked: false });
  const linked = linkInterfaceScale(buttons, true);
  assert.deepEqual(linked, { text: 140, buttons: 140, linked: true });
  assert.deepEqual(changeInterfaceScale(linked, "buttons", 150), { text: 150, buttons: 150, linked: true });
  assert.ok(isDefaultInterfaceScale(DEFAULT_INTERFACE_SCALE));
  assert.ok(!isDefaultInterfaceScale(linked));
});

test("stored sizes are bounded and invalid values restore the default", () => {
  assert.deepEqual(normalizeInterfaceScale({ text: 999, buttons: 20, linked: false }), { text: 160, buttons: 100, linked: false });
  assert.deepEqual(normalizeInterfaceScale({ text: 137, buttons: 120, linked: true }), { text: 140, buttons: 140, linked: true });
  assert.deepEqual(normalizeInterfaceScale(null), DEFAULT_INTERFACE_SCALE);
});
