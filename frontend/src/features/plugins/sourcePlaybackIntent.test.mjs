import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const syntax = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["playSong", "playRadio", "playNetworkTrack", "playSongToDLNADevice", "playCurrentToDLNA", "clearPersistentPlaybackSession", "savePlaybackQueueSession", "resumePlayback", "next"]);
const declarations = [];
function collect(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) declarations.push(`export ${node.getText(syntax)}`);
  ts.forEachChild(node, collect);
}
collect(syntax);
assert.equal(declarations.length, names.size);
const { outputText } = ts.transpileModule(declarations.join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });

function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const plugin = { enabled: true, manifest: { id: "demo" }, identity: "original", exports: ["stream"] };
const localSong = { id: 12, title: "Local selection", duration_seconds: 120 };
const remoteSong = (id = -1) => ({ id, title: `Source ${id}`, duration_seconds: 180, resume_position_seconds: 45, mygo: { plugin: "demo", identity: "original", track: String(id) } });

function playbackHost({ current = localSong, queue = [] } = {}) {
  const requests = { platform: [], plugins: [] };
  const calls = { history: [], played: [], mygoQueue: [], localQueue: [], dlna: [], messages: [], progressSync: [] };
  const state = { current, queue, currentRadio: null, currentNetworkTrack: null, playing: false };
  const noop = () => {};
  const context = {
    exports: {}, current, queue, songs: [], auth: { user: { id: 1 } }, MAX_PLAYBACK_QUEUE_SIZE: 500,
    remoteDLNAActive: false, settings: { dlna_cast_enabled: true },
    sourcePlayRequest: { current: 0 }, audioRef: { current: null },
    currentRef: { current }, queueRef: { current: queue }, playModeRef: { current: "sequence" },
    currentRadioRef: { current: null }, currentNetworkTrackRef: { current: null },
    sleepTimerModeRef: { current: "time" }, playbackStartModeRef: { current: "restart" },
    pendingAutoplayRef: { current: false }, radioDownloadSampleRef: { current: {} },
    playbackOutputPlanRef: { current: { output: "local", state: "playing" } },
    dlnaPlaybackDesiredStateRef: { current: null },
    clearStallDowngradeTimer: noop, clearSleepTimer: noop, syncPlaybackProgress: (completed) => calls.progressSync.push(completed),
    shouldStopForSleepTimerAfterSong: () => false, requestAudioPlay: noop,
    setPlaybackSessionSource: noop, playUISound: noop, prependRecentPlayed: noop, scheduleRecentPlayedRefresh: noop,
    radioStationToPlayable: (station) => station, radioQueueForStation: () => [], uniqueRadioStations: (stations) => stations,
    queueWithCurrent: (items) => items, defaultStreamMode: () => "auto", persistPlaybackSourceForPlay: () => null,
    saveRadioPlaybackSession: noop, enqueueDLNACommand: (command) => command(), dlnaErrorMessage: (cause) => cause.message,
    t: (key) => key, showMessage: (message) => calls.messages.push(message),
    recordSourceHistory: async (entry) => { calls.history.push(entry); },
    songsForPlaybackQueueIDs: () => assert.fail("Source resume must not resolve local song IDs"),
    songsForPlaybackSource: () => assert.fail("Source resume must not load local album/artist/playlist songs"),
    playFromPlaybackQueueStatus: () => assert.fail("Source resume must not use the local playback queue"),
    api: {
      pluginPlatform: () => { const request = deferred(); requests.platform.push(request); return request.promise; },
      mygoPlugins: () => { const request = deferred(); requests.plugins.push(request); return request.promise; },
      mygoCall: async () => ({}), markPlayed: async (id) => { calls.played.push(id); },
      saveMygoQueue: async (value) => { calls.mygoQueue.push(value); },
      savePlaybackQueue: async (...args) => { calls.localQueue.push(args); }, clearPlaybackQueue: async () => {},
      playbackQueue: () => assert.fail("Source resume must not query the local playback queue"),
      playDLNA: async (deviceID, id) => { calls.dlna.push({ deviceID, id }); return { output: "dlna", device_id: deviceID, state: "playing" }; },
    },
  };
  for (const key of ["current", "queue", "currentRadio", "currentNetworkTrack", "playing", "buffering", "radioDownloadKbps", "streamOffset", "streamMode", "radioQueue", "duration", "progress", "lyrics", "lyricCandidates", "bufferedEnd", "DLNAError", "DLNAPanelOpen", "DLNALoading", "DLNAStatus"]) {
    context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (update) => {
      state[key] = typeof update === "function" ? update(state[key]) : update;
      context[key] = state[key];
      if (context[`${key}Ref`]) context[`${key}Ref`].current = state[key];
    };
  }
  vm.runInNewContext(outputText, context);
  function resolveValidation(index = 0, { platform = { mygo: true }, plugins = [plugin] } = {}) {
    requests.platform[index].resolve(platform);
    requests.plugins[index].resolve({ plugins });
  }
  return { actions: context.exports, context, calls, state, requests, resolveValidation };
}

const competitors = {
  radio: async (host) => {
    const station = { url: "https://radio.example/stream", name: "New radio selection" };
    host.actions.playRadio(station);
    return () => { assert.equal(host.state.currentRadio, station); assert.equal(host.state.current, null); };
  },
  network: async (host) => {
    const track = { id: "network-1", stream_url: "https://network.example/stream", title: "New network selection" };
    host.actions.playNetworkTrack(track);
    return () => { assert.equal(host.state.currentNetworkTrack, track); assert.equal(host.state.current, null); };
  },
  local: async (host) => {
    const song = { ...localSong, id: 13 };
    await host.actions.playSong(song, [song]);
    return () => assert.equal(host.state.current, song);
  },
  source: async (host) => {
    const song = remoteSong(-2);
    const playing = host.actions.playSong(song, [song]);
    host.resolveValidation(1);
    await playing;
    return () => assert.equal(host.state.current, song);
  },
  "DLNA song": async (host) => {
    const song = { ...localSong, id: 14 };
    await host.actions.playSongToDLNADevice("renderer", song, [song]);
    return () => { assert.equal(host.state.current, song); assert.equal(host.state.DLNAStatus.device_id, "renderer"); };
  },
  "DLNA current": async (host) => {
    await host.actions.playCurrentToDLNA({ id: "renderer" });
    return () => { assert.equal(host.state.current, localSong); assert.equal(host.state.DLNAStatus.device_id, "renderer"); };
  },
  "cleared session": async (host) => {
    host.actions.clearPersistentPlaybackSession();
    return () => assert.equal(host.state.current, localSong);
  },
};

for (const held of ["platform", "plugins"]) {
  for (const [name, compete] of Object.entries(competitors)) {
    test(`a delayed source ${held} result cannot replace a newer ${name} intent`, async () => {
      const host = playbackHost();
      const staleSong = remoteSong();
      const pending = host.actions.playSong(staleSong, [staleSong]);
      if (held === "platform") host.requests.plugins[0].resolve({ plugins: [plugin] });
      else host.requests.platform[0].resolve({ mygo: true });
      const assertSelection = await compete(host);
      assertSelection();
      host.resolveValidation();
      await pending;
      assertSelection();
      assert.ok(host.calls.history.every((entry) => entry.song.id !== staleSong.id));
      assert.ok(host.calls.mygoQueue.every((entry) => entry?.current !== staleSong.id));
      assert.deepEqual(host.calls.messages, []);
    });
  }
}

for (const [name, validation] of [
  ["disabled platform", { platform: { mygo: false } }],
  ["removed plugin", { plugins: [] }],
  ["disabled plugin", { plugins: [{ ...plugin, enabled: false }] }],
  ["replaced identity", { plugins: [{ ...plugin, identity: "replacement" }] }],
  ["different plugin", { plugins: [{ ...plugin, manifest: { id: "other" } }] }],
  ["missing stream export", { plugins: [{ ...plugin, exports: ["home"] }] }],
]) {
  test(`${name} fails source validation without starting playback or writing history`, async () => {
    const host = playbackHost();
    const song = remoteSong();
    const pending = host.actions.playSong(song, [song]);
    host.resolveValidation(0, validation);
    await pending;
    assert.equal(host.state.current, localSong);
    assert.equal(host.state.playing, false);
    assert.deepEqual(host.calls.history, []);
    assert.deepEqual(host.calls.mygoQueue, []);
    assert.deepEqual(host.calls.messages, ["mygoSourceUnavailable"]);
  });
}

for (const endpoint of ["platform", "plugins"]) {
  test(`a failed ${endpoint} request cannot start source playback`, async () => {
    const host = playbackHost();
    const pending = host.actions.playSong(remoteSong());
    host.requests[endpoint][0].reject(new Error("Unavailable"));
    host.resolveValidation();
    await pending;
    assert.equal(host.state.current, localSong);
    assert.deepEqual(host.calls.history, []);
    assert.deepEqual(host.calls.mygoQueue, []);
    assert.deepEqual(host.calls.messages, ["mygoSourceUnavailable"]);
  });
}

test("source resume uses only the matching identity queue and never queries local negative song IDs", async () => {
  const song = remoteSong();
  const sibling = remoteSong(-2);
  const replaced = { ...remoteSong(-3), mygo: { ...song.mygo, identity: "replacement" } };
  const host = playbackHost({ queue: [localSong, song, sibling, replaced] });
  const pending = host.actions.resumePlayback(song);
  host.resolveValidation();
  await pending;
  assert.equal(host.state.current, song);
  assert.deepEqual(Array.from(host.state.queue), [song, sibling]);
  assert.equal(host.context.playbackStartModeRef.current, "resume");
  assert.deepEqual(host.calls.localQueue, []);
  assert.deepEqual(host.calls.played, []);
  assert.deepEqual(Array.from(host.calls.mygoQueue[0].songs), [song, sibling]);
});

test("source resume outside the current queue starts with only its original source song", async () => {
  const song = remoteSong();
  const host = playbackHost({ queue: [localSong, remoteSong(-2)] });
  const pending = host.actions.resumePlayback(song);
  host.resolveValidation();
  await pending;
  assert.deepEqual(Array.from(host.state.queue), [song]);
  assert.deepEqual(host.calls.localQueue, []);
});

test("a failed stale source validation does not interrupt the newer radio selection with an error", async () => {
  const host = playbackHost();
  const pending = host.actions.playSong(remoteSong());
  const assertSelection = await competitors.radio(host);
  host.requests.plugins[0].reject(new Error("Old source request failed"));
  host.resolveValidation();
  await pending;
  assertSelection();
  assert.deepEqual(host.calls.messages, []);
  assert.deepEqual(host.calls.history, []);
});

test("repeat-one source completion validates and records source playback without marking a negative local ID", async () => {
  const song = remoteSong();
  const host = playbackHost({ current: song, queue: [song] });
  host.context.playModeRef.current = "repeat-one";
  host.actions.next(1, true);
  assert.deepEqual(host.calls.progressSync, [true]);
  assert.equal(host.requests.platform.length, 1);
  assert.equal(host.requests.plugins.length, 1);
  host.resolveValidation();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.state.current, song);
  assert.equal(host.state.playing, true);
  assert.equal(host.calls.history[0].song, song);
  assert.deepEqual(host.calls.played, []);
  assert.deepEqual(host.calls.localQueue, []);
  assert.equal(host.calls.mygoQueue[0].current, song.id);
});
