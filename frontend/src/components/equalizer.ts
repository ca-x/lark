export const EQ_FREQUENCIES = [70, 180, 320, 600, 1000, 3000, 6000, 12000, 14000, 16000] as const;
export const EQ_STORAGE_KEY = "lark:eq:v1";

export type EqualizerPresetKey = "flat" | "pop" | "rock" | "vocal" | "bass" | "classical" | "electronic" | "jazz";

export const EQ_PRESETS: Record<EqualizerPresetKey, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pop: [-1, 0, 2, 4, 4, 3, 2, 1, 1, 1],
  rock: [4, 3, 2, 1, -1, -1, 1, 2, 3, 3],
  vocal: [-3, -2, 0, 3, 5, 5, 3, 1, -1, -2],
  bass: [6, 5, 4, 2, 0, -1, -1, 0, 0, 0],
  classical: [4, 3, 2, 1, 0, 0, 1, 2, 3, 3],
  electronic: [5, 4, 1, -1, 2, 2, 1, 2, 3, 4],
  jazz: [3, 2, 1, 2, 3, 3, 2, 1, 1, 2],
};

export function clampEqGain(value: number) {
  return Math.max(-12, Math.min(12, Number.isFinite(value) ? value : 0));
}

export function defaultEqualizer() {
  return { enabled: false, bands: EQ_FREQUENCIES.map(() => 0) };
}

export function storedEqualizer() {
  if (typeof window === "undefined") return defaultEqualizer();
  try {
    const raw = window.localStorage.getItem(EQ_STORAGE_KEY);
    if (!raw) return defaultEqualizer();
    const parsed = JSON.parse(raw) as { enabled?: boolean; bands?: unknown };
    const rawBands = Array.isArray(parsed.bands) ? parsed.bands : [];
    const bands = rawBands.length
      ? EQ_FREQUENCIES.map((_, index) => clampEqGain(Number(rawBands[index] ?? 0)))
      : EQ_FREQUENCIES.map(() => 0);
    return { enabled: Boolean(parsed.enabled), bands };
  } catch {
    return defaultEqualizer();
  }
}


export const TONE_STORAGE_KEY = "lark:tone:v1";

export function defaultToneControls() {
  return { bass: 0, treble: 0 };
}

export function storedToneControls() {
  if (typeof window === "undefined") return defaultToneControls();
  try {
    const raw = window.localStorage.getItem(TONE_STORAGE_KEY);
    if (!raw) return defaultToneControls();
    const parsed = JSON.parse(raw) as { bass?: unknown; treble?: unknown };
    return {
      bass: clampEqGain(Number(parsed.bass ?? 0)),
      treble: clampEqGain(Number(parsed.treble ?? 0)),
    };
  } catch {
    return defaultToneControls();
  }
}
