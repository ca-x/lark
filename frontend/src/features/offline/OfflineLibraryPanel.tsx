import { MusicNotes, Playlist as PlaylistIcon, Play, SkipForward, Trash } from "@phosphor-icons/react";
import type { Song } from "../../types";
import type { OfflineCacheUsage, OfflineSongEntry } from "./cache";

type OfflineLibraryLabels = {
  title: string;
  description: string;
  empty: string;
  play: string;
  playNext: string;
  addToPlaylist: string;
  remove: string;
  clearAll: string;
  cachedAt: string;
  quality: string;
  entries: string;
};

type OfflineLibraryPanelProps = {
  entries: OfflineSongEntry[];
  usage: OfflineCacheUsage;
  current: Song | null;
  labels: OfflineLibraryLabels;
  clearing: boolean;
  removingKeys: Set<string>;
  formatBytes: (bytes: number) => string;
  formatDateTime: (value: string) => string;
  onPlay: (song: Song, list: Song[]) => void;
  onInsertNext: (songs: Song[]) => void;
  onAdd: (song: Song) => void;
  onRemove: (entry: OfflineSongEntry) => void;
  onClearAll: () => void;
};

function entryKey(entry: OfflineSongEntry) {
  return `${entry.song.id}:${entry.quality}`;
}

export function OfflineLibraryPanel({
  entries,
  usage,
  current,
  labels,
  clearing,
  removingKeys,
  formatBytes,
  formatDateTime,
  onPlay,
  onInsertNext,
  onAdd,
  onRemove,
  onClearAll,
}: OfflineLibraryPanelProps) {
  const songs = entries.map((entry) => entry.song);
  return (
    <section className="offline-library-panel" aria-label={labels.title}>
      <div className="offline-library-summary">
        <div>
          <strong>{labels.title}</strong>
          <span>{labels.description}</span>
        </div>
        <div className="offline-cache-meter">
          <strong>{formatBytes(usage.bytes)}</strong>
          <span>
            {usage.audio_entries} / {usage.entries}
          </span>
        </div>
        <button
          type="button"
          className="danger"
          disabled={!entries.length || clearing}
          onClick={onClearAll}
          title={labels.clearAll}
          aria-label={labels.clearAll}
        >
          <Trash />
        </button>
      </div>
      {entries.length ? (
        <div className="offline-cache-list">
          {entries.map((entry) => {
            const key = entryKey(entry);
            const song = entry.song;
            const removing = removingKeys.has(key);
            return (
              <article key={key} className={current?.id === song.id ? "offline-cache-row active" : "offline-cache-row"}>
                <button type="button" className="offline-cache-song" onClick={() => onPlay(song, songs)}>
                  <MusicNotes weight="fill" />
                  <span>
                    <strong>{song.title}</strong>
                    <small>{[song.artist, song.album].filter(Boolean).join(" · ")}</small>
                  </span>
                </button>
                <div className="offline-cache-detail">
                  <strong>{formatBytes(entry.size_bytes || song.size_bytes || 0)}</strong>
                  <small>
                    {labels.quality} {entry.quality}kbps · {labels.cachedAt} {formatDateTime(entry.cached_at)}
                  </small>
                </div>
                <div className="offline-cache-actions">
                  <button type="button" onClick={() => onPlay(song, songs)} title={labels.play} aria-label={labels.play}>
                    <Play weight="fill" />
                  </button>
                  <button type="button" onClick={() => onInsertNext([song])} title={labels.playNext} aria-label={labels.playNext}>
                    <SkipForward />
                  </button>
                  <button type="button" onClick={() => onAdd(song)} title={labels.addToPlaylist} aria-label={labels.addToPlaylist}>
                    <PlaylistIcon />
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={removing}
                    onClick={() => onRemove(entry)}
                    title={labels.remove}
                    aria-label={labels.remove}
                  >
                    <Trash />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty offline-cache-empty">{labels.empty}</div>
      )}
    </section>
  );
}
