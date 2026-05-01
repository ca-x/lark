import { createSeslen, type PlayOptions, type SeslenInstance } from "seslen";
import { presetDefaults, presets, type PresetName } from "seslen/presets";

type UISoundEvent =
  | "click"
  | "copy"
  | "success"
  | "error"
  | "toggleOn"
  | "toggleOff"
  | "play"
  | "pause"
  | "favorite"
  | "share";

const eventPreset: Record<UISoundEvent, PresetName> = {
  click: "tick",
  copy: "copy",
  success: "success",
  error: "error",
  toggleOn: "toggle-on",
  toggleOff: "toggle-off",
  play: "pop",
  pause: "collapse",
  favorite: "add",
  share: "send",
};

const eventOptions: Partial<Record<UISoundEvent, PlayOptions>> = {
  click: { gain: 0.42, throttle: 70, interrupt: true },
  copy: { gain: 0.48, throttle: 160, interrupt: true },
  success: { gain: 0.46, throttle: 250 },
  error: { gain: 0.38, throttle: 250 },
  toggleOn: { gain: 0.5, throttle: 120, interrupt: true },
  toggleOff: { gain: 0.42, throttle: 120, interrupt: true },
  play: { gain: 0.46, throttle: 140, interrupt: true },
  pause: { gain: 0.36, throttle: 140, interrupt: true },
  favorite: { gain: 0.48, throttle: 180, interrupt: true },
  share: { gain: 0.48, throttle: 220, interrupt: true },
};

let enabled = false;
let volume = 0.85;
let ses: SeslenInstance<PresetName> | null = null;

function session() {
  if (ses) return ses;
  ses = createSeslen({
    sources: presets,
    defaults: presetDefaults,
    volume,
    maxVoices: 4,
    buses: {
      ui: { volume: 1 },
    },
    respectReducedMotion: false,
  });
  return ses;
}

export function setUISoundsEnabled(next: boolean) {
  enabled = next;
  if (!next) session().stopAll();
}

export function setUISoundsVolume(next: number) {
  volume = Math.max(0, Math.min(1, Number(next) || 0));
  session().setVolume(volume);
}

export function setUISoundSettings(next: { enabled: boolean; volume: number }) {
  setUISoundsVolume(next.volume);
  setUISoundsEnabled(next.enabled);
}

export function uiSoundsEnabled() {
  return enabled;
}

export function playUISound(event: UISoundEvent, options?: PlayOptions) {
  if (!enabled) return;
  const preset = eventPreset[event];
  void session()
    .play(preset, { bus: "ui", ...eventOptions[event], ...options })
    .catch(() => undefined);
}

export function previewUISound(options?: PlayOptions) {
  const preset = eventPreset.success;
  void session()
    .play(preset, { bus: "ui", ...eventOptions.success, gain: 0.72, interrupt: true, ...options })
    .catch(() => undefined);
}
