import type { CSSProperties } from "react";
import { Guitar, MicrophoneStage, MusicNotes, PianoKeys, Power, Sparkle, Waveform, X } from "@phosphor-icons/react";

import type { createT } from "../../i18n";
import { useDialogLifecycle } from "../../hooks/useDialogLifecycle";
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
  const dialogRef = useDialogLifecycle<HTMLElement>(onClose);

  return (
    <section
      ref={dialogRef}
      className="mobile-sound-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-sound-title"
      data-enabled={enabled ? "true" : "false"}
    >
      <div className="mobile-sound-handle" aria-hidden="true" />
      <header className="mobile-sound-head">
        <button type="button" data-autofocus aria-label={t("close")} onClick={onClose}>
          <X weight="bold" />
        </button>
        <strong id="mobile-sound-title">{t("mobileSoundEffects")}</strong>
        <button type="button" className={enabled ? "active" : ""} aria-label={enabled ? t("off") : t("on")} onClick={onToggle}>
          <Power weight="bold" />
        </button>
      </header>
      <div className="mobile-sound-meter" aria-hidden="true">
        {bands.map((value, index) => (
          <i key={index} style={{ "--band-level": `${Math.max(0.18, Math.min(1, (value + 12) / 24))}` } as CSSProperties} />
        ))}
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
