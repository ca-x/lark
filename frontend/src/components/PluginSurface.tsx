import { ArrowSquareOut, X } from "@phosphor-icons/react";
import type { Plugin } from "../types";
import type { createT } from "../i18n";
import { PluginHost, type SongloftHostCall, type SongloftPlayerState } from "./PluginHost";

type PluginSurfaceProps = {
  plugin: Plugin;
  t: ReturnType<typeof createT>;
  theme: "light" | "dark";
  playerState: SongloftPlayerState;
  onHostCall: (call: SongloftHostCall) => Promise<unknown>;
  onClose: () => void;
};

export function PluginSurface({ plugin, t, theme, playerState, onHostCall, onClose }: PluginSurfaceProps) {
  const src = `/api/v1/jsplugin/${encodeURIComponent(plugin.entry_path)}/static/index.html?embed=1&theme=${theme}`;
  const webfFallback = plugin.render_engine === "webf";

  return (
    <section className="plugin-surface" aria-label={plugin.name}>
      <header className="plugin-surface-head">
        <div className="plugin-surface-title">
          <strong>{plugin.name}</strong>
          <code>{plugin.version}</code>
          {webfFallback ? <code className="plugin-render-engine">WebF → Web</code> : null}
          <span>{t("pluginSurfaceHint")}</span>
        </div>
        <div className="plugin-surface-actions">
          <a
            className="plugin-icon-button"
            href={src}
            target="_blank"
            rel="noreferrer"
            title={t("openPluginInNewWindow")}
            aria-label={t("openPluginInNewWindow")}
          >
            <ArrowSquareOut aria-hidden="true" />
          </a>
          <button
            type="button"
            className="plugin-icon-button"
            title={t("closePlugin")}
            aria-label={t("closePlugin")}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="plugin-surface-frame">
        <PluginHost
          src={src}
          title={plugin.name}
          theme={theme}
          playerState={playerState}
          onHostCall={onHostCall}
          loadingLabel={t("pluginLoading")}
          errorLabel={t("pluginLoadFailed")}
          retryLabel={t("retry")}
        />
      </div>
    </section>
  );
}
