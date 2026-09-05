import {
  ArrowClockwise,
  ArrowSquareOut,
  ArrowsOut,
  DownloadSimple,
  Plus,
  PuzzlePiece,
  Trash,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Plugin, PluginCapability, PluginRegistry, PluginRegistryEntry } from "../types";
import type { createT } from "../i18n";
import { api } from "../services/api";
import type { SongloftHostCall, SongloftPlayerState } from "./PluginHost";
import { PluginSurface } from "./PluginSurface";

type PluginView = "installed" | "marketplace" | "sources";

const dangerousPermissions = new Set(["command", "fs:external", "fs:music", "net"]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function PluginSettings({
  t,
  theme,
  playerState,
  onHostCall,
  onSurfaceChange,
}: {
  t: ReturnType<typeof createT>;
  theme: "light" | "dark";
  playerState: SongloftPlayerState;
  onHostCall: (call: SongloftHostCall) => Promise<unknown>;
  onSurfaceChange?: (open: boolean) => void;
}) {
  const [view, setView] = useState<PluginView>("installed");
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [capabilities, setCapabilities] = useState<PluginCapability[]>([]);
  const [registries, setRegistries] = useState<PluginRegistry[]>([]);
  const [marketplace, setMarketplace] = useState<PluginRegistryEntry[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketLoading] = useState(false);
  const [savingSources, setSavingSources] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [surfacePlugin, setSurfacePlugin] = useState<Plugin | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const surfaceTriggerRef = useRef<Plugin["id"] | null>(null);

  function closePluginSurface() {
    setSurfacePlugin(null);
    onSurfaceChange?.(false);
    window.requestAnimationFrame(() => {
      const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-plugin-open-id]"))
        .find((button) => button.dataset.pluginOpenId === String(surfaceTriggerRef.current));
      trigger?.focus();
    });
  }

  const refreshInstalled = useCallback(async () => {
    const [pluginResult, capabilityResult] = await Promise.all([
      api.plugins(),
      api.pluginCapabilities(),
    ]);
    setPlugins(pluginResult.plugins || []);
    setCapabilities(capabilityResult.capabilities || []);
  }, []);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    void Promise.all([refreshInstalled(), api.pluginRegistries()])
      .then(([, sourceResult]) => {
        if (!canceled) setRegistries(sourceResult.registries || []);
      })
      .catch((nextError) => {
        if (!canceled) setError(errorMessage(nextError));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [refreshInstalled]);

  const installedByEntryPath = useMemo(
    () => new Map(plugins.map((plugin) => [plugin.entry_path, plugin])),
    [plugins],
  );

  async function runPluginAction(key: string, action: () => Promise<unknown>) {
    if (busyKey) return;
    setBusyKey(key);
    setError("");
    try {
      await action();
      await refreshInstalled();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusyKey("");
    }
  }

  async function loadMarketplace() {
    if (marketLoading) return;
    setMarketLoading(true);
    setError("");
    try {
      const result = await api.pluginMarketplace();
      setMarketplace(result.plugins || []);
      setWarnings(result.warnings || []);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setMarketLoading(false);
    }
  }

  function selectView(nextView: PluginView) {
    setView(nextView);
    if (nextView === "marketplace" && marketplace.length === 0) void loadMarketplace();
  }

  async function uploadPlugin(file: File) {
    await runPluginAction(`upload:${file.name}`, () => api.uploadPlugin(file));
  }

  async function saveSources() {
    if (savingSources) return;
    setSavingSources(true);
    setError("");
    try {
      const result = await api.savePluginRegistries(registries);
      setRegistries(result.registries || []);
      setMarketplace([]);
      setWarnings([]);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setSavingSources(false);
    }
  }

  function updateSource(index: number, patch: Partial<PluginRegistry>) {
    setRegistries((current) => current.map((source, sourceIndex) => (
      sourceIndex === index ? { ...source, ...patch } : source
    )));
  }

  if (surfacePlugin) {
    return (
      <div className="plugin-settings settings-wide-row" data-settings-owner="plugins">
        <PluginSurface
          plugin={surfacePlugin}
          t={t}
          theme={theme}
          playerState={playerState}
          onHostCall={onHostCall}
          onClose={closePluginSurface}
        />
      </div>
    );
  }

  return (
    <div className="plugin-settings settings-wide-row" data-settings-owner="plugins">
      <div className="plugin-settings-head">
        <div>
          <strong>{t("pluginManagement")}</strong>
          <span>{t("pluginManagementHint")}</span>
        </div>
        <button type="button" className="plugin-upload-button" onClick={() => uploadRef.current?.click()} disabled={Boolean(busyKey)}>
          <UploadSimple aria-hidden="true" />
          {t("installPluginPackage")}
        </button>
        <input
          ref={uploadRef}
          className="sr-only"
          type="file"
          aria-label={t("installPluginPackage")}
          accept=".zip,.jsplugin.zip,application/zip"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void uploadPlugin(file);
          }}
        />
      </div>

      <div className="plugin-view-tabs" role="tablist" aria-label={t("pluginManagement")}>
        {([
          ["installed", t("installedPlugins")],
          ["marketplace", t("pluginMarketplace")],
          ["sources", t("pluginSources")],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "active" : ""} onClick={() => selectView(id)}>
            {label}
          </button>
        ))}
      </div>

      {error ? <div className="plugin-feedback error" role="alert">{error}</div> : null}
      {loading ? <div className="settings-empty">{t("loading")}</div> : null}

      {!loading && view === "installed" ? (
        <div className="plugin-installed-view" role="tabpanel">
          <div className="plugin-list">
            {plugins.map((plugin) => {
              const active = plugin.status === "active";
              const pluginBusy = busyKey.endsWith(`:${plugin.id}`);
              const permissions = Array.isArray(plugin.permissions) ? plugin.permissions : [];
              return (
                <div className="plugin-row" key={plugin.id}>
                  <span className="plugin-row-icon"><PuzzlePiece aria-hidden="true" /></span>
                  <div className="plugin-row-copy">
                    <div className="plugin-row-title">
                      <strong>{plugin.name}</strong>
                      <code>{plugin.version}</code>
                      <span className={`plugin-status ${plugin.status}`}>{plugin.status === "error" ? t("error") : active ? t("enabled") : t("disabled")}</span>
                    </div>
                    <span>{plugin.description || plugin.entry_path}</span>
                    <div className="plugin-permissions" aria-label={t("pluginPermissions")}>
                      {permissions.length ? permissions.map((permission) => (
                        <code key={permission} className={dangerousPermissions.has(permission) ? "danger" : ""}>{permission}</code>
                      )) : <small>{t("noPluginPermissions")}</small>}
                    </div>
                  </div>
                  <div className="plugin-row-actions">
                    <label className="plugin-toggle">
                      <span className="sr-only">{active ? t("disablePlugin") : t("enablePlugin")}</span>
                      <input
                        type="checkbox"
                        checked={active}
                        disabled={pluginBusy || Boolean(busyKey)}
                        onChange={(event) => void runPluginAction(`toggle:${plugin.id}`, () => (
                          event.target.checked ? api.enablePlugin(plugin.id) : api.disablePlugin(plugin.id)
                        ))}
                      />
                    </label>
                    <button type="button" className="plugin-icon-button" title={t("reloadPlugin")} aria-label={t("reloadPlugin")} disabled={!active || Boolean(busyKey)} onClick={() => void runPluginAction(`reload:${plugin.id}`, () => api.reloadPlugin(plugin.id))}>
                      <ArrowClockwise aria-hidden="true" />
                    </button>
                    <button type="button" className="plugin-icon-button danger" title={t("deletePlugin")} aria-label={t("deletePlugin")} disabled={Boolean(busyKey)} onClick={() => {
                      if (window.confirm(t("deletePluginConfirm"))) void runPluginAction(`delete:${plugin.id}`, () => api.deletePlugin(plugin.id));
                    }}>
                      <Trash aria-hidden="true" />
                    </button>
                    {active && plugin.has_frontend ? <button type="button" className="plugin-icon-button" data-plugin-open-id={plugin.id} title={t("openPlugin")} aria-label={t("openPlugin")} disabled={Boolean(busyKey)} onClick={() => {
                      surfaceTriggerRef.current = plugin.id;
                      setSurfacePlugin(plugin);
                      onSurfaceChange?.(true);
                    }}>
                      <ArrowsOut aria-hidden="true" />
                    </button> : null}
                  </div>
                </div>
              );
            })}
            {!plugins.length ? <div className="settings-empty">{t("noPluginsInstalled")}</div> : null}
          </div>

          <section className="plugin-capability-section">
            <div className="plugin-section-title">
              <div><strong>{t("pluginHostCapabilities")}</strong><span>{t("pluginHostCapabilitiesHint")}</span></div>
            </div>
            <div className="plugin-capability-list">
              {capabilities.map((capability) => (
                <div className="plugin-capability-row" key={capability.id}>
                  <span className={`plugin-capability-state ${capability.status}`}>{
                    capability.status === "available" ? t("capabilityAvailable") : capability.status === "partial" ? t("capabilityPartial") : t("capabilityUnavailable")
                  }</span>
                  <div><strong>{capability.label}</strong><span>{capability.description}{capability.note ? ` ${capability.note}` : ""}</span></div>
                  {capability.permission ? <code className={dangerousPermissions.has(capability.permission) ? "danger" : ""}>{capability.permission}</code> : null}
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {!loading && view === "marketplace" ? (
        <div className="plugin-marketplace-view" role="tabpanel">
          <div className="plugin-marketplace-toolbar">
            <span>{marketLoading ? t("loading") : t("pluginMarketplaceHint")}</span>
            <button type="button" className="plugin-icon-button" title={t("refresh")} aria-label={t("refresh")} disabled={marketLoading} onClick={() => void loadMarketplace()}>
              <ArrowClockwise aria-hidden="true" />
            </button>
          </div>
          {warnings.map((warning) => <div key={warning} className="plugin-feedback warning"><WarningCircle aria-hidden="true" />{warning}</div>)}
          <div className="plugin-list">
            {marketplace.map((entry) => {
              const installed = installedByEntryPath.get(entry.entry_path);
              const installing = busyKey === `market:${entry.entry_path}`;
              return (
                <div className="plugin-row market" key={`${entry.entry_path}:${entry.version}`}>
                  <span className="plugin-row-icon"><PuzzlePiece aria-hidden="true" /></span>
                  <div className="plugin-row-copy">
                    <div className="plugin-row-title"><strong>{entry.name}</strong><code>{entry.version}</code></div>
                    <span>{entry.description || entry.author || entry.entry_path}</span>
                    {entry.source_names?.length ? <small>{entry.source_names.join(" · ")}</small> : null}
                  </div>
                  <div className="plugin-row-actions">
                    {entry.homepage ? <a className="plugin-icon-button" href={entry.homepage} target="_blank" rel="noreferrer" title={t("openHomepage")} aria-label={t("openHomepage")}><ArrowSquareOut aria-hidden="true" /></a> : null}
                    <button type="button" className="plugin-install-button" disabled={Boolean(busyKey) || (installed?.version === entry.version)} onClick={() => void runPluginAction(`market:${entry.entry_path}`, () => api.installMarketplacePlugin(entry))}>
                      <DownloadSimple aria-hidden="true" />
                      {installing ? t("loading") : installed ? (installed.version === entry.version ? t("installed") : t("updatePlugin")) : t("install")}
                    </button>
                  </div>
                </div>
              );
            })}
            {!marketLoading && !marketplace.length ? <div className="settings-empty">{t("pluginMarketplaceEmpty")}</div> : null}
          </div>
        </div>
      ) : null}

      {!loading && view === "sources" ? (
        <div className="plugin-sources-view" role="tabpanel">
          <div className="plugin-sources-toolbar">
            <span>{t("pluginSourcesHint")}</span>
            <button type="button" onClick={() => setRegistries((current) => [...current, { name: "", url: "", homepage: "", enabled: true }])}>
              <Plus aria-hidden="true" />{t("addPluginSource")}
            </button>
          </div>
          <div className="plugin-source-list">
            {registries.map((source, index) => (
              <div className="plugin-source-row" key={`${index}:${source.url}`}>
                <label><span>{t("name")}</span><input value={source.name} onChange={(event) => updateSource(index, { name: event.target.value })} /></label>
                <label><span>{t("subscriptionAddress")}</span><input type="url" value={source.url} placeholder="https://example.com/registry.json" onChange={(event) => updateSource(index, { url: event.target.value })} /></label>
                <label><span>{t("communityStoreLink")}</span><input type="url" value={source.homepage || ""} placeholder="https://example.com/" onChange={(event) => updateSource(index, { homepage: event.target.value })} /></label>
                <div className="plugin-source-actions">
                  <label className="plugin-source-toggle"><input type="checkbox" checked={source.enabled} onChange={(event) => updateSource(index, { enabled: event.target.checked })} /><span>{source.enabled ? t("enabled") : t("disabled")}</span></label>
                  {source.homepage ? <a className="plugin-icon-button" href={source.homepage} target="_blank" rel="noreferrer" title={t("openHomepage")} aria-label={t("openHomepage")}><ArrowSquareOut aria-hidden="true" /></a> : null}
                  <button type="button" className="plugin-icon-button danger" title={t("deletePluginSource")} aria-label={t("deletePluginSource")} onClick={() => setRegistries((current) => current.filter((_, sourceIndex) => sourceIndex !== index))}><Trash aria-hidden="true" /></button>
                </div>
                {source.last_error ? <div className="plugin-feedback error">{source.last_error}</div> : null}
              </div>
            ))}
            {!registries.length ? <div className="settings-empty">{t("noPluginSources")}</div> : null}
          </div>
          <div className="plugin-source-save-row">
            <span>{t("pluginSourceSaveHint")}</span>
            <button type="button" disabled={savingSources || registries.some((source) => !source.url.trim())} onClick={() => void saveSources()}>{savingSources ? t("loading") : t("save")}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
