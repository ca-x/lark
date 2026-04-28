import { useMemo, type CSSProperties } from "react";
import type { createT } from "../i18n";

export function LoadingStage({ t }: { t: ReturnType<typeof createT> }) {
  const bars = useMemo(() => Array.from({ length: 28 }, (_, index) => index), []);
  const particles = useMemo(() => Array.from({ length: 18 }, (_, index) => {
    const angle = (index / 18) * Math.PI * 2;
    const radius = 54 + (index % 5) * 12;
    return { index, dx: `${Math.cos(angle) * radius}px`, dy: `${Math.sin(angle) * radius - 82}px` };
  }), []);
  return (
    <section className="loading-stage" aria-label={t("loading")}> 
      <div className="loading-grid-lines" aria-hidden="true" />
      <div className="loading-particles" aria-hidden="true">
        {particles.map((particle) => (
          <i key={particle.index} style={{ "--i": particle.index, "--dx": particle.dx, "--dy": particle.dy } as CSSProperties} />
        ))}
      </div>
      <div className="loading-center-ring" aria-hidden="true">
        <svg className="loading-ring-svg" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r="60" fill="none" className="loading-ring-track" />
          <circle cx="70" cy="70" r="48" fill="none" className="loading-ring-track thin" />
          <circle cx="70" cy="70" r="60" fill="none" className="loading-outer-arc" pathLength="380" />
          <circle cx="70" cy="70" r="48" fill="none" className="loading-inner-arc" pathLength="302" />
        </svg>
        <div className="loading-disc"><img src="/logo.png" alt="" /><div /></div>
      </div>
      <div className="loading-bars-row" aria-hidden="true">
        {bars.map((bar) => <i key={bar} style={{ "--i": bar } as CSSProperties} />)}
      </div>
      <div className="loading-wordmark">{t("brand")}</div>
      <div className="loading-tagline">{t("loadingTagline")}</div>
      <div className="loading-progress-wrap"><div /></div>
    </section>
  );
}
