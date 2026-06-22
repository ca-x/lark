import assert from "node:assert/strict";
import test from "node:test";

import {
  prependOptimisticPlaybackHistoryEntry,
  shouldLoadPlaybackHistory,
} from "./playbackHistory.ts";

const song = {
  id: 7,
  title: "Late Track",
  artist_id: 2,
  artist: "Test Artist",
  album_id: 3,
  album: "Test Album",
  path: "/music/Test Artist/Test Album/Late Track.mp3",
  file_name: "Late Track.mp3",
  format: "mp3",
  mime: "audio/mpeg",
  size_bytes: 1024,
  duration_seconds: 214,
  sample_rate: 44100,
  bit_rate: 192000,
  bit_depth: 16,
  year: 1998,
  netease_id: "",
  favorite: false,
  play_count: 0,
  resume_position_seconds: 0,
  has_lyrics: false,
  lyrics_source: "",
};

test("prepends the first optimistic playback entry when history is empty", () => {
  const entries = prependOptimisticPlaybackHistoryEntry([], song, {
    now: "2026-06-22T09:15:00.000Z",
    deviceType: "pc",
    id: -1,
    limit: 100,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, -1);
  assert.equal(entries[0].song.id, song.id);
  assert.equal(entries[0].song.last_played_at, "2026-06-22T09:15:00.000Z");
  assert.equal(entries[0].played_at, "2026-06-22T09:15:00.000Z");
  assert.equal(entries[0].duration_seconds, song.duration_seconds);
  assert.equal(entries[0].device_type, "pc");
});

test("moves an already visible song to the front without duplicating it", () => {
  const oldEntry = {
    id: 42,
    song: { ...song, last_played_at: "2026-06-21T08:00:00.000Z" },
    played_at: "2026-06-21T08:00:00.000Z",
    updated_at: "2026-06-21T08:00:00.000Z",
    progress_seconds: 61,
    duration_seconds: song.duration_seconds,
    completed: false,
    device_type: "pc",
  };

  const entries = prependOptimisticPlaybackHistoryEntry([oldEntry], song, {
    now: "2026-06-22T09:15:00.000Z",
    deviceType: "mobile",
    id: -2,
    limit: 100,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, -2);
  assert.equal(entries[0].song.id, song.id);
  assert.equal(entries[0].device_type, "mobile");
  assert.equal(entries[0].updated_at, "2026-06-22T09:15:00.000Z");
});

test("loads playback history once for an empty but loaded timeline", () => {
  assert.equal(
    shouldLoadPlaybackHistory({
      authenticated: true,
      view: "history",
      loaded: false,
      loading: false,
    }),
    true,
  );
  assert.equal(
    shouldLoadPlaybackHistory({
      authenticated: true,
      view: "history",
      loaded: true,
      loading: false,
    }),
    false,
  );
});
