import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Queue, Record, SkipForward } from "@phosphor-icons/react";

import type { MobileHomePlayerStyle } from "../../types";
import { resolvePlayerSwipe } from "./playerSwipe";

export function MobileMiniPlayer({
  theme,
  cover,
  title,
  artist,
  available,
  playing,
  progress,
  duration,
  labels,
  onToggle,
  onExpand,
  onQueue,
  onNext,
}: {
  theme: MobileHomePlayerStyle;
  cover?: string;
  title: string;
  artist: string;
  available: boolean;
  playing: boolean;
  progress: number;
  duration: number;
  labels: {
    play: string;
    pause: string;
    expand: string;
    queue: string;
    next: string;
  };
  onToggle: () => void;
  onExpand: () => void;
  onQueue?: () => void;
  onNext?: () => void;
}) {
  const [failedCover, setFailedCover] = useState("");
  const swipe = useRef<{ x: number; y: number; time: number } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    if (cover !== failedCover) setFailedCover("");
  }, [cover, failedCover]);
  const displayCover = cover && cover !== failedCover ? cover : "";
  const fallbackLabel = coverFallbackLabel(title, artist);
  const pct = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
  const style = {
    "--mobile-mini-progress": `${pct.toFixed(2)}%`,
    ...(displayCover ? { "--mobile-mini-cover": `url("${displayCover.replace(/"/g, "%22")}")` } : {}),
  } as CSSProperties;

  const expandLabel = title ? `${labels.expand}: ${title}` : labels.expand;

  return (
    <div className="mobile-mini-player" data-mobile-theme={theme} data-playing={playing ? "true" : "false"} style={style}>
      <button type="button" className="mobile-mini-main" aria-label={expandLabel} disabled={!available}
        onTouchStart={(event) => {
          suppressClick.current = false;
          const touch = event.touches[0];
          swipe.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY, time: performance.now() } : null;
        }}
        onTouchMove={(event) => {
          if (event.touches.length !== 1) { swipe.current = null; suppressClick.current = true; }
        }}
        onTouchCancel={() => { swipe.current = null; suppressClick.current = true; }}
        onTouchEnd={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start) return;
          const touch = event.changedTouches[0];
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          suppressClick.current = Math.max(Math.abs(dx), Math.abs(dy)) > 10;
          if (resolvePlayerSwipe(dx, dy, performance.now() - start.time) === "expand") onExpand();
        }}
        onClick={(event) => { if (event.detail === 0 || !suppressClick.current) onExpand(); suppressClick.current = false; }}>
        <span className="mobile-mini-art" data-has-cover={displayCover ? "true" : "false"} data-fallback-label={fallbackLabel} aria-hidden="true">
          {displayCover ? (
            <img src={displayCover} alt="" loading="eager" decoding="async" onError={() => setFailedCover(displayCover)} />
          ) : (
            <Record weight="fill" />
          )}
        </span>
        <span className="mobile-mini-info">
          <span className="mobile-mini-meta">
            <strong>{title}</strong>
            <span>{artist}</span>
          </span>
        </span>
      </button>
      <button type="button" className="mobile-mini-play" aria-label={playing ? labels.pause : labels.play} disabled={!available} onClick={onToggle}>
        {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
      </button>
      <button type="button" className="mobile-mini-next" aria-label={labels.next} disabled={!onNext} onClick={onNext}>
        <SkipForward weight="bold" />
      </button>
      <button type="button" className="mobile-mini-queue" aria-label={labels.queue} disabled={!onQueue} onClick={onQueue}>
        <Queue weight="bold" />
      </button>
      <span className="mobile-mini-progress" aria-hidden="true" />
    </div>
  );
}

function coverFallbackLabel(title?: string, artist?: string) {
  const raw = `${artist || ""} ${title || ""}`.trim() || title || artist || "L";
  const parts = raw
    .split(/[\s._\-·/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chars = (parts.length >= 2 ? [parts[0][0], parts[1][0]] : Array.from(raw).slice(0, 2))
    .join("")
    .toUpperCase();
  return chars || "L";
}
