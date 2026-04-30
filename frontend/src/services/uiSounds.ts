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
  click: { gain: 0.18, throttle: 70, interrupt: true },
  copy: { gain: 0.22, throttle: 160, interrupt: true },
  success: { gain: 0.2, throttle: 250 },
  error: { gain: 0.16, throttle: 250 },
  toggleOn: { gain: 0.2, throttle: 120, interrupt: true },
  toggleOff: { gain: 0.16, throttle: 120, interrupt: true },
  play: { gain: 0.18, throttle: 140, interrupt: true },
  pause: { gain: 0.14, throttle: 140, interrupt: true },
  favorite: { gain: 0.18, throttle: 180, interrupt: true },
  share: { gain: 0.2, throttle: 220, interrupt: true },
};

let enabled = false;
let ses: SeslenInstance<PresetName> | null = null;

function session() {
  if (ses) return ses;
  ses = createSeslen({
    sources: presets,
    defaults: presetDefaults,
    volume: 0.55,
    maxVoices: 4,
    buses: {
      ui: { volume: 0.6 },
    },
    respectReducedMotion: true,
  });
  return ses;
}

export function setUISoundsEnabled(next: boolean) {
  enabled = next;
  if (!next) session().stopAll();
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
