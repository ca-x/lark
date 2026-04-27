import type { Theme } from "../types";

type LazycatWindow = Window & {
  lzc_window?: {
    SetStatusBarColor?: (color: string) => unknown;
    EnableWebviewResize?: (enable: boolean) => unknown;
  };
  lzc_tab?: {
    SetControlViewVisibility?: (visible: boolean) => unknown;
    GetControlViewVisibility?: () => boolean | Promise<boolean>;
  };
  webkit?: {
    messageHandlers?: {
      SetCloseBtnShowStatus?: {
        postMessage?: (message: { params: boolean[] }) => unknown;
      };
    };
  };
};

function lazycatWindow() {
  return window as LazycatWindow;
}

function safeCall<T>(fn: (() => T) | undefined, fallback?: T) {
  try {
    return fn ? fn() : fallback;
  } catch (error) {
    console.warn("[lazycat] client API call failed", error);
    return fallback;
  }
}

function ensureMeta(name: string, content: string) {
  let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function toHexColor(value: string) {
  const color = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  if (!rgb) return "";
  return rgb
    .slice(1, 4)
    .map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"))
    .join("")
    .replace(/^/, "#");
}

export function syncLazycatChrome(theme: Theme) {
  ensureMeta("lzcapp-disable-dark", "true");
  ensureMeta("lzcapp-navigation-bar-scheme", "statusBarOnly");
  ensureMeta("lzcapp-state-bar-scheme", "sink");

  const style = window.getComputedStyle(document.documentElement);
  const bg = toHexColor(style.getPropertyValue("--bg"));
  const panel = toHexColor(style.getPropertyValue("--panel"));
  const isLight = theme.endsWith("light") || [
    "milk-porcelain",
    "oat-latte",
    "mint-soda",
    "sakura-washi",
    "dusk-amber",
  ].includes(theme);
  const fallbackLight = isLight ? "#ffffff" : "#111111";
  const fallbackDark = isLight ? "#111111" : "#000000";
  const color = bg || panel || fallbackLight;

  ensureMeta("lzcapp-state-bar-color", color);
  ensureMeta("lzcapp-state-bar-color-dark", bg || fallbackDark);
  safeCall(() => lazycatWindow().lzc_window?.SetStatusBarColor?.(color));
  safeCall(() => lazycatWindow().lzc_window?.EnableWebviewResize?.(true));
}

export function setLazycatImmersive(immersive: boolean) {
  safeCall(() => lazycatWindow().lzc_tab?.SetControlViewVisibility?.(!immersive));
  safeCall(() =>
    lazycatWindow().webkit?.messageHandlers?.SetCloseBtnShowStatus?.postMessage?.({
      params: [!immersive],
    }),
  );
}
