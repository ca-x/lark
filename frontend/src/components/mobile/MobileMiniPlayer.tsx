import type { CSSProperties } from "react";
import { Pause, Play, Record, SkipBack, SkipForward } from "@phosphor-icons/react";

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
  onPrevious,
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
    previous: string;
    next: string;
    play: string;
    pause: string;
    expand: string;
  };
  onToggle: () => void;
  onExpand: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const pct = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
  const style = {
    "--mobile-mini-progress": `${pct.toFixed(2)}%`,
    ...(cover ? { "--mobile-mini-cover": `url("${cover.replace(/"/g, "%22")}")` } : {}),
  } as CSSProperties;

  return (
    <div className="mobile-mini-player" data-mobile-theme={theme} data-playing={playing ? "true" : "false"} style={style}>
      <button type="button" className="mobile-mini-art" aria-label={labels.expand} onClick={onExpand}>
        {cover ? null : <Record weight="fill" />}
      </button>
      <div className="mobile-mini-info">
        <div className="mobile-mini-meta">
          <strong>{title}</strong>
          <span>{artist}</span>
        </div>
        <span className="mobile-mini-progress" aria-hidden="true" />
      </div>
      <button type="button" className="mobile-mini-previous" aria-label={labels.previous} disabled={!onPrevious} onClick={onPrevious}>
        <SkipBack weight="fill" />
      </button>
      <button type="button" className="mobile-mini-play" aria-label={playing ? labels.pause : labels.play} onClick={onToggle}>
        {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
      </button>
      <button type="button" className="mobile-mini-next" aria-label={labels.next} disabled={!onNext} onClick={onNext}>
        <SkipForward weight="fill" />
      </button>
    </div>
  );
}
