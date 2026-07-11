import assert from "node:assert/strict";
import test from "node:test";

import {
  getCandidateCache,
  invalidateCandidateCache,
  loadCandidateCache,
  reloadCandidateCache,
  lyricCandidateCacheKey,
  metadataCandidateCacheKey,
} from "./candidateCache.ts";

test("reuses one in-flight request and caches the resolved candidates", async () => {
  const key = "test:shared-request";
  let calls = 0;
  let resolveRequest;
  const loader = () => {
    calls += 1;
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  };

  const first = loadCandidateCache(key, loader);
  const second = loadCandidateCache(key, loader);
  assert.strictEqual(first, second);
  assert.equal(calls, 1);

  resolveRequest([{ id: "candidate-a" }]);
  assert.deepEqual(await first, [{ id: "candidate-a" }]);
  assert.deepEqual(await loadCandidateCache(key, loader), [{ id: "candidate-a" }]);
  assert.equal(calls, 1);
  invalidateCandidateCache(key);
});

test("reload replaces only after success and preserves old candidates on failure", async () => {
  const key = "test:reload";
  await loadCandidateCache(key, async () => [{ id: "old" }]);
  await assert.rejects(reloadCandidateCache(key, async () => { throw new Error("offline"); }), /offline/);
  assert.deepEqual(getCandidateCache(key), [{ id: "old" }]);
  assert.deepEqual(await reloadCandidateCache(key, async () => [{ id: "new" }]), [{ id: "new" }]);
  assert.deepEqual(getCandidateCache(key), [{ id: "new" }]);
  invalidateCandidateCache(key);
});

test("caches an empty candidate array", async () => {
  const key = "test:empty";
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return [];
  };

  assert.deepEqual(await loadCandidateCache(key, loader), []);
  assert.deepEqual(getCandidateCache(key), []);
  assert.deepEqual(await loadCandidateCache(key, loader), []);
  assert.equal(calls, 1);
  invalidateCandidateCache(key);
});

test("does not cache rejected requests and permits retry", async () => {
  const key = "test:retry";
  let calls = 0;
  const loader = async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary failure");
    return [{ id: "recovered" }];
  };

  await assert.rejects(loadCandidateCache(key, loader), /temporary failure/);
  assert.equal(getCandidateCache(key), undefined);
  assert.deepEqual(await loadCandidateCache(key, loader), [{ id: "recovered" }]);
  assert.equal(calls, 2);
  invalidateCandidateCache(key);
});

test("builds stable keys and invalidates only requested resources", async () => {
  const lyricKey = lyricCandidateCacheKey(7);
  const pathKey = metadataCandidateCacheKey("song", 7, "path");
  const onlineKey = metadataCandidateCacheKey("song", 7, "online");
  await loadCandidateCache(lyricKey, async () => [{ id: "lyric" }]);
  await loadCandidateCache(pathKey, async () => [{ id: "path" }]);
  await loadCandidateCache(onlineKey, async () => [{ id: "online" }]);

  invalidateCandidateCache(pathKey, onlineKey);
  assert.deepEqual(getCandidateCache(lyricKey), [{ id: "lyric" }]);
  assert.equal(getCandidateCache(pathKey), undefined);
  assert.equal(getCandidateCache(onlineKey), undefined);
  invalidateCandidateCache(lyricKey);
});
