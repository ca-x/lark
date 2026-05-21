import { Guitar, MicrophoneStage, MusicNotes, PianoKeys, Power, Sparkle, Waveform, X } from "@phosphor-icons/react";

import type { createT } from "../../i18n";
import { EQ_PRESETS, type EqualizerPresetKey } from "../equalizer";

const presetKeys = Object.keys(EQ_PRESETS) as EqualizerPresetKey[];

function matchingPreset(bands: number[]) {
  return presetKeys.find((key) => EQ_PRESETS[key].every((value, index) => value === (bands[index] ?? 0))) || "";
}

function presetIcon(key: EqualizerPresetKey) {
  switch (key) {
    case "bass":
    case "rock":
      return <Guitar weight="fill" />;
    case "vocal":
      return <MicrophoneStage weight="fill" />;
    case "classical":
      return <PianoKeys weight="fill" />;
    case "electronic":
      return <Waveform weight="bold" />;
    case "jazz":
      return <MusicNotes weight="fill" />;
    case "pop":
      return <Sparkle weight="fill" />;
    case "flat":
    default:
      return <MusicNotes weight="regular" />;
  }
}

export function MobileSoundPanel({
  t,
  enabled,
  bands,
  onToggle,
  onApplyPreset,
  onClose,
}: {
  t: ReturnType<typeof createT>;
  enabled: boolean;
  bands: number[];
  onToggle: () => void;
  onApplyPreset: (bands: number[]) => void;
  onClose: () => void;
}) {
  const activePreset = matchingPreset(bands);

  return (
    <section className="mobile-sound-panel" role="dialog" aria-label={t("mobileSoundEffects")} data-enabled={enabled ? "true" : "false"}>
      <div className="mobile-sound-handle" aria-hidden="true" />
      <header className="mobile-sound-head">
        <button type="button" aria-label={t("close")} onClick={onClose}>
          <X weight="bold" />
        </button>
        <strong>{t("mobileSoundEffects")}</strong>
        <button type="button" className={enabled ? "active" : ""} aria-label={enabled ? t("off") : t("on")} onClick={onToggle}>
          <Power weight="bold" />
        </button>
      </header>
      <div className="mobile-sound-orb" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
      </div>
      <div className="mobile-sound-presets" role="group" aria-label={t("equalizerPresets")}>
        {presetKeys.map((key) => (
          <button
            key={key}
            type="button"
            className={activePreset === key ? "active" : ""}
            aria-label={t(`eqPreset${key[0].toUpperCase()}${key.slice(1)}` as Parameters<typeof t>[0])}
            disabled={!enabled}
            onClick={() => onApplyPreset(EQ_PRESETS[key])}
          >
            {presetIcon(key)}
          </button>
        ))}
      </div>
    </section>
  );
}
