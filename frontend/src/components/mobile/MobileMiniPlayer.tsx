import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Pause, Play, Queue, Record, SkipForward } from "@phosphor-icons/react";

import type { MobileHomePlayerStyle } from "../../types";

export function MobileMiniPlayer({
  theme,
  cover,
  title,
  artist,
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
  useEffect(() => {
    if (cover !== failedCover) setFailedCover("");
  }, [cover, failedCover]);
  const displayCover = cover && cover !== failedCover ? cover : "";
  const pct = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
  const style = {
    "--mobile-mini-progress": `${pct.toFixed(2)}%`,
    ...(displayCover ? { "--mobile-mini-cover": `url("${displayCover.replace(/"/g, "%22")}")` } : {}),
  } as CSSProperties;

  const expandLabel = title ? `${labels.expand}: ${title}` : labels.expand;

  return (
    <div className="mobile-mini-player" data-mobile-theme={theme} data-playing={playing ? "true" : "false"} style={style}>
      <button type="button" className="mobile-mini-main" aria-label={expandLabel} onClick={onExpand}>
        <span className="mobile-mini-art" aria-hidden="true">
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
      <button type="button" className="mobile-mini-play" aria-label={playing ? labels.pause : labels.play} onClick={onToggle}>
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
