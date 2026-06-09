import type { Album, Artist, Lyrics, RadioSource, RadioStation, Song, Theme } from "../types";
import type { StreamMode } from "../types/app";
import { ADAPTIVE_STREAM_QUALITY, COLLECTION_LOAD_TIMEOUT_MS, MAX_PLAYBACK_QUEUE_SIZE, themes, themeAliases } from "../constants";

export function normalizeTheme(theme: string): Theme {
  return themes.some((item) => item.id === theme)
    ? (theme as Theme)
    : (themeAliases[theme] ?? "deep-space");
}

export function randomQueueIndex(length: number, currentIndex: number) {
  if (length <= 1) return 0;
  let nextIndex = Math.floor(Math.random() * length);
  if (nextIndex === currentIndex) nextIndex = (nextIndex + 1) % length;
  return nextIndex;
}

export function uniqueSongs(items: Song[], limit = Number.POSITIVE_INFINITY) {
  const seen = new Set<number>();
  const out: Song[] = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function queueWithCurrent(base: Song[], current?: Song | null, limit = MAX_PLAYBACK_QUEUE_SIZE) {
  const unique = uniqueSongs(base, limit);
  if (!current) return unique;
  if (unique.some((item) => item.id === current.id)) return unique;
  return [current, ...unique.filter((item) => item.id !== current.id)].slice(0, limit);
}

export function coverUrl(song?: Song | null) {
  if (!song) return undefined;
  const version = song.cover_version ? `?v=${encodeURIComponent(String(song.cover_version))}` : "";
  return `/api/songs/${song.id}/cover${version}`;
}

export function albumCoverUrl(album?: Album | null) {
  if (!album) return undefined;
  const version = album.cover_version ? `?v=${encodeURIComponent(String(album.cover_version))}` : "";
  return `/api/albums/${album.id}/cover${version}`;
}

export function artistCoverUrl(artist?: Artist | null) {
  return artist ? `/api/artists/${artist.id}/cover` : undefined;
}

export function radioPlaybackURL(streamURL: string) {
  const trimmed = streamURL.trim();
  if (!trimmed || trimmed.startsWith("/")) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  return `/api/radio/stream?url=${encodeURIComponent(trimmed)}`;
}

export function radioRawURL(station: RadioStation) {
  const direct = station.stream_url?.trim();
  if (direct) return direct;
  const value = station.url?.trim();
  if (!value) return "";
  if (value.startsWith("/api/radio/stream")) {
    const parsed = new URL(value, window.location.origin);
    return parsed.searchParams.get("url") || value;
  }
  return value;
}

export function radioStationToPlayable(station: RadioStation): RadioStation {
  const rawURL = radioRawURL(station);
  return {
    ...station,
    source_url: station.source_url || "",
    group_name: station.group_name || "",
    stream_url: rawURL,
    url: radioPlaybackURL(station.url),
    favorite: Boolean(station.favorite),
  };
}

export function radioSourceToStation(source: RadioSource): RadioStation {
  return {
    id: source.id,
    name: source.name,
    url: source.stream_url || source.url,
    source_url: source.source_url || "",
    group_name: source.group_name || "",
    stream_url: source.url,
    country: "",
    tags: source.group_name || source.source_url || "",
    codec: "",
    bitrate: 0,
    votes: 0,
    homepage: "",
    favicon: "",
    favorite: Boolean(source.favorite),
  };
}

export function sameRadioStation(left?: RadioStation | null, right?: RadioStation | null) {
  if (!left || !right) return false;
  if (left.id && right.id && left.id === right.id) return true;
  return radioRawURL(left) === radioRawURL(right);
}

export function uniqueRadioStations(stations: RadioStation[]) {
  const out: RadioStation[] = [];
  for (const station of stations) {
    if (!station?.url) continue;
    const playable = radioStationToPlayable(station);
    if (out.some((item) => sameRadioStation(item, playable))) continue;
    out.push(playable);
  }
  return out;
}

export function radioSourceLabel(station: RadioStation, fallback: string) {
  const stationName = station.name.trim().toLowerCase();
  const seen = new Set<string>();
  const candidates = [
    station.group_name,
    station.country,
    station.source_url,
    station.homepage,
    station.tags,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    const key = value?.toLowerCase();
    if (!value || !key || key === stationName || seen.has(key)) continue;
    seen.add(key);
    return value;
  }
  return fallback;
}

export function formatDownloadSpeed(kbps: number) {
  if (!Number.isFinite(kbps) || kbps <= 0) return "";
  const kibPerSecond = kbps / 8;
  if (kibPerSecond >= 1024) return `${(kibPerSecond / 1024).toFixed(1)} MB/s`;
  if (kibPerSecond >= 100) return `${Math.round(kibPerSecond)} KB/s`;
  return `${kibPerSecond.toFixed(1)} KB/s`;
}

export function radioStreamBitrateKbps(station?: RadioStation | null) {
  if (!station) return 0;
  if (station.bitrate > 0) return station.bitrate;
  return station.url.startsWith("/api/radio/stream") ? 128 : 0;
}

export function formatDuration(seconds: number) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export function formatBytes(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function compactLibraryCount(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(safeValue);
}

export function resumePosition(song?: Song | null) {
  const progress = song?.resume_position_seconds || 0;
  const duration = song?.duration_seconds || 0;
  if (progress < 5) return 0;
  if (duration > 0 && progress >= duration - 5) return 0;
  return progress;
}

export function prefersLowBandwidthStream() {
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }
  ).connection;
  if (!connection) return false;
  return (
    connection.saveData === true ||
    ["slow-2g", "2g", "3g"].includes(connection.effectiveType ?? "")
  );
}

export function streamUrl(song?: Song | null, mode: StreamMode = "auto", start = 0, qualityKbps = ADAPTIVE_STREAM_QUALITY) {
  if (!song) return undefined;
  const params = new URLSearchParams({
    mode: mode === "adaptive" ? "transcode" : "auto",
  });
  if (mode === "adaptive") {
    params.set("quality", String(Math.max(64, Math.min(320, qualityKbps || ADAPTIVE_STREAM_QUALITY))));
    params.set("cache", "1");
    if (start > 0) params.set("start", start.toFixed(2));
  }
  return `/api/songs/${song.id}/stream?${params.toString()}`;
}

export function defaultStreamMode(song?: Song | null): StreamMode {
  if (!song) return prefersLowBandwidthStream() ? "adaptive" : "auto";
  const format = song.format.toLowerCase().replace(/^\./, "");
  if (prefersLowBandwidthStream()) return "adaptive";
  if (["flac", "wav", "aiff", "aif", "ape", "dsf", "dff", "dst"].includes(format))
    return "adaptive";
  if (song.bit_rate > 320_000 || song.size_bytes > 28 * 1024 * 1024)
    return "adaptive";
  return "auto";
}

export function shouldPreferOfflinePlayback(offlineMode: boolean, networkReachable: boolean) {
  return offlineMode || !networkReachable;
}

export function sanitizeFontFamily(value?: string) {
  return (value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim();
}

export function sanitizeUploadedFontURL(value?: string) {
  const url = (value || "").trim();
  return url.startsWith("/api/fonts/") ? url : "";
}

export function fontFormat(url: string) {
  const clean = url.toLowerCase().split("?")[0];
  if (clean.endsWith(".woff2")) return "woff2";
  if (clean.endsWith(".woff")) return "woff";
  if (clean.endsWith(".otf")) return "opentype";
  return "truetype";
}

export function normalizeLyricsFontSize(value?: number) {
  const size = Number(value) || 0;
  if (size <= 0) return 0;
  return Math.max(18, Math.min(72, Math.round(size)));
}

export function albumsFromSongs(
  songs: Song[],
  fallbackArtistId = 0,
  fallbackArtistName = "",
) {
  const grouped = new Map<number, Album>();
  songs.forEach((song) => {
    if (!song.album_id) return;
    const existing = grouped.get(song.album_id);
    grouped.set(song.album_id, {
      id: song.album_id,
      title: song.album,
      artist_id: song.artist_id || fallbackArtistId,
      artist: song.artist || fallbackArtistName,
      album_artist: song.artist || fallbackArtistName,
      year: existing?.year || song.year || 0,
      favorite: false,
      song_count: (existing?.song_count ?? 0) + 1,
    });
  });
  return Array.from(grouped.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );
}

export function mergeAlbums(current: Album[], incoming: Album[]) {
  if (!incoming.length) return current;
  const byID = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => byID.set(item.id, item));
  return Array.from(byID.values());
}

export function formatQuality(song: Song) {
  const year = song.year ? String(song.year) : "";
  const bits = song.bit_depth ? `${song.bit_depth}bit` : "";
  const rate = song.sample_rate
    ? `${(song.sample_rate / 1000).toFixed(song.sample_rate % 1000 ? 1 : 0)}kHz`
    : "";
  return (
    [year, song.format.toUpperCase(), bits, rate].filter(Boolean).join(" · ") ||
    song.mime
  );
}

export type LyricLine = {
  at: number;
  text: string;
  key: string;
  groupKey: string;
  order: number;
};

export function hasOnlineLyricsSource(source: string) {
  const value = source.trim().toLowerCase();
  return value !== "" && !value.startsWith("embedded");
}

export function lyricsMatchConfidence(song: Song | null | undefined, lyrics: Lyrics | null | undefined, lines: LyricLine[]) {
  if (!song || !lyrics || !lines.length) return "high" as const;
  if (!hasOnlineLyricsSource(lyrics.source)) return "high" as const;
  const title = song.title.toLowerCase().replace(/\s+/g, "");
  const artist = song.artist.toLowerCase().replace(/\s+/g, "");
  if (!title) return "low" as const;
  const combined = lines
    .slice(0, 6)
    .map((line) => line.text.toLowerCase().replace(/\s+/g, ""))
    .join("|");
  if (!combined) return "low" as const;
  const titleHit = title.length >= 2 && combined.includes(title);
  const titleChars = new Set(title);
  let hits = 0;
  for (const ch of titleChars) if (combined.includes(ch)) hits += 1;
  const titleOverlap = titleChars.size ? hits / titleChars.size : 0;
  if (titleHit || titleOverlap >= 0.6) return "high" as const;
  if (titleOverlap >= 0.4 || (artist && combined.includes(artist))) return "medium" as const;
  return "low" as const;
}

export function parseTimestamp(value: string) {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const secondsPart = parts.pop() ?? "0";
  const seconds = Number(secondsPart.replace(":", "."));
  const minutes = Number(parts.pop() ?? "0");
  const hours = Number(parts.pop() ?? "0");
  if (![seconds, minutes, hours].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function adjustedLyricTime(line: LyricLine, offsetSeconds: number) {
  if (line.at < 0) return line.at;
  return line.at + offsetSeconds;
}

export function parseLyricLines(lyrics?: string): LyricLine[] {
  if (!lyrics) return [];
  let offsetSeconds = 0;
  const parsed: LyricLine[] = [];
  const timestampPattern =
    /\[((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?)\]/g;

  lyrics.split("\n").forEach((rawLine, order) => {
    const line = rawLine.trim();
    if (!line) return;
    const offsetMatch = line.match(/^\[offset:([+-]?\d+)\]/i);
    if (offsetMatch) {
      offsetSeconds = Number(offsetMatch[1]) / 1000;
      return;
    }

    const matches = [...line.matchAll(timestampPattern)];
    const text = line
      .replace(timestampPattern, "")
      .replace(/^\[[^\]]+\]/, "")
      .trim();
    if (!text) return;

    if (!matches.length) {
      if (!/^\[[a-z]+:/i.test(line))
        parsed.push({
          at: -1,
          text,
          key: `u-${order}`,
          groupKey: `u-${order}`,
          order,
        });
      return;
    }

    matches.forEach((match, tagIndex) => {
      const at = parseTimestamp(match[1]);
      if (at == null) return;
      const adjusted = Math.max(0, at + offsetSeconds);
      const groupKey = adjusted.toFixed(3);
      parsed.push({
        at: adjusted,
        text,
        key: `${order}-${tagIndex}-${groupKey}`,
        groupKey,
        order,
      });
    });
  });

  const sorted = parsed.sort((a, b) => {
    if (a.at < 0 && b.at < 0) return a.order - b.order;
    if (a.at < 0) return 1;
    if (b.at < 0) return -1;
    return a.at - b.at || a.order - b.order;
  });
  const firstTimedIndex = sorted.findIndex((line) => line.at >= 0);
  const firstTimed = firstTimedIndex >= 0 ? sorted[firstTimedIndex] : null;
  if (firstTimed && firstTimed.at > 0) {
    sorted[firstTimedIndex] = {
      ...firstTimed,
      at: 0,
      groupKey: "0.000",
      key: `intro-${firstTimed.key}`,
    };
    sorted.sort((a, b) => {
      if (a.at < 0 && b.at < 0) return a.order - b.order;
      if (a.at < 0) return 1;
      if (b.at < 0) return -1;
      return a.at - b.at || a.order - b.order;
    });
  }
  return sorted;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs = COLLECTION_LOAD_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("request-timeout"));
    }, timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timer));
  });
}

export function loadWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  controller: AbortController,
  timeoutMs = COLLECTION_LOAD_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      controller.abort();
      reject(new Error("request-timeout"));
    }, timeoutMs);
    run(controller.signal)
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timer));
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function friendlyLoadError(error: unknown, t: (key: string) => string) {
  if (error instanceof Error && error.message === "request-timeout") {
    return t("loadTimeout");
  }
  return t("loadFailed");
}

export function readableErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (!message) return fallback;
  try {
    const parsed = JSON.parse(message) as { error?: string; message?: string };
    return parsed.error || parsed.message || fallback;
  } catch {
    return message;
  }
}

export function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
