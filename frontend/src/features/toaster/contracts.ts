import type { Language } from "../../types";

export type ToasterMeta = { mediaKey: string; title: string; artist: string };
export type ToasterCodePart = { text: string; active: boolean };
export type ToasterCodeLine = { id: string; text: string; parts: ToasterCodePart[] };
export type ToasterVisualMode = "spectrum" | "orb" | "dominoes";
export type ToasterSnapshot = {
  lines: ToasterCodeLine[];
  bpm: number | null;
  key: string;
  bar: number | null;
  step: number | null;
  locked: boolean;
  energy: number;
  bass: number;
  treble: number;
  beat: number;
  bands: number[];
  patterns: Record<string, boolean[]>;
  recordedBars: number;
};
export type ToasterSongFiles = { code: string; midi: Uint8Array; bars: number };
export interface ToasterSession {
  tick(nowMs: number, playing: boolean): ToasterSnapshot;
  setMeta(meta: ToasterMeta): void;
  tap(nowMs: number): void;
  reset(): void;
  code(): string;
  songFiles(): Promise<ToasterSongFiles | null>;
  dispose(): void;
}
export type ToasterStudioProps = {
  audio: HTMLAudioElement | null;
  playing: boolean;
  available: boolean;
  meta: ToasterMeta;
  language: Language;
  onBack: () => void;
  onTogglePlayback: () => void;
  onEnableAnalysis: () => void;
};
