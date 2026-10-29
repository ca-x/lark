import { useId, type CSSProperties } from "react";
import { ConceptPlayerControls, type ConceptPlayerProps } from "./ConceptPlayerControls";
import { playbackPosition } from "./conceptPlayback";
import { MetalTonearm } from "./MetalTonearm";
import { useArtworkActivity } from "./useArtworkActivity";
import { useCoverFallback } from "./useCoverFallback";

export function SoftStaticPlayer(props: ConceptPlayerProps) {
  const { title = "Lark", artist = "", album = "", playing, activeLyricText } = props;
  const { ref, visible } = useArtworkActivity(!playing);
  const cover = useCoverFallback(props.cover);
  const textureId = useId().replaceAll(":", "");
  const { fraction } = playbackPosition(props.progress, props.duration);
  const style = { "--soft-static-arm": `${playing ? -16 + fraction * 14 : -29}deg` } as CSSProperties;

  return (
    <div ref={ref} className="concept-player soft-static-player" data-playing={String(playing)} data-motion={visible ? "running" : "paused"} style={style}>
      <header className="soft-static-heading">
        <span className="concept-player-brand">Soft Static</span>
        <h2 title={title}>{title}</h2>
        <span title={artist}>{artist}</span>
      </header>
      <div className="soft-static-platter" aria-hidden="true">
        <div className="soft-static-strobe" />
        <div className="soft-static-rotor">
          <svg className="soft-static-marble" viewBox="0 0 640 640" focusable="false">
            <defs>
              <filter id={`${textureId}-marble`} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
                <feTurbulence type="fractalNoise" baseFrequency="0.009 0.016" numOctaves="2" seed="17" result="noise" />
                <feDisplacementMap in="SourceGraphic" in2="noise" scale="106" xChannelSelector="R" yChannelSelector="G" />
              </filter>
              <linearGradient id={`${textureId}-ink`} x1="0" y1="0" x2="1" y2="1">
                <stop stopColor="#69277d" />
                <stop offset=".45" stopColor="#ed2387" />
                <stop offset=".75" stopColor="#fb547c" />
                <stop offset="1" stopColor="#9e218e" />
              </linearGradient>
            </defs>
            <rect width="640" height="640" fill="#c81e8a" />
            <g filter={`url(#${textureId}-marble)`} fill="none" strokeLinecap="round">
              <path d="M-80 480C180 50 530 720 720 70" stroke="#552a85" strokeWidth="150" />
              <path d="M-80 490C170 70 550 720 720 90" stroke="#6b318b" strokeWidth="40" />
              <path d="M-70 165C200 520 490-100 710 360" stroke="#fb8655" strokeWidth="49" />
              <path d="M-70 205C200 560 500-80 710 410" stroke="#fc438e" strokeWidth="90" />
              <path d="M-50 190C210 550 495-80 710 395" stroke="#ec256f" strokeWidth="24" />
              <path d="M0 620C490 640 120-90 640 5" stroke={`url(#${textureId}-ink)`} strokeWidth="148" />
              <path d="M0 625C490 640 120-70 640 10" stroke="#e23b9c" strokeWidth="14" />
            </g>
          </svg>
          <span className="soft-static-grooves" />
          <div className="soft-static-record-label">
            {cover.displayUrl ? <img src={cover.displayUrl} alt="" width="160" height="160" decoding="async" onError={cover.onCoverError} /> : <span className="soft-static-label-name">Lark<br />Soft Static</span>}
            <span className="soft-static-label-speed">33⅓</span>
            <span className="soft-static-spindle" />
          </div>
        </div>
        <span className="soft-static-sheen" />
      </div>
      <MetalTonearm className="soft-static-tonearm" />
      <div className="soft-static-listening">
        <div className="soft-static-orbit soft-static-orbit-before" aria-hidden="true"><span>{album || title}</span><span>{artist}</span></div>
        <p className="soft-static-lyric">{activeLyricText?.trim() || title}</p>
        <p className="soft-static-credit" title={[artist, album].filter(Boolean).join(" / ")}>{artist}{artist && album ? <span aria-hidden="true"> / </span> : null}{album}</p>
        <div className="soft-static-orbit soft-static-orbit-after" aria-hidden="true"><span>{artist}</span><span>{album || title}</span></div>
      </div>
      <span className="soft-static-edition" aria-hidden="true">LARK RECORDS <span>STEREO / 33⅓ RPM</span></span>
      <ConceptPlayerControls {...props} />
    </div>
  );
}
