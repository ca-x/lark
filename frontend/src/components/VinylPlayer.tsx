import type { CSSProperties } from "react";
import { Record } from "@phosphor-icons/react";

export function VinylTurntable({
  cover,
  playing,
  progress = 0,
  duration = 0,
  decorative = false,
  title = "Lark",
  artist = "Sonora",
}: {
  cover?: string;
  playing: boolean;
  progress?: number;
  duration?: number;
  decorative?: boolean;
  title?: string;
  artist?: string;
}) {
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  return (
    <div className={decorative ? "turntable vinyl-component decorative" : "turntable vinyl-component"} data-playing={playing ? "true" : "false"}>
      <div className="vinyl-plinth">
        <div className="vinyl-top-row">
          <div className="vinyl-platter-wrap">
            <div className="vinyl-mat">
              <div className="vinyl-record">
                <div className="vinyl-record-sheen" />
                <div className="vinyl-label">
                  {cover ? <img src={cover} alt="" /> : null}
                  <span>Sonora</span>
                  <strong>{title}</strong>
                  <em>33⅓ RPM</em>
                </div>
              </div>
            </div>
            <div className="vinyl-spindle" />
            <Tonearm progress={pct} playing={playing} />
          </div>
          <div className="vinyl-controls" aria-hidden="true">
            <div className="vinyl-speed-row"><span>RPM</span><i className="active">33⅓</i><i>45</i><i>78</i></div>
            <VUMeter playing={playing} seed={title + artist} />
            <div className="vinyl-knobs"><span><i />VOL</span><span><i />BASS</span><span><i />TREBLE</span></div>
            <div className="vinyl-mini-transport"><i /><b /><i /></div>
          </div>
        </div>
        <div className="vinyl-bottom-strip"><span className={playing ? "vinyl-led on" : "vinyl-led"} /><strong>Sonora</strong><em>REPEAT</em></div>
      </div>
      <div className="turntable-speed">33⅓ RPM</div>
      <div className="turntable-status">{playing ? "PLAY" : "PAUSE"}</div>
    </div>
  );
}

function Tonearm({ progress, playing }: { progress: number; playing: boolean }) {
  const angle = 28 - progress * 30;
  return (
    <svg className="vinyl-tonearm" viewBox="0 0 170 280" aria-hidden="true">
      <defs>
        <radialGradient id="vinylKnobGrad" cx="40%" cy="35%">
          <stop offset="0%" stopColor="var(--vinyl-knob-top)" />
          <stop offset="100%" stopColor="var(--vinyl-knob-base)" />
        </radialGradient>
      </defs>
      <circle cx="138" cy="28" r="14" fill="var(--vinyl-knob-base)" stroke="var(--vinyl-border)" strokeWidth="2" />
      <circle cx="138" cy="28" r="9" fill="url(#vinylKnobGrad)" stroke="var(--vinyl-border)" strokeWidth="1.5" />
      <circle cx="138" cy="28" r="3" fill="var(--vinyl-led)" />
      <g transform={`rotate(${playing ? angle : 28},138,28)`}>
        <rect x="131" y="28" width="10" height="130" rx="5" fill="var(--vinyl-arm)" stroke="var(--vinyl-border)" strokeWidth="1.5" />
        <rect x="133" y="30" width="3" height="126" rx="2" fill="var(--vinyl-arm-hi)" opacity=".68" />
        <g transform="translate(136,158) rotate(-15)">
          <rect x="-8" y="0" width="16" height="28" rx="3" fill="var(--vinyl-screen)" stroke="var(--vinyl-border)" strokeWidth="1.5" />
          <rect x="-6" y="20" width="12" height="7" rx="2" fill="var(--vinyl-knob-base)" stroke="var(--vinyl-border)" strokeWidth="1" />
          <line x1="0" y1="27" x2="0" y2="34" stroke="var(--vinyl-muted)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="0" cy="34" r="2" fill="var(--vinyl-muted)" />
        </g>
      </g>
      <line x1="138" y1="28" x2="155" y2="48" stroke="var(--vinyl-arm)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="155" cy="50" r="5" fill="var(--vinyl-knob-base)" stroke="var(--vinyl-border)" strokeWidth="1.5" />
    </svg>
  );
}

function VUMeter({ playing, seed }: { playing: boolean; seed: string }) {
  const base = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return (
    <div className="vinyl-vu">
      <span>· · · VU · · ·</span>
      {['L', 'R'].map((channel, channelIndex) => (
        <div key={channel} className="vinyl-vu-row">
          <em>{channel}</em>
          <div>
            {Array.from({ length: 18 }, (_, index) => {
              const lit = playing && index < 8 + ((base + channelIndex * 5 + index) % 7);
              const color = lit ? (index < 11 ? 'g' : index < 14 ? 'y' : 'r') : '';
              return <i key={index} className={color} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MiniCoverArt({ url, playing }: { url?: string; playing: boolean }) {
  const style = url ? ({ "--cover-url": `url(${url})` } as CSSProperties) : undefined;
  return (
    <div className="mini-art" data-playing={playing ? "true" : "false"} data-has-cover={url ? "true" : "false"} style={style}>
      {!url ? <Record weight="fill" /> : null}
    </div>
  );
}
