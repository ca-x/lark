export type Chord = { root: number; third: number; name: string };
export type TapeParts = Record<string, boolean[] | { on: boolean[]; tok: (string | null)[] } | null>;
export type TapeBar = { parts: TapeParts; chord: Chord | null; bass: number | null; wob?: number; beats?: (number | null)[] | null };
export type TapeSong = { bpm: number; bars: TapeBar[]; who: { name: string; about: string } | null };
export type EngineTape = {
  reset(down?: number): void;
  lock(bpm: number, down: number): void;
  tempo(bpm: number): void;
  shift(beats: number): void;
  pattern(beat: number, parts: TapeParts): void;
  harmony(beat: number, chord: Chord | null, bass: number | null, wob?: number, beats?: (number | null)[] | null): void;
};
export type Tape = EngineTape & { who: (() => { name: string; about: string }) | null; song(down: number): TapeSong | null };
export function createTape(): Tape;
export function songMidi(song: TapeSong, title: string): Uint8Array;
export function songStrudel(song: TapeSong, about: string): string | null;
