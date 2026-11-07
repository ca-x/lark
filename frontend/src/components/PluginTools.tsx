import { useState } from "react";
import type { Plugin } from "../types";
import type { createT } from "../i18n";
import { PluginSurface } from "./PluginSurface";
import type { SongloftHostCall, SongloftPlayerState } from "./PluginHost";

export function PluginTools({ plugins, t, theme, playerState, onHostCall }: { plugins: Plugin[]; t: ReturnType<typeof createT>; theme: "light" | "dark"; playerState: SongloftPlayerState; onHostCall: (call: SongloftHostCall) => Promise<unknown> }) {
  const [selected, setSelected] = useState<number | null>(null);
  const active = plugins.find((plugin) => plugin.id === selected);
  if (active) return <PluginSurface key={`${active.id}:${active.entry_hash}`} plugin={active} t={t} theme={theme} playerState={playerState} onHostCall={onHostCall} onClose={() => setSelected(null)} />;
  return <section className="mygo-catalog mygo-panel" aria-label={t("pluginTools")}><header><div><h3>{t("pluginTools")}</h3><p>{t("pluginToolsHint")}</p></div></header><div className="mygo-cards">{plugins.map((plugin) => <article key={plugin.id}><div className="mygo-plugin-heading"><strong>{plugin.name}</strong><small>{plugin.version}</small></div><p>{plugin.description}</p><button type="button" className="mygo-primary" onClick={() => setSelected(plugin.id)}>{t("openPlugin")}</button></article>)}</div></section>;
}
