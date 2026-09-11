import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { Power, X, ArrowCounterClockwise, SlidersHorizontal } from "@phosphor-icons/react";
import type { createT } from "../i18n";
import { useDialogLifecycle } from "../hooks/useDialogLifecycle";
import { EQ_FREQUENCIES, EQ_PRESETS, type EqualizerPresetKey } from "./equalizer";

import { eqCurvePath } from "./equalizerCurve";

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
  const dialogRef = useDialogLifecycle<HTMLDivElement>(onClose);
  const [focusIndex, setFocusIndex] = useState(4);
  const activePreset = matchingPreset(bands);
  const curve = useMemo(() => eqCurvePath(bands), [bands]);
  const focusGain = bands[focusIndex] ?? 0;
  return (
    <div ref={dialogRef} className="eq-popover eq-shell" data-enabled={enabled ? "true" : "false"} role="dialog" aria-modal="true" aria-label={t("equalizer")}>
      <div className="eq-card">
        <div className="eq-topbar">
          <div className="eq-heading"><SlidersHorizontal aria-hidden="true" /><div><span className="eq-title">{t("equalizer")}</span><span className="eq-subtitle">{t("equalizerBands")}</span></div></div>
          <div className="eq-top-actions">
            <button type="button" className={enabled ? "eq-power on" : "eq-power"} aria-label={t("equalizer")} aria-pressed={enabled} title={enabled ? t("off") : t("on")} onClick={onToggle}>
              <Power weight="bold" />
            </button>
            <button type="button" className="eq-close" data-autofocus aria-label={t("close")} onClick={onClose}><X /></button>
          </div>
        </div>

        <div className="eq-presets" role="group" aria-label={t("equalizerPresets")}>
          {presetKeys.map((key) => (
            <button
              key={key}
              type="button"
              className={activePreset === key ? "active" : ""}
              aria-pressed={activePreset === key}
              disabled={!enabled}
              onClick={() => onApplyPreset(EQ_PRESETS[key])}
            >
              {t(`eqPreset${key[0].toUpperCase()}${key.slice(1)}` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>

        <div className="eq-response">
          <div className="eq-response-heading"><span>{t("equalizerGainCurve")}</span><span>{!enabled ? t("off") : activePreset ? t(`eqPreset${activePreset[0].toUpperCase()}${activePreset.slice(1)}` as Parameters<typeof t>[0]) : t("equalizerCustom")}</span></div>
          <div className="eq-viz" aria-hidden="true">
            <div className="eq-db-scale"><span>+12</span><span>0 dB</span><span>−12</span></div>
            <svg className="curve-canvas" viewBox="0 0 560 80" preserveAspectRatio="none">
              {[8, 40, 72].map(y => <line key={y} className={y === 40 ? "eq-zero-line" : "eq-grid-line"} x1="0" x2="560" y1={y} y2={y} />)}
              {EQ_FREQUENCIES.map((frequency, index) => <line key={frequency} className="eq-grid-line" x1={index * 560 / 9} x2={index * 560 / 9} y1="8" y2="72" />)}
              <path className="eq-fill" d={`${curve} L560,40 L0,40 Z`} />
              <path className="eq-curve" d={curve} />
              {EQ_FREQUENCIES.map((frequency, index) => <circle key={frequency} className={focusIndex === index ? "eq-control-point selected" : "eq-control-point"} cx={index * 560 / 9} cy={40 - (bands[index] ?? 0) / 12 * 32} r={focusIndex === index ? 3.5 : 2} />)}
            </svg>
          </div>
        </div>

        <div className="eq-vertical-bands">
          {EQ_FREQUENCIES.map((frequency, index) => {
            const gain = bands[index] ?? 0;
            return (
              <label key={frequency} className="eq-band" data-focused={focusIndex === index}>
                <span className={gain ? "band-val active-val" : "band-val"}>{formatGain(gain)}</span>
                <span className="slider-wrap"><span className="eq-fader-track" aria-hidden="true" /><span className="eq-fader-zero" aria-hidden="true" />
                  <input
                    type="range"
                    className="vslider"
                    aria-label={`${formatFrequency(frequency)} ${t("equalizerBandGain")}`}
                    aria-valuetext={`${formatGain(gain)} dB`}
                    aria-orientation="vertical"
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
          <span className="eq-bypass-state">{enabled ? t("equalizerEnabled") : t("equalizerBypassed")}</span>
          <button type="button" className="reset-btn" onClick={onReset}><ArrowCounterClockwise aria-hidden="true" />{t("resetEqualizer")}</button>
        </div>
      </div>
    </div>
  );
}
