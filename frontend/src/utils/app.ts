import type { Theme, Song } from "../types";
import { themes, themeAliases, COLLECTION_LOAD_TIMEOUT_MS, MAX_PLAYBACK_QUEUE_SIZE } from "../constants";

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
  return song ? `/api/songs/${song.id}/cover` : undefined;
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
