import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

import type { PlayerThemePlayMode } from "./types";

const CASSETTE_COVER_UNFOLDED_KEY = "lark:cassette-cover-unfolded";

export function CassetteDeck({
  cover,
  playing,
  progress = 0,
  duration = 0,
  decorative = false,
  title = "Lark",
  artist = "Sonora",
  playMode = "sequence",
  playModeLabel = "Play mode",
  onToggle,
  onPrevious,
  onNext,
  onCyclePlayMode,
  onSeek,
}: {
  cover?: string;
  playing: boolean;
  progress?: number;
  duration?: number;
  decorative?: boolean;
  title?: string;
  artist?: string;
  playMode?: PlayerThemePlayMode;
  playModeLabel?: string;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
}) {
  const [coverUnfolded, setCoverUnfolded] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(CASSETTE_COVER_UNFOLDED_KEY) !== "false";
  });

  useEffect(() => {
    window.localStorage.setItem(CASSETTE_COVER_UNFOLDED_KEY, coverUnfolded ? "true" : "false");
  }, [coverUnfolded]);

  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const leftReel = 35 - pct * 13;
  const rightReel = 23 + pct * 13;
  const canSeek = Boolean(duration && onSeek);
  const seekBy = (delta: number) => {
    if (!canSeek) return;
    onSeek?.(Math.max(0, Math.min(duration, progress + delta)));
  };
  const coverImage = cover ? `url("${cover.replace(/"/g, "%22")}")` : undefined;
  const deckStyle = {
    "--cassette-progress-pct": `${(pct * 100).toFixed(2)}%`,
    "--cassette-left-reel": leftReel.toFixed(2),
    "--cassette-right-reel": rightReel.toFixed(2),
    ...(coverImage ? { "--cassette-cover-image": coverImage } : {}),
  } as CSSProperties;
  return (
    <div className={decorative ? "cassette-component decorative" : "cassette-component"} data-playing={playing ? "true" : "false"} style={deckStyle}>
      <div className="cassette-deck">
        <div className="cassette-brand-bar">
          <div className="cassette-brand">SŌNIX</div>
          <div className="cassette-model-row">
            <span className={playing ? "cassette-led on" : "cassette-led"} />
            <span>TC-900 MKII · TYPE II</span>
          </div>
        </div>

        <CassetteShell
          coverUnfolded={coverUnfolded}
          duration={duration}
          leftReel={leftReel}
          rightReel={rightReel}
          title={title}
          artist={artist}
          onToggleCover={() => setCoverUnfolded((value) => !value)}
        />

        <div className="cassette-lcd">
          <div className="cassette-lcd-left">
            <span>TRACK 01 · SIDE A</span>
            <div><strong>{artist} — {title}</strong></div>
          </div>
          <time>{formatTime(progress)} / {formatTime(duration || 0)}</time>
        </div>

        <div className="cassette-progress-row">
          <span className="cassette-progress-track" aria-hidden="true"><span /></span>
          <input
            aria-label="Position"
            type="range"
            min="0"
            max={Math.max(0, duration || 0)}
            step="0.01"
            value={Math.min(progress, duration || progress || 0)}
            disabled={!canSeek}
            onChange={(event) => onSeek?.(Number(event.target.value))}
          />
        </div>

        <div className="cassette-vu" aria-hidden="true">
          <div><span>L ───────── +3dB</span><i /></div>
          <div><span>R ───────── +3dB</span><i /></div>
        </div>

        <div className="cassette-controls">
          <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
          <button type="button" aria-label="Back 10 seconds" disabled={!canSeek} onClick={() => seekBy(-10)}>-10</button>
          <button type="button" className="cassette-play" aria-label={playing ? "Pause" : "Play"} onClick={onToggle} disabled={!onToggle}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
          <button type="button" aria-label="Forward 10 seconds" disabled={!canSeek} onClick={() => seekBy(10)}>+10</button>
          <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
          <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} onClick={onCyclePlayMode} disabled={!onCyclePlayMode}>
            {playMode === "shuffle" ? <Shuffle /> : playMode === "repeat-one" ? <RepeatOnce /> : <Repeat />}
          </button>
        </div>
      </div>
    </div>
  );
}

function CassetteShell({
  coverUnfolded,
  duration,
  leftReel,
  rightReel,
  title,
  artist,
  onToggleCover,
}: {
  coverUnfolded: boolean;
  duration: number;
  leftReel: number;
  rightReel: number;
  title: string;
  artist: string;
  onToggleCover: () => void;
}) {
  return (
        <div className="cassette-bay">
          <div className="cassette-shell-stage">
            <svg className="cassette-svg" viewBox="0 0 440 220" aria-hidden="true">
            <defs>
              <linearGradient id="cassetteShellGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--cassette-shell-hi)" />
                <stop offset="45%" stopColor="var(--cassette-shell)" />
                <stop offset="100%" stopColor="var(--cassette-shell-dark)" />
              </linearGradient>
              <linearGradient id="cassetteLabelGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--cassette-label-a)" />
                <stop offset="54%" stopColor="var(--cassette-label-b)" />
                <stop offset="100%" stopColor="var(--cassette-label-c)" />
              </linearGradient>
              <linearGradient id="cassetteTapeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6a4820" />
                <stop offset="46%" stopColor="#8a6030" />
                <stop offset="100%" stopColor="#5a3c18" />
              </linearGradient>
              <radialGradient id="cassetteHubGrad" cx="35%" cy="30%" r="65%">
                <stop offset="0%" stopColor="#4a4030" />
                <stop offset="60%" stopColor="#2a2018" />
                <stop offset="100%" stopColor="#181410" />
              </radialGradient>
              <clipPath id="cassetteArtClip"><rect x="32" y="14" width="100" height="100" rx="3" /></clipPath>
              <clipPath id="cassetteWindowClip"><rect x="106" y="72" width="228" height="96" rx="8" /></clipPath>
            </defs>

            <rect x="20" y="4" width="400" height="212" rx="10" fill="rgba(0,0,0,.5)" />
            <path d="M18,8 Q18,0 26,0 L414,0 Q422,0 422,8 L422,212 Q422,220 414,220 L26,220 Q18,220 18,212 Z" fill="url(#cassetteShellGrad)" stroke="var(--cassette-border)" strokeWidth="1" />
            <path d="M26,1 L414,1" stroke="rgba(255,255,255,.09)" strokeWidth="1.5" fill="none" />
            <rect x="26" y="8" width="388" height="196" rx="7" fill="url(#cassetteLabelGrad)" />
            <line x1="26" y1="44" x2="414" y2="44" stroke="rgba(0,0,0,.08)" strokeWidth=".8" />
            <line x1="26" y1="172" x2="414" y2="172" stroke="rgba(0,0,0,.1)" strokeWidth=".8" />

            <rect x="30" y="12" width="104" height="104" rx="4" fill="transparent" stroke="rgba(0,0,0,.18)" strokeWidth=".8" />
            <rect x="30" y="12" width="104" height="40" rx="4" fill="rgba(255,255,255,.035)" pointerEvents="none" />
            <line x1="134" y1="12" x2="134" y2="116" stroke="rgba(0,0,0,.2)" strokeWidth="1" />

            <text x="148" y="35" className="cassette-svg-title">{title}</text>
            <text x="148" y="50" className="cassette-svg-artist">{artist}</text>
            <text x="148" y="100" className="cassette-svg-spec">TYPE II · CrO₂ · IEC II</text>
            <text x="148" y="112" className="cassette-svg-spec">SIDE A — {formatTime(duration || 0)}</text>

            <rect x="103" y="69" width="234" height="102" rx="10" fill="#0e1408" stroke="var(--cassette-window-border)" strokeWidth="1.5" />
            <g clipPath="url(#cassetteWindowClip)">
              <rect x="106" y="72" width="228" height="96" rx="8" fill="#0a0e08" />
              <rect x="106" y="72" width="228" height="16" rx="8" fill="rgba(255,255,255,.025)" />
              <g className="cassette-left-reel" transform="translate(158,120)">
                <circle r={leftReel} fill="var(--cassette-tape-left)" />
                <circle r={Math.max(17, leftReel - 7)} fill="none" stroke="#7a5828" strokeWidth=".8" opacity=".45" />
                <circle r="17" fill="url(#cassetteHubGrad)" />
                <CassetteHub />
              </g>
              <g className="cassette-right-reel" transform="translate(276,120)">
                <circle r={rightReel} fill="var(--cassette-tape-right)" />
                <circle r={Math.max(15, rightReel - 6)} fill="none" stroke="#5a4020" strokeWidth=".8" opacity=".44" />
                <circle r="15" fill="url(#cassetteHubGrad)" />
                <CassetteHub small />
              </g>
              <circle cx="123" cy="152" r="3.5" fill="#282018" stroke="#3a3020" strokeWidth="1" />
              <circle cx="311" cy="152" r="3.5" fill="#282018" stroke="#3a3020" strokeWidth="1" />
              <rect x="123" y="149" width="188" height="5" fill="url(#cassetteTapeGrad)" rx="1" />
              <rect x="123" y="149" width="188" height="2" fill="rgba(160,100,40,.22)" rx="1" />
              <rect x="210" y="147" width="14" height="10" rx="2" fill="#1a1814" stroke="#282018" strokeWidth=".8" />
              <rect x="214" y="156" width="6" height="14" rx="3" fill="#242018" stroke="#1a1610" strokeWidth=".5" />
            </g>
            <rect x="103" y="69" width="234" height="102" rx="10" fill="none" stroke="rgba(255,255,255,.045)" strokeWidth="1" />
            {[ [44,42], [396,42], [44,178], [396,178] ].map(([cx, cy]) => (
              <g key={`${cx}-${cy}`}>
                <circle cx={cx} cy={cy} r="6" fill="#282018" stroke="#1a1610" strokeWidth=".8" />
                <line x1={cx - 3} y1={cy} x2={cx + 3} y2={cy} stroke="#3a3020" strokeWidth="1.2" />
                <line x1={cx} y1={cy - 3} x2={cx} y2={cy + 3} stroke="#3a3020" strokeWidth="1.2" />
              </g>
            ))}
            </svg>
            <button
              type="button"
              className="cassette-cover-fold"
              data-unfolded={coverUnfolded ? "true" : "false"}
              aria-label={coverUnfolded ? "Fold album cover" : "Unfold album cover"}
              title={coverUnfolded ? "Fold album cover" : "Unfold album cover"}
              onClick={onToggleCover}
            >
              <span className="cassette-cover-half cassette-cover-left" />
              <span className="cassette-cover-half cassette-cover-right" />
            </button>
          </div>
        </div>
  );
}

function CassetteHub({ small = false }: { small?: boolean }) {
  const width = small ? 3.2 : 3.6;
  const height = small ? 8 : 9;
  const y = small ? -14 : -16;
  return (
    <g className="cassette-hub">
      {[0, 72, 144, 216, 288].map((angle) => (
        <rect key={angle} x={-width / 2} y={y} width={width} height={height} rx={width / 2} fill="#3a3020" transform={angle ? `rotate(${angle})` : undefined} />
      ))}
      <rect x={small ? -4 : -4.5} y={small ? -4 : -4.5} width={small ? 8 : 9} height={small ? 8 : 9} rx="2" fill="#2f261b" stroke="#1a1410" strokeWidth=".5" />
    </g>
  );
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
