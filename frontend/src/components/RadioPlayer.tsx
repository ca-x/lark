import type { CSSProperties } from "react";
import { MagnifyingGlass, Pause, Play, SpeakerSimpleHigh } from "@phosphor-icons/react";
import type { createT } from "../i18n";
import type { RadioStation } from "../types";

function radioNeedlePosition(name?: string) {
  const seed = Array.from(name || "cliamp").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return 12 + (seed % 76);
}

function radioFrequency(name?: string) {
  const seed = Array.from(name || "cliamp").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return (87.5 + (seed % 198) / 10).toFixed(1);
}

export function RadioReceiver({
  title,
  subtitle,
  playing,
  t,
  onPlay,
  onBrowse,
  className = "",
}: {
  title: string;
  subtitle: string;
  playing: boolean;
  t: ReturnType<typeof createT>;
  onPlay: () => void;
  onBrowse?: () => void;
  className?: string;
}) {
  const needle = radioNeedlePosition(title);
  const freq = radioFrequency(title);
  return (
    <section className={`radio-receiver ${className}`} data-playing={playing ? "true" : "false"}>
      <div className="radio-antenna" aria-hidden="true" />
      <div className="radio-top-stripe" aria-hidden="true" />
      <div className="radio-face">
        <div className="radio-speaker" aria-hidden="true">
          {Array.from({ length: 48 }, (_, index) => (
            <i key={index} style={{ "--i": index } as CSSProperties} />
          ))}
        </div>
        <div className="radio-panel">
          <div className="radio-display">
            <div className="radio-scan" aria-hidden="true" />
            <div className="radio-band-row">
              <span>FM</span>
              <div className="radio-signal" aria-hidden="true">
                {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
              </div>
            </div>
            <strong>{freq}</strong>
            <small>{title.toUpperCase()}</small>
            <div className="radio-scale" style={{ "--needle": `${needle}%` } as CSSProperties}>
              <i />
            </div>
            <div className="radio-numbers"><span>87</span><span>92</span><span>97</span><span>102</span><span>107</span></div>
          </div>
          <div className="radio-actions">
            <button className={playing ? "radio-power on" : "radio-power"} onClick={onPlay} aria-label={playing ? t("pause") : t("playRadio")}>
              {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
            </button>
            <div>
              <span>{playing ? t("liveRadio") : t("onlineRadio")}</span>
              <small>{subtitle}</small>
            </div>
            {onBrowse ? <button onClick={onBrowse}><MagnifyingGlass /> {t("browseRadio")}</button> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export function RadioControlBar({
  station,
  playing,
  t,
  onToggle,
  onBrowse,
  onVolume,
}: {
  station: RadioStation;
  playing: boolean;
  t: ReturnType<typeof createT>;
  onToggle: () => void;
  onBrowse: () => void;
  onVolume: (value: number) => void;
}) {
  const subtitle = [station.country, station.codec, station.bitrate ? `${station.bitrate}kbps` : "", station.tags]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="radio-controlbar">
      <RadioReceiver
        title={station.name || t("onlineRadio")}
        subtitle={subtitle || station.url}
        playing={playing}
        t={t}
        onPlay={onToggle}
      />
      <div className="radio-console">
        <div className="radio-console-head">
          <span>{t("onlineRadio")}</span>
          <strong>{station.name}</strong>
          <small>{subtitle || station.url}</small>
        </div>
        <div className="radio-console-actions">
          <button className="primary" onClick={onToggle}>
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
            {playing ? t("pause") : t("playRadio")}
          </button>
          <button onClick={onBrowse}><MagnifyingGlass /> {t("browseRadio")}</button>
          <label>
            <SpeakerSimpleHigh />
            <input type="range" min="0" max="1" step="0.01" defaultValue="0.85" onChange={(event) => onVolume(Number(event.target.value))} />
          </label>
        </div>
      </div>
    </div>
  );
}
