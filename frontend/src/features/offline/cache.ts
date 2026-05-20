import type { OfflineAudioStatus, Song } from "../../types";

const OFFLINE_INDEX_KEY = "lark.offline-cache.index.v1";
const OFFLINE_CACHE_NAME = "lark-offline-v1";
const SERVICE_WORKER_TIMEOUT_MS = 30_000;

export type OfflineSongEntry = {
  song: Song;
  quality: number;
  audio_url: string;
  cover_url?: string;
  size_bytes: number;
  etag?: string;
  cached_at: string;
};

export type OfflineSongIndex = Record<string, OfflineSongEntry>;

export type OfflineCacheUsage = {
  bytes: number;
  entries: number;
  audio_entries: number;
};

type ServiceWorkerMessageResponse<T> = T & {
  ok?: boolean;
  error?: string;
};

function offlineEntryKey(songId: number, quality: number) {
  return `${songId}:${quality}`;
}

function safeParseIndex(value: string | null): OfflineSongIndex {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as OfflineSongIndex;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, entry]) =>
        entry?.song?.id &&
        entry.audio_url &&
        Number.isFinite(entry.quality),
      ),
    );
  } catch {
    return {};
  }
}

function writeOfflineSongIndex(index: OfflineSongIndex) {
  window.localStorage.setItem(OFFLINE_INDEX_KEY, JSON.stringify(index));
}

export function readOfflineSongIndex(): OfflineSongIndex {
  if (typeof window === "undefined") return {};
  return safeParseIndex(window.localStorage.getItem(OFFLINE_INDEX_KEY));
}

export function offlineSongEntries(index: OfflineSongIndex) {
  return Object.values(index).sort((left, right) => right.cached_at.localeCompare(left.cached_at));
}

export function offlineCachedSongIds(index: OfflineSongIndex) {
  return new Set(offlineSongEntries(index).map((entry) => entry.song.id));
}

export function findOfflineSongEntry(index: OfflineSongIndex, songId: number, preferredQuality?: number) {
  const entries = offlineSongEntries(index).filter((entry) => entry.song.id === songId);
  if (!entries.length) return undefined;
  if (preferredQuality) {
    const exact = entries.find((entry) => entry.quality === preferredQuality);
    if (exact) return exact;
  }
  return entries[0];
}

export function upsertOfflineSongEntry(status: OfflineAudioStatus, fallbackSong: Song) {
  if (status.status !== "ready" || !status.audio_url) {
    throw new Error(status.error || "offline audio is not ready");
  }
  const index = readOfflineSongIndex();
  const song = status.song ?? fallbackSong;
  index[offlineEntryKey(status.song_id, status.quality)] = {
    song,
    quality: status.quality,
    audio_url: status.audio_url,
    cover_url: status.cover_url,
    size_bytes: status.size_bytes || song.size_bytes || 0,
    etag: status.etag,
    cached_at: new Date().toISOString(),
  };
  writeOfflineSongIndex(index);
  return index;
}

export function clearOfflineSongIndex() {
  window.localStorage.removeItem(OFFLINE_INDEX_KEY);
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

async function postToServiceWorker<T>(type: string, payload?: unknown): Promise<T> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Worker unavailable");
  }
  const registration = await navigator.serviceWorker.ready;
  const worker = navigator.serviceWorker.controller || registration.active;
  if (!worker) throw new Error("Service Worker unavailable");
  return new Promise<T>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error("Service Worker request timed out"));
    }, SERVICE_WORKER_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<ServiceWorkerMessageResponse<T>>) => {
      window.clearTimeout(timer);
      channel.port1.close();
      if (event.data?.ok === false) {
        reject(new Error(event.data.error || "Service Worker request failed"));
        return;
      }
      resolve(event.data as T);
    };
    worker.postMessage({ type, payload }, [channel.port2]);
  });
}

async function cacheURLsWithoutServiceWorker(urls: string[], failOnError = true) {
  if (!("caches" in window)) throw new Error("Cache Storage unavailable");
  const cache = await caches.open(OFFLINE_CACHE_NAME);
  const failures: string[] = [];
  await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, { credentials: "include", cache: "reload" });
      if (!response.ok) {
        failures.push(`${url} ${response.status}`);
        return;
      }
      await cache.put(new Request(url, { credentials: "include" }), response);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }));
  if (failOnError && failures.length) throw new Error(failures[0]);
}

export async function cacheOfflineSongAssets(status: OfflineAudioStatus) {
  if (!status.audio_url) throw new Error(status.error || "offline audio is not ready");
  try {
    await postToServiceWorker("CACHE_URLS", { urls: [status.audio_url], failOnError: true });
  } catch {
    await cacheURLsWithoutServiceWorker([status.audio_url], true);
  }
  if (!status.cover_url) return;
  try {
    await postToServiceWorker("CACHE_URLS", { urls: [status.cover_url], failOnError: false });
  } catch {
    await cacheURLsWithoutServiceWorker([status.cover_url], false).catch(() => undefined);
  }
}

async function responseByteSize(response: Response) {
  const headerSize = Number(response.headers.get("content-length") || "");
  if (Number.isFinite(headerSize) && headerSize > 0) return headerSize;
  return response.clone().arrayBuffer().then((buffer) => buffer.byteLength).catch(() => 0);
}

async function offlineUsageWithoutServiceWorker(): Promise<OfflineCacheUsage> {
  if (!("caches" in window)) return { bytes: 0, entries: 0, audio_entries: 0 };
  const cache = await caches.open(OFFLINE_CACHE_NAME);
  const requests = await cache.keys();
  const items = await Promise.all(requests.map(async (request) => {
    const response = await cache.match(request);
    if (!response) return { bytes: 0, audio: false };
    return {
      bytes: await responseByteSize(response),
      audio: new URL(request.url).pathname.includes("/api/offline/"),
    };
  }));
  const bytes = items.reduce((total, item) => total + item.bytes, 0);
  const audioEntries = items.filter((item) => item.audio).length;
  return { bytes, entries: requests.length, audio_entries: audioEntries };
}

export async function offlineCacheUsage(): Promise<OfflineCacheUsage> {
  try {
    return await postToServiceWorker<OfflineCacheUsage>("GET_OFFLINE_USAGE");
  } catch {
    return offlineUsageWithoutServiceWorker();
  }
}

export async function clearOfflineCache() {
  try {
    await postToServiceWorker("CLEAR_OFFLINE_CACHE");
  } catch {
    if ("caches" in window) await caches.delete(OFFLINE_CACHE_NAME);
  }
  clearOfflineSongIndex();
  return offlineUsageWithoutServiceWorker();
}
