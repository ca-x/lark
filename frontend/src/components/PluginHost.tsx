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

function hostColorScheme() {
  const style = window.getComputedStyle(document.documentElement);
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
    onPrimary: background,
    primaryContainer: surfaceContainer,
    onPrimaryContainer: text,
    secondary,
    onSecondary: background,
    secondaryContainer: surfaceContainer,
    onSecondaryContainer: text,
    tertiary,
    onTertiary: background,
    tertiaryContainer: surfaceContainer,
    onTertiaryContainer: text,
    error,
    onError: "#FFFFFF",
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

  function syncPluginContext(state = playerState) {
    postToPlugin({ type: "songloft-theme", theme, colors: hostColorScheme() });
    postToPlugin({ type: "songloft-player-state", state });
  }

  const invokeHostCall = useEffectEvent((call: SongloftHostCall) => onHostCall(call));
  const pushPluginContext = useEffectEvent(() => syncPluginContext());
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
    if (frameState === "ready") pushPluginContext();
  }, [frameState, theme]);

  const stateSignature = `${playerState.current_index}|${playerState.current_song ? JSON.stringify(playerState.current_song) : ""}|${playerState.is_playing}|${playerState.play_mode}|${playerState.queue.length}|${playerState.volume}`;
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
          window.requestAnimationFrame(() => syncPluginContext());
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
