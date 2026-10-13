export type InterfaceScale = { text: number; buttons: number; linked: boolean };

export const DEFAULT_INTERFACE_SCALE: InterfaceScale = { text: 100, buttons: 100, linked: false };
export const INTERFACE_SCALE_MIN = 100;
export const INTERFACE_SCALE_MAX = 160;
export const INTERFACE_SCALE_STEP = 10;
const STORAGE_KEY = "lark-interface-scale-v1";

function normalizePercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 100;
  return Math.max(INTERFACE_SCALE_MIN, Math.min(INTERFACE_SCALE_MAX, Math.round(value / INTERFACE_SCALE_STEP) * INTERFACE_SCALE_STEP));
}

export function normalizeInterfaceScale(value: unknown): InterfaceScale {
  if (!value || typeof value !== "object") return { ...DEFAULT_INTERFACE_SCALE };
  const stored = value as Partial<InterfaceScale>;
  const text = normalizePercent(stored.text);
  return { text, buttons: stored.linked === true ? text : normalizePercent(stored.buttons), linked: stored.linked === true };
}

export function readInterfaceScale(): InterfaceScale {
  try {
    return normalizeInterfaceScale(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return { ...DEFAULT_INTERFACE_SCALE };
  }
}

export function saveInterfaceScale(value: InterfaceScale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Device storage may be unavailable in private browsing.
  }
}

export function changeInterfaceScale(value: InterfaceScale, field: "text" | "buttons", percent: number): InterfaceScale {
  const next = normalizePercent(percent);
  if (value.linked) return { text: next, buttons: next, linked: true };
  return { ...value, [field]: next };
}

export function linkInterfaceScale(value: InterfaceScale, linked: boolean): InterfaceScale {
  return linked ? { text: value.text, buttons: value.text, linked: true } : { ...value, linked: false };
}

export function isDefaultInterfaceScale(value: InterfaceScale): boolean {
  return value.text === 100 && value.buttons === 100 && !value.linked;
}
