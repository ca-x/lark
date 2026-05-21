import type { CSSProperties } from "react";
import { CaretUp, HeartStraight, Pause, Play, Queue, Record } from "@phosphor-icons/react";

import type { MobileHomePlayerStyle } from "../../types";

export function MobileMiniPlayer({
  theme,
  cover,
  title,
  artist,
  playing,
  progress,
  duration,
  favoriteActive,
  queueActive,
  labels,
  onToggle,
  onExpand,
  onFavorite,
  onQueue,
}: {
  theme: MobileHomePlayerStyle;
  cover?: string;
  title: string;
  artist: string;
  playing: boolean;
  progress: number;
  duration: number;
  favoriteActive?: boolean;
  queueActive?: boolean;
  labels: {
    play: string;
    pause: string;
    favorite: string;
    queue: string;
    expand: string;
  };
  onToggle: () => void;
  onExpand: () => void;
  onFavorite?: () => void;
  onQueue?: () => void;
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
      <button type="button" className="mobile-mini-meta" onClick={onExpand}>
        <strong>{title}</strong>
        <span>{artist}</span>
      </button>
      <button type="button" className={favoriteActive ? "active" : ""} aria-label={labels.favorite} disabled={!onFavorite} onClick={onFavorite}>
        <HeartStraight weight={favoriteActive ? "fill" : "regular"} />
      </button>
      <button type="button" className="mobile-mini-play" aria-label={playing ? labels.pause : labels.play} onClick={onToggle}>
        {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
      </button>
      <button type="button" className={queueActive ? "active" : ""} aria-label={labels.queue} disabled={!onQueue} onClick={onQueue}>
        <Queue weight={queueActive ? "fill" : "regular"} />
      </button>
      <button type="button" className="mobile-mini-expand" aria-label={labels.expand} onClick={onExpand}>
        <CaretUp weight="bold" />
      </button>
      <span className="mobile-mini-progress" aria-hidden="true" />
    </div>
  );
}
