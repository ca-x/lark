import { useEffect, useRef, useState } from "react";
import { CaretRight, PuzzlePiece } from "@phosphor-icons/react";
import type { Plugin } from "../types";
import type { createT } from "../i18n";
import { PluginSurface } from "./PluginSurface";
import type { SongloftHostCall, SongloftPlayerState } from "./PluginHost";

export function PluginTools({ plugins, t, theme, playerState, onHostCall }: { plugins: Plugin[]; t: ReturnType<typeof createT>; theme: "light" | "dark"; playerState: SongloftPlayerState; onHostCall: (call: SongloftHostCall) => Promise<unknown> }) {
  const [selected, setSelected] = useState<number | null>(null);
  const lastOpened = useRef<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const active = plugins.find((plugin) => plugin.id === selected);
  useEffect(() => {
    if (!active && lastOpened.current !== null) {
      list.current?.querySelector<HTMLButtonElement>(`[data-tool-id="${lastOpened.current}"]`)?.focus();
      lastOpened.current = null;
    }
  }, [active]);
  if (active) return <PluginSurface key={`${active.id}:${active.entry_hash}`} plugin={active} t={t} theme={theme} playerState={playerState} onHostCall={onHostCall} onClose={() => setSelected(null)} />;

  return <section className="mygo-catalog mygo-panel" aria-label={t("pluginTools")}>
    <h3>{t("pluginTools")}</h3>
    <div className="plugin-tool-list" ref={list}>
      {plugins.map((plugin) => <button key={plugin.id} type="button" data-tool-id={plugin.id}
        aria-label={`${t("openPlugin")} · ${plugin.name}`}
        onClick={() => { lastOpened.current = plugin.id; setSelected(plugin.id); }}>
        <span className="plugin-tool-icon"><PuzzlePiece weight="duotone" aria-hidden="true" /></span>
        <span className="plugin-tool-copy">
          <strong>{plugin.name}</strong>
          {plugin.description && <small>{plugin.description}</small>}
        </span>
        <span className="plugin-tool-version">{plugin.version}</span>
        <CaretRight aria-hidden="true" />
      </button>)}
    </div>
  </section>;
}
