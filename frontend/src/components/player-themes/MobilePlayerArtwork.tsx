import type { CSSProperties } from "react";
import { MetalTonearm } from "./MetalTonearm";
import { useArtworkActivity } from "./useArtworkActivity";
import type { MaterialTheme } from "./types";

type ArtworkProps = {
  variant: MaterialTheme;
  cover?: string;
  fallbackLabel?: string;
  playing?: boolean;
  progress?: number;
  onCoverError?: () => void;
  preview?: boolean;
};

/** Decorative only: transport controls and song information live in MobileArtPlayer. */
export function MobilePlayerArtwork({ variant, cover, fallbackLabel = "LP", playing = false, progress = 0, onCoverError, preview = false }: ArtworkProps) {
  const { ref: stage, visible } = useArtworkActivity(preview);

  const art = cover ? <img src={cover} alt="" decoding="async" draggable={false} onError={onCoverError} /> : <span className="material-cover-fallback"><b>{fallbackLabel}</b><small>LARK RECORDS</small></span>;
  const isTape = variant === "amber-tape" || variant === "clear-tape";
  const isDeck = variant === "soft-vinyl" || variant === "gramophone";
  return (
    <div ref={stage} className={`mobile-material-stage material-${variant}`} data-motion={playing && visible && !preview ? "running" : "paused"} data-playing={playing} aria-hidden="true" style={{ "--material-arm-angle": `${playing ? 18 + Math.min(1, Math.max(0, progress)) * 14 : -10}deg` } as CSSProperties}>
      <div className="material-scene">
        {isTape ? (
          <div className="material-cassette">
            <i className="material-screw top-left" /><i className="material-screw top-right" />
            <i className="material-screw bottom-left" /><i className="material-screw bottom-right" />
            <div className="material-tape-label"><div className="material-tape-cover">{art}</div><span>LARK<br /><b>ANALOG SERIES</b></span><strong>90</strong></div>
            <div className="material-tape-stripe"><b>A</b>{variant === "amber-tape" ? <span>STEREO / HIGH FIDELITY</span> : null}</div>
            <div className="material-tape-window">
              <div className="material-reel left"><i /><i /><i /><span className="material-reel-hub" /></div>
              <div className="material-tape-meter"><i /><span>100 · · · 50 · · · 0</span></div>
              <div className="material-reel right"><i /><i /><i /><span className="material-reel-hub" /></div>
            </div>
            <div className="material-tape-foot"><i /><span /><i /></div>
          </div>
        ) : isDeck ? (
          <>
            <div className="material-deck">
              <div className="material-belt" /><div className="material-motor" />
              <div className="material-platter"><div className="material-record material-spin"><div className="material-record-label">{art}</div></div><i className="material-spindle" /></div>
              <MetalTonearm className="material-tonearm" />
            </div>
            {variant === "gramophone" ? <div className="material-console"><i className="material-speaker" /><div className="material-wood"><b>LARK</b><small>HIGH FIDELITY</small><i /></div><i className="material-speaker" /><span className="material-console-trim" /></div> : <span className="material-deck-caption">LARK · PRECISION SERIES <b>33⅓</b></span>}
          </>
        ) : variant === "stage-glass" ? (
          <div className="material-glass-card">
            <div className="material-glass-heading"><b>LARK</b><span>THE GLASS SESSIONS</span></div>
            <div className="material-glass-orb" /><div className="material-glass-ribbon" />
            <div className="material-glass-disc material-spin"><div className="material-record-label">{art}</div></div>
            <div className="material-glass-footer"><span>STEREO<br /><b>COLLECTION</b></span><i>∞</i></div>
          </div>
        ) : (
          <div className="material-orbit">
            {variant === "blue-halo" ? <div className="material-spectrum" data-preview={preview}>{Array.from({ length: preview ? 40 : 80 }, (_, index) => <span key={index} style={{ transform: `rotate(${index * (preview ? 9 : 4.5)}deg)` }}><i style={{ "--bar-scale": .3 + (Math.sin(index * .73) + 1) * .35, "--bar-delay": `${-index * .073}s` } as CSSProperties} /></span>)}</div> : variant === "moss-wave" ? <div className="material-waves">{[0, 1, 2].map((index) => <svg key={index} viewBox="0 0 400 400"><path d="M200 29C250 18 262 55 305 72S357 125 363 179 355 270 322 310 250 371 196 372 105 351 70 311 31 245 30 196 51 141 68 101 116 65 151 47 178 32 200 29Z" /></svg>)}</div> : <><div className="material-sea-light" /><div className="material-sea-orbits"><i /><i /><i /></div><svg className="material-sea-fauna" viewBox="0 0 400 400"><g className="material-fish-school"><path d="M59 84q24-17 48 0-24 17-48 0l-13 10V74Z" /><path d="M285 305q17-12 34 0-17 12-34 0l-9 7v-14Z" /><path d="M314 280q12-8 24 0-12 8-24 0l-7 5v-10Z" /></g><path className="material-whale" d="M37 293q39 30 111 4-31 40-87 17-4 9-20 10l5-16q-10-4-18-15Z" /></svg></>}
            <div className="material-orbit-cover material-spin">{art}</div>
          </div>
        )}
      </div>
    </div>
  );
}
