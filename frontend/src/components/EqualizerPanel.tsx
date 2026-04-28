import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { Power, X } from "@phosphor-icons/react";
import type { createT } from "../i18n";
import { EQ_FREQUENCIES, EQ_PRESETS, type EqualizerPresetKey } from "./equalizer";

const presetKeys = Object.keys(EQ_PRESETS) as EqualizerPresetKey[];

function formatFrequency(frequency: number) {
  return frequency >= 1000 ? `${frequency / 1000}kHz` : `${frequency}Hz`;
}

function formatFrequencyShort(frequency: number) {
  return frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`;
}

function formatGain(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(value % 1 ? 1 : 0)}`;
}

function eqCurvePath(bands: number[], width = 560, height = 80) {
  const points: string[] = [];
  for (let x = 0; x <= width; x += 8) {
    const t = x / width;
    let gain = 0;
    for (let i = 0; i < EQ_FREQUENCIES.length; i += 1) {
      const center = i / (EQ_FREQUENCIES.length - 1);
      const sigma = 0.13;
      const weight = Math.exp(-((t - center) ** 2) / (2 * sigma * sigma));
      gain += (bands[i] ?? 0) * weight;
    }
    const y = height / 2 - (gain / 12) * (height / 2 - 8);
    points.push(`${x.toFixed(1)},${Math.max(4, Math.min(height - 4, y)).toFixed(1)}`);
  }
  return points.reduce((path, point, index) => `${path}${index === 0 ? "M" : " L"}${point}`, "");
}

function matchingPreset(bands: number[]) {
  return presetKeys.find((key) => EQ_PRESETS[key].every((value, index) => value === (bands[index] ?? 0))) || "";
}

export function EqualizerPanel({
  t,
  enabled,
  bands,
  onToggle,
  onChange,
  onReset,
  onApplyPreset,
  onClose,
}: {
  t: ReturnType<typeof createT>;
  enabled: boolean;
  bands: number[];
  onToggle: () => void;
  onChange: (index: number, value: number) => void;
  onReset: () => void;
  onApplyPreset: (bands: number[]) => void;
  onClose: () => void;
}) {
  const [focusIndex, setFocusIndex] = useState(4);
  const activePreset = matchingPreset(bands);
  const curve = useMemo(() => eqCurvePath(bands), [bands]);
  const focusGain = bands[focusIndex] ?? 0;
  return (
    <div className="eq-popover eq-shell" data-enabled={enabled ? "true" : "false"} role="dialog" aria-label={t("equalizer")}>
      <div className="eq-card">
        <div className="eq-topbar">
          <span className="eq-title">{t("equalizer")}</span>
          <div className="eq-top-actions">
            <button type="button" className={enabled ? "eq-power on" : "eq-power"} aria-label={enabled ? t("off") : t("on")} onClick={onToggle}>
              <Power weight="bold" />
            </button>
            <button type="button" className="eq-close" aria-label={t("close")} onClick={onClose}><X /></button>
          </div>
        </div>

        <div className="eq-presets" aria-label={t("equalizerPresets")}>
          {presetKeys.map((key) => (
            <button
              key={key}
              type="button"
              className={activePreset === key ? "active" : ""}
              disabled={!enabled}
              onClick={() => onApplyPreset(EQ_PRESETS[key])}
            >
              {t(`eqPreset${key[0].toUpperCase()}${key.slice(1)}` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>

        <div className="eq-viz" aria-hidden="true">
          <div className="center-line" />
          <svg className="curve-canvas" viewBox="0 0 560 80" preserveAspectRatio="none">
            <path className="eq-fill" d={`${curve} L560,80 L0,80 Z`} />
            <path className="eq-curve" d={curve} />
          </svg>
        </div>

        <div className="eq-vertical-bands">
          {EQ_FREQUENCIES.map((frequency, index) => {
            const gain = bands[index] ?? 0;
            return (
              <label key={frequency} className="eq-band">
                <span className={gain ? "band-val active-val" : "band-val"}>{formatGain(gain)}</span>
                <span className="slider-wrap">
                  <input
                    type="range"
                    className="vslider"
                    min="-12"
                    max="12"
                    step="0.5"
                    value={gain}
                    disabled={!enabled}
                    onFocus={() => setFocusIndex(index)}
                    onPointerDown={() => setFocusIndex(index)}
                    onChange={(event) => {
                      setFocusIndex(index);
                      onChange(index, Number(event.target.value));
                    }}
                    style={{ "--eq-gain": `${((gain + 12) / 24) * 100}%` } as CSSProperties}
                  />
                </span>
                <span className="band-label">{formatFrequencyShort(frequency)}</span>
              </label>
            );
          })}
        </div>

        <div className="eq-footer">
          <div className="gain-stack">
            <span className="gain-label">{formatFrequency(EQ_FREQUENCIES[focusIndex])}</span>
            <div className="gain-display">
              <span className="gain-num">{formatGain(focusGain)}</span>
              <span className="gain-unit">dB</span>
            </div>
          </div>
          <button type="button" className="reset-btn" onClick={onReset}>{t("resetEqualizer")}</button>
        </div>
      </div>
    </div>
  );
}
