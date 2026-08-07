import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const styles = readFileSync(join(root, "src/styles.css"), "utf8");

function blockFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(styles)?.[1] ?? "";
}

const vinyl = blockFor(".album-slide-vinyl");
assert.ok(vinyl, "styles.css: album sleeve vinyl block missing");
assert.doesNotMatch(vinyl, /https?:\/\//, "album sleeve vinyl must not depend on a remote texture");
assert.match(vinyl, /#050505/, "album sleeve vinyl needs an opaque near-black base");
assert.match(vinyl, /repeating-radial-gradient/, "album sleeve vinyl needs local groove texture");
assert.match(vinyl, /conic-gradient/, "album sleeve vinyl needs local reflective highlights");

console.log("album sleeve theme checks passed");
