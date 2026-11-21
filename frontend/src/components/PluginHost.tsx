import { ArrowClockwise, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

export type SongloftHostCall = {
  ns: string;
  method: string;
  params: Record<string, unknown>;
};

export type SongloftPlayerState = {
  queue: unknown[];
  current_index: number;
  current_song: unknown | null;
  is_playing: boolean;
  current_time: number;
  duration: number;
  volume: number;
  play_mode: string;
  source_playlist_id: number | null;
};

type PluginHostProps = {
  src: string;
  title: string;
  theme: "light" | "dark";
  playerState: SongloftPlayerState;
  onHostCall: (call: SongloftHostCall) => Promise<unknown>;
  loadingLabel: string;
  errorLabel: string;
  retryLabel: string;
};

type HostCallMessage = {
  type: "songloft-host-call";
  id: string;
  ns: string;
  method: string;
  params?: unknown;
};

function isHostCallMessage(value: unknown): value is HostCallMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<HostCallMessage>;
  return message.type === "songloft-host-call"
    && typeof message.id === "string"
    && message.id.length > 0
    && message.id.length <= 128
    && typeof message.ns === "string"
    && message.ns.length <= 64
    && typeof message.method === "string"
    && message.method.length <= 64;
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastingInk(background: string) {
  return luminance(background) > 0.179 ? "#000000" : "#FFFFFF";
}

function hostColorScheme(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const read = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    const short = /^#([0-9a-f]{3})$/i.exec(value);
    if (short) return `#${[...short[1]].map((part) => part + part).join("")}`.toUpperCase();
    const full = /^#[0-9a-f]{6}$/i.exec(value);
    return full ? full[0].toUpperCase() : fallback;
  };
  const background = read("--bg", "#121212");
  const surface = read("--panel", background);
  const surfaceContainer = read("--panel2", surface);
  const text = read("--text", "#FFFFFF");
  const muted = read("--muted", text);
  const primary = read("--accent", "#6750A4");
  const secondary = read("--accent2", primary);
  const tertiary = read("--highlight", secondary);
  const outline = read("--line", muted);
  const error = read("--vu-high", "#BA1A1A");
  const success = read("--vu-low", "#2E7D32");

  return {
    primary,
    onPrimary: contrastingInk(primary),
    primaryContainer: surfaceContainer,
    onPrimaryContainer: text,
    secondary,
    onSecondary: contrastingInk(secondary),
    secondaryContainer: surfaceContainer,
    onSecondaryContainer: text,
    tertiary,
    onTertiary: contrastingInk(tertiary),
    tertiaryContainer: surfaceContainer,
    onTertiaryContainer: text,
    error,
    onError: contrastingInk(error),
    errorContainer: surfaceContainer,
    onErrorContainer: text,
    surface,
    onSurface: text,
    surfaceVariant: surfaceContainer,
    onSurfaceVariant: muted,
    surfaceContainerLowest: background,
    surfaceContainerLow: surface,
    surfaceContainer,
    surfaceContainerHigh: surfaceContainer,
    surfaceContainerHighest: surfaceContainer,
    outline,
    outlineVariant: outline,
    inverseSurface: text,
    onInverseSurface: background,
    inversePrimary: primary,
    shadow: "#000000",
    scrim: "#000000",
    success,
  };
}

export function PluginHost({
  src,
  title,
  theme,
  playerState,
  onHostCall,
  loadingLabel,
  errorLabel,
  retryLabel,
}: PluginHostProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [frameState, setFrameState] = useState<"loading" | "ready" | "error">("loading");

  function postToPlugin(message: unknown) {
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }

  const invokeHostCall = useEffectEvent((call: SongloftHostCall) => onHostCall(call));
  function syncTheme() {
    const frame = iframeRef.current;
    if (!frame) return;
    const colors = hostColorScheme(frame);
    const appearance = luminance(colors.surface) > luminance(colors.onSurface) ? "light" : "dark";
    postToPlugin({ type: "songloft-theme", theme: appearance, colors });
  }
  const pushTheme = useEffectEvent(syncTheme);
  const pushPlayerState = useEffectEvent(() => {
    postToPlugin({ type: "songloft-player-state", state: playerState });
  });

  useEffect(() => {
    function onMessage(event: MessageEvent<unknown>) {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow || event.origin !== window.location.origin) return;
      if (!isHostCallMessage(event.data)) return;

      const request = event.data;
      const params = request.params && typeof request.params === "object" && !Array.isArray(request.params)
        ? request.params as Record<string, unknown>
        : {};
      void invokeHostCall({ ns: request.ns, method: request.method, params })
        .then((data) => {
          frameWindow.postMessage({ type: "songloft-host-reply", id: request.id, ok: true, data }, event.origin);
        })
        .catch((error: unknown) => {
          frameWindow.postMessage({
            type: "songloft-host-reply",
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }, event.origin);
        });
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (frameState !== "ready") return;
    pushTheme();
    const observer = new MutationObserver(() => pushTheme());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const shell = iframeRef.current?.closest(".app-shell");
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ["data-mobile-theme"] });
    const viewport = window.matchMedia("(max-width: 720px), (max-width: 960px) and (max-height: 500px) and (orientation: landscape)");
    const onViewportChange = () => pushTheme();
    viewport.addEventListener("change", onViewportChange);
    return () => { observer.disconnect(); viewport.removeEventListener("change", onViewportChange); };
  }, [frameState, theme]);

  const stateSignature = JSON.stringify(playerState);
  useEffect(() => {
    if (frameState === "ready") {
      pushPlayerState();
    }
  }, [frameState, stateSignature]);

  function retry() {
    setFrameState("loading");
    setFrameKey((current) => current + 1);
  }

  return (
    <div className="plugin-host" aria-busy={frameState === "loading"}>
      <iframe
        key={frameKey}
        ref={iframeRef}
        title={title}
        src={src}
        className="plugin-surface-iframe"
        allow="clipboard-read; clipboard-write; fullscreen"
        referrerPolicy="same-origin"
        onLoad={() => {
          setFrameState("ready");
          // A plugin can navigate within the frame while the host stays ready.
          if (frameState === "ready") {
            syncTheme();
            postToPlugin({ type: "songloft-player-state", state: playerState });
          }
        }}
        onError={() => setFrameState("error")}
      />
      {frameState === "loading" ? (
        <div className="plugin-host-status" role="status">
          <CircleNotch className="plugin-host-spinner" aria-hidden="true" />
          <span>{loadingLabel}</span>
        </div>
      ) : null}
      {frameState === "error" ? (
        <div className="plugin-host-status error" role="alert">
          <WarningCircle aria-hidden="true" />
          <span>{errorLabel}</span>
          <button type="button" onClick={retry}>
            <ArrowClockwise aria-hidden="true" />
            {retryLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
