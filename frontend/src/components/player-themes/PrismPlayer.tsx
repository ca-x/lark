import { useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ConceptPlayerControls, type ConceptPlayerProps } from "./ConceptPlayerControls";
import { useCoverFallback } from "./useCoverFallback";

const SPECTRUM = [
  { color: "#8f40ff", wavelength: 410 },
  { color: "#365fff", wavelength: 465 },
  { color: "#26cbe9", wavelength: 495 },
  { color: "#65e59b", wavelength: 535 },
  { color: "#efdf68", wavelength: 580 },
  { color: "#f2a357", wavelength: 620 },
  { color: "#ee6260", wavelength: 690 },
];

type PrismPlayerProps = ConceptPlayerProps & {
  splitLightLabel?: string;
  spectrumLabel?: string;
  visualizationLabel?: string;
};

export function PrismPlayer({ splitLightLabel = "Split light", spectrumLabel = "Spectrum color", visualizationLabel = "Optical study", ...props }: PrismPlayerProps) {
  const { title = "Lark", artist = "", album = "", playing } = props;
  const [split, setSplit] = useState(true);
  const [wavelength, setWavelength] = useState(550);
  const [selectingColor, setSelectingColor] = useState(false);
  const glassRef = useRef<HTMLDivElement>(null);
  const cover = useCoverFallback(props.cover);
  const opticsId = useId().replaceAll(":", "");
  const color = SPECTRUM.reduce((nearest, band) => Math.abs(band.wavelength - wavelength) < Math.abs(nearest.wavelength - wavelength) ? band : nearest);

  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !glassRef.current) return;
    const horizontal = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    const vertical = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    glassRef.current.style.transform = `perspective(900px) rotateX(${-vertical * 7}deg) rotateY(${horizontal * 12}deg)`;
  };

  return (
    <div className="concept-player prism-player" data-playing={String(playing)} data-split={String(split)} style={{ "--prism-color": color.color } as CSSProperties}>
      <header className="prism-heading">
        <span className="concept-player-brand">Lark <span>/ Prism</span></span>
        <button type="button" className="prism-split" aria-label={splitLightLabel} aria-pressed={split} onClick={() => setSplit((value) => !value)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1 8h5m0 0 9-6M6 8h9M6 8l9 6" stroke="currentColor" strokeWidth="1.2" /></svg>
          {splitLightLabel}
        </button>
      </header>
      <div className="prism-track">
        <h2 title={title}>{title}</h2>
        <p title={artist}>{artist}</p>
        <span title={album}>{album}</span>
      </div>
      <div className="prism-optics" onPointerMove={tilt} onPointerLeave={() => { if (glassRef.current) glassRef.current.style.transform = ""; }} aria-hidden="true">
        <svg className="prism-light" viewBox="0 0 1200 680" preserveAspectRatio="none" focusable="false">
          <defs>
            <filter id={`${opticsId}-soft`} x="-30%" y="-50%" width="160%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
            <filter id={`${opticsId}-glow`} x="-30%" y="-50%" width="160%" height="200%"><feGaussianBlur stdDeviation="16" /></filter>
            <linearGradient id={`${opticsId}-white`} x1="0" y1="550" x2="650" y2="428" gradientUnits="userSpaceOnUse"><stop stopColor="#e8ebf5" stopOpacity="0" /><stop offset=".3" stopColor="#e8ebf5" stopOpacity=".65" /><stop offset="1" stopColor="#fff" /></linearGradient>
            <linearGradient id={`${opticsId}-reflection`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fff" stopOpacity=".35" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
            <mask id={`${opticsId}-fade`}><rect width="1200" height="680" fill={`url(#${opticsId}-reflection)`} /></mask>
            {SPECTRUM.map((band, index) => (
              <linearGradient key={band.color} id={`${opticsId}-band-${index}`} x1="650" y1="428" x2="1160" y2="180" gradientUnits="userSpaceOnUse">
                <stop stopColor="#fff" stopOpacity=".15" /><stop offset=".16" stopColor={band.color} stopOpacity=".6" /><stop offset="1" stopColor={band.color} stopOpacity=".9" />
              </linearGradient>
            ))}
            <g id={`${opticsId}-fan`}>
              {SPECTRUM.map((band, index) => (
                <path key={band.color} d={`M650 428L1280 ${-240 + index * 86}L1280 ${-90 + index * 86}Z`} fill={`url(#${opticsId}-band-${index})`} opacity={selectingColor && band !== color ? .24 : 1} />
              ))}
            </g>
          </defs>
          <g className="prism-incoming">
            <path d="M-80 564L650 428" stroke={`url(#${opticsId}-white)`} strokeWidth="18" filter={`url(#${opticsId}-soft)`} />
            <path d="M-80 564L650 428" stroke={`url(#${opticsId}-white)`} strokeWidth="3" />
          </g>
          <g className="prism-fan">
            <use href={`#${opticsId}-fan`} filter={`url(#${opticsId}-glow)`} opacity=".6" />
            <use href={`#${opticsId}-fan`} filter={`url(#${opticsId}-soft)`} />
          </g>
          <g className="prism-light-reflection" mask={`url(#${opticsId}-fade)`}>
            <path d="M-80 520L650 624" stroke={`url(#${opticsId}-white)`} strokeWidth="10" filter={`url(#${opticsId}-soft)`} />
            <use className="prism-fan" href={`#${opticsId}-fan`} transform="translate(0 1030) scale(1 -.4)" filter={`url(#${opticsId}-soft)`} />
          </g>
        </svg>
        <div className="prism-glass-reflection" />
        <div ref={glassRef} className="prism-glass">
          {cover.displayUrl ? <img src={cover.displayUrl} alt="" width="180" height="260" decoding="async" onError={cover.onCoverError} /> : null}
          <span className="prism-glass-mark">LARK <span>PRISM</span></span>
          <span className="prism-glass-caustic" />
          <span className="prism-glass-caption">{album || title}</span>
        </div>
      </div>
      <div className="prism-spectrum">
        <label htmlFor={`${opticsId}-spectrum`}>{spectrumLabel}<output htmlFor={`${opticsId}-spectrum`}>{wavelength} nm</output></label>
        <input
          id={`${opticsId}-spectrum`}
          aria-label={spectrumLabel}
          aria-valuetext={`${wavelength} nm`}
          type="range"
          min="380"
          max="750"
          step="1"
          value={wavelength}
          disabled={!split}
          onFocus={() => setSelectingColor(true)}
          onBlur={() => setSelectingColor(false)}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (split && Number.isFinite(next)) setWavelength(Math.round(Math.max(380, Math.min(750, next))));
          }}
        />
        <span className="prism-spectrum-ends" aria-hidden="true"><span>380</span><span>750 nm</span></span>
      </div>
      <span className="prism-study">{visualizationLabel}</span>
      <ConceptPlayerControls {...props} />
    </div>
  );
}
