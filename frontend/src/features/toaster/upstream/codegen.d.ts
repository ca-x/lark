import type { Engine } from './engine.js';

export type CodePart = { text: string; steps?: number[] | null; slots?: number[] | null; beats?: number[] | null };
export type SongMeta = { title: string; artist: string; app?: string };
export const LINE_IDS: string[];
export function buildLines(engine: Engine, meta: { song: SongMeta; source?: string; hushed?: boolean }, time: number): Record<string, CodePart[]>;
export function resetCodegen(): void;
export function strudelProgram(lines: Record<string, string>, song: SongMeta): string;
export function strudelLink(code: string): string;
