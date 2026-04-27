import type { Theme } from "../types";

type MediaAction = MediaSessionAction;
type MediaHandler = MediaSessionActionHandler;

type LazycatMediaSession = {
  setMetadata?: (metadata: string) => unknown;
  setPlaybackState?: (state: MediaSessionPlaybackState) => unknown;
  setPositionState?: (state: string) => unknown;
  setActionHandler?: (action: MediaAction) => unknown;
};

type LazycatWindow = Window & {
  lzc_media_session?: LazycatMediaSession;
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

const lazycatMediaHandlers = new Map<MediaAction, MediaHandler | null>();
let lazycatMediaEventsBound = false;

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

function bindLazycatMediaEvents() {
  if (lazycatMediaEventsBound) return;
  lazycatMediaEventsBound = true;
  window.addEventListener("lzc_media_session_event", (event) => {
    const customEvent = event as CustomEvent<{ eventType?: MediaAction; data?: unknown }>;
    const action = customEvent.detail?.eventType;
    if (!action) return;
    const handler = lazycatMediaHandlers.get(action);
    if (handler) {
      handler({ action, ...(customEvent.detail?.data as object | undefined) } as MediaSessionActionDetails);
    }
  });
}

function lazycatMediaSession() {
  return lazycatWindow().lzc_media_session;
}

export function syncLazycatChrome(theme: Theme) {
  ensureMeta("lzcapp-disable-dark", "true");
  ensureMeta("lzcapp-navigation-bar-scheme", "statusBarOnly");
  ensureMeta("lzcapp-state-bar-scheme", "default");

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

export function hasClientMediaSession() {
  return Boolean(lazycatMediaSession() || navigator.mediaSession);
}

export function setClientMediaMetadata(options: MediaMetadataInit | null) {
  const lazycat = lazycatMediaSession();
  if (lazycat?.setMetadata && options) {
    safeCall(() => lazycat.setMetadata?.(JSON.stringify(options)));
    return;
  }
  if (!navigator.mediaSession) return;
  navigator.mediaSession.metadata =
    options && typeof MediaMetadata !== "undefined" ? new MediaMetadata(options) : null;
}

export function setClientPlaybackState(playbackState: MediaSessionPlaybackState) {
  const lazycat = lazycatMediaSession();
  if (lazycat?.setPlaybackState) {
    safeCall(() => lazycat.setPlaybackState?.(playbackState));
    return;
  }
  if (navigator.mediaSession) navigator.mediaSession.playbackState = playbackState;
}

export function setClientPositionState(options: MediaPositionState) {
  const lazycat = lazycatMediaSession();
  if (lazycat?.setPositionState) {
    safeCall(() => lazycat.setPositionState?.(JSON.stringify(options)));
    return;
  }
  safeCall(() => navigator.mediaSession?.setPositionState?.(options));
}

export function setClientActionHandler(action: MediaAction, handler: MediaHandler | null) {
  const lazycat = lazycatMediaSession();
  if (lazycat?.setActionHandler) {
    bindLazycatMediaEvents();
    lazycatMediaHandlers.set(action, handler);
    safeCall(() => lazycat.setActionHandler?.(action));
    return;
  }
  safeCall(() => navigator.mediaSession?.setActionHandler?.(action, handler));
}
