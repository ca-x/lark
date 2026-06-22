import type { PlaybackHistoryEntry, Song } from "./types";

type OptimisticPlaybackHistoryOptions = {
  now?: string;
  deviceType: string;
  id?: number;
  limit?: number;
};

export function prependOptimisticPlaybackHistoryEntry(
  entries: PlaybackHistoryEntry[],
  song: Song,
  options: OptimisticPlaybackHistoryOptions,
): PlaybackHistoryEntry[] {
  const now = options.now ?? new Date().toISOString();
  const limit = Math.max(1, options.limit ?? 100);
  return [
    {
      id: options.id ?? -Date.now(),
      song: { ...song, last_played_at: now },
      played_at: now,
      updated_at: now,
      progress_seconds: 0,
      duration_seconds: song.duration_seconds,
      completed: false,
      device_type: options.deviceType,
    },
    ...entries.filter((entry) => entry.song.id !== song.id),
  ].slice(0, limit);
}

export function shouldLoadPlaybackHistory({
  authenticated,
  view,
  loaded,
  loading,
}: {
  authenticated: boolean;
  view: string;
  loaded: boolean;
  loading: boolean;
}) {
  return authenticated && view === "history" && !loaded && !loading;
}
