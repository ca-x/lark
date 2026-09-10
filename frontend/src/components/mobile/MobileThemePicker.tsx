import { isMaterialTheme } from "../player-themes/types";
import { Check } from "@phosphor-icons/react";
import type { MobileHomePlayerStyle } from "../../types";
import type { TKey } from "../../i18n";
import { MobilePlayerArtwork } from "../player-themes/MobilePlayerArtwork";

const themes: { id: MobileHomePlayerStyle; label: TKey }[] = [
  { id: "neon-console", label: "mobileHomePlayerNeonConsole" },
  { id: "soft-vinyl", label: "mobileHomePlayerSoftVinyl" },
  { id: "gramophone", label: "mobileHomePlayerGramophone" },
  { id: "indiewave", label: "mobileHomePlayerIndiewave" },
  { id: "editorial-pulse", label: "mobileHomePlayerEditorialPulse" },
  { id: "stage-glass", label: "mobileHomePlayerStageGlass" },
  { id: "blue-halo", label: "mobileHomePlayerBlueHalo" },
  { id: "smartisan-classic", label: "mobileHomePlayerSmartisanClassic" },
  { id: "moss-wave", label: "mobileHomePlayerMossWave" },
  { id: "deep-sea", label: "mobileHomePlayerDeepSea" },
  { id: "amber-tape", label: "mobileHomePlayerAmberTape" },
  { id: "clear-tape", label: "mobileHomePlayerClearTape" },
];

export function MobileThemePicker({ value, onChange, t }: { value: MobileHomePlayerStyle; onChange: (theme: MobileHomePlayerStyle) => void; t: (key: TKey) => string }) {
  return (
    <div className="mobile-material-picker" role="group" aria-label={t("mobileHomePlayerStyle")}>
      {themes.map(({ id, label }) => (
        <button key={id} type="button" data-theme={id} aria-pressed={value === id} onClick={() => onChange(id)}>
          <span className="mobile-material-preview" aria-hidden="true">
            {isMaterialTheme(id) ? <MobilePlayerArtwork variant={id} preview /> : <span className={`material-classic-preview classic-${id}`}><i /><b /><em /></span>}
          </span>
          <span className="mobile-material-choice-label">{t(label)}{value === id ? <Check aria-hidden="true" weight="bold" /> : null}</span>
        </button>
      ))}
    </div>
  );
}
