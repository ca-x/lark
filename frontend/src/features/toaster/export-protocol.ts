import type { ToasterMeta, ToasterSongFiles } from './contracts.ts';
import type { EngineTape } from './upstream/tape.js';

export type TapeOperation = { [K in Exclude<keyof EngineTape, 'reset'>]: { type: K; args: Parameters<EngineTape[K]> } }[Exclude<keyof EngineTape, 'reset'>];
export type ExportRequest = { type: 'export'; id: number; down: number; meta: ToasterMeta };
export type WorkerRequest = TapeOperation | ExportRequest;
export type WorkerResponse = { id: number; files: ToasterSongFiles | null; error?: string };

function truncateUnicode(text: string, limit: number) {
  let end = Math.min(text.length, limit);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return text.slice(0, end);
}

// The upstream title formatter slices UTF-16 at 43 units when the title exceeds
// 44. Give it a bounded, complete-character title so it cannot split a pair.
export function codegenMeta(meta: ToasterMeta): ToasterMeta {
  return { ...meta, title: truncateUnicode(meta.title, 44) };
}

// Metadata is only written inside a single-line comment or the upstream quoted title.
export function cleanMeta(meta: ToasterMeta): ToasterMeta {
  const line = (value: string) => {
    const text = String(value ?? '').replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').trim();
    return truncateUnicode(new TextDecoder().decode(new TextEncoder().encode(text)), 256);
  };
  return { mediaKey: meta.mediaKey, title: line(meta.title), artist: line(meta.artist) };
}
