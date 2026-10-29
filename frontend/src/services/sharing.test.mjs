import assert from "node:assert/strict";
import test from "node:test";
import { api } from "./api.ts";

test("share requests encode selected song IDs without changing legacy payloads", async (context) => {
  const requests = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return Response.json({ token: "test-token" });
  });
  await api.createShare("songs", 0, "2030-01-01T00:00:00Z", [4, 2]);
  await api.createShare("playlist", 7);
  assert.equal(requests[0].url, "/api/shares");
  assert.equal(requests[0].init.credentials, "include");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(requests[0].body, { type: "songs", id: 0, expires_at: "2030-01-01T00:00:00Z", song_ids: [4, 2] });
  assert.deepEqual(requests[1].body, { type: "playlist", id: 7, expires_at: null });
});
