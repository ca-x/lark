import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { createT } from "../i18n";
import type { MygoCatalogEntry, MygoPlugin, MygoPreview } from "../features/plugins/mygo";
import { mygoErrorMessage, mygoRepositoryFromOrigin } from "../features/plugins/mygo";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import "./MygoPlugins.css";

type Translator = ReturnType<typeof createT>;

export function MygoSourceSettings({ plugin, t }: { plugin: MygoPlugin; t: Translator }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    let alive = true;
    void api.mygoSettings(plugin.manifest.id, plugin.identity).then((next) => { if (alive) setValues(next); }).catch((error) => { if (alive) setFeedback(String(error)); });
    return () => { alive = false; };
  }, [plugin.manifest.id, plugin.identity]);
  if (!plugin.manifest.settings?.length) return null;
  return <details className="mygo-source-settings"><summary>{t("mygoUserSettings")}</summary>
    <form onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setFeedback("");
      void api.saveMygoSettings(plugin.manifest.id, values, plugin.identity).then(() => setFeedback(t("done"))).catch((error) => setFeedback(String(error))).finally(() => setBusy(false));
    }}>
      {plugin.manifest.settings.map((setting) => <label key={setting.key}>
        <span>{setting.label || setting.key}</span>
        <input type={/token|password|secret|cookie|key/i.test(setting.key) ? "password" : "text"} autoComplete="off" value={values[setting.key] || ""} onChange={(event) => setValues((current) => ({ ...current, [setting.key]: event.target.value }))} />
        {setting.help && <small>{setting.help}</small>}
        {setting.link && /^https?:\/\//.test(setting.link) && <a href={setting.link} target="_blank" rel="noreferrer">{t("openHomepage")}</a>}
      </label>)}
      <button disabled={busy} type="submit">{busy ? t("loading") : t("save")}</button>
      <span role="status">{feedback}</span>
    </form>
  </details>;
}

function InstallPreview({ preview, t, busy, error, onCancel, onInstall }: { preview: MygoPreview; t: Translator; busy: boolean; error: string; onCancel: () => void; onInstall: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="mygo-preview" aria-labelledby="mygo-preview-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h3 id="mygo-preview-title">{preview.manifest.name} <small>{preview.manifest.version}</small></h3>
    <p>{t("mygoPreviewHint")}</p>
    <dl><dt>{t("pluginSources")}</dt><dd>{preview.origin}</dd><dt>SHA-256</dt><dd><code>{preview.digest}</code></dd><dt>{t("pluginPermissions")}</dt><dd>{preview.manifest.permissions.network?.join(", ") || t("noPluginPermissions")}</dd></dl>
    <p>{t("mygoPluginHint")}</p>
    {error && <p className="plugin-feedback error" role="alert">{error}</p>}
    <div className="mygo-actions"><button disabled={busy} onClick={onCancel}>{t("cancel")}</button><button disabled={busy} className="mygo-primary" onClick={onInstall}>{busy ? t("loading") : t("mygoConfirmInstall")}</button></div>
  </dialog>;
}

export function MygoPluginManager({ t }: { t: Translator }) {
  const [plugins, setPlugins] = useState<MygoPlugin[]>([]);
  const [catalog, setCatalog] = useState<MygoCatalogEntry[]>([]);
  const [catalogStatus, setCatalogStatus] = useState("");
  const [tab, setTab] = useState<"marketplace" | "installed">("marketplace");
  const [query, setQuery] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRequest, setCatalogRequest] = useState(0);
  const [pendingRepository, setPendingRepository] = useState("");
  const [deleting, setDeleting] = useState<MygoPlugin | null>(null);
  const [repository, setRepository] = useState("");
  const [preview, setPreview] = useState<MygoPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const actionInFlight = useRef(false);
  async function refresh() { setPlugins((await api.mygoPlugins()).plugins || []); }
  useEffect(() => { void refresh().catch((error) => setError(String(error))); }, []);
  useEffect(() => {
    let alive = true;
    void api.mygoMarketplace().then((result) => {
      if (!alive) return;
      setCatalog(result.plugins || []);
      setCatalogStatus(`${t("mygoCatalogUpdated")} ${new Date(result.cache.updated_at).toLocaleString()}${result.cache.truncated ? ` · ${t("mygoCatalogTruncated")}` : ""}`);
    }).catch((error) => { if (alive) setCatalogError(mygoErrorMessage(error)); }).finally(() => { if (alive) setCatalogLoading(false); });
    return () => { alive = false; };
  }, [catalogRequest]);
  async function run(action: () => Promise<unknown>) {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setBusy(true); setError(""); setNotice("");
    try { await action(); window.dispatchEvent(new Event("lark:plugins-changed")); await refresh(); return true; }
    catch (error) { setError(mygoErrorMessage(error)); return false; }
    finally { actionInFlight.current = false; setBusy(false); setPendingRepository(""); }
  }
  const visibleCatalog = catalog.filter((entry) => `${entry.name} ${entry.repository} ${entry.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectTab = (next: typeof tab) => { setTab(next); setError(""); };
  const startInstall = (address: string) => void run(async () => { setPendingRepository(address); setPreview(await api.mygoPreview(address)); });
  const tabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "marketplace" : event.key === "End" ? "installed" : tab === "marketplace" ? "installed" : "marketplace";
    selectTab(next);
    document.getElementById(`mygo-tab-${next}`)?.focus();
  };
  return <section className="mygo-panel" aria-label={t("mygoSources")}>
    <header><div><h3>{t("mygoSources")}</h3><p>{t("mygoMarketplaceHint")}</p></div></header>
    <div className="mygo-manager-tabs" role="tablist" aria-label={t("mygoSources")}>
      {(["marketplace", "installed"] as const).map((value) => <button key={value} id={`mygo-tab-${value}`} role="tab" aria-controls={`mygo-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onKeyDown={tabKeyDown} onClick={() => selectTab(value)}>{t(value === "marketplace" ? "pluginMarketplace" : "installedPlugins")}{value === "installed" ? ` · ${plugins.length}` : ""}</button>)}
    </div>
    <input className="sr-only" ref={upload} type="file" accept=".zip,application/zip" aria-label={t("installPluginPackage")} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(async () => setPreview(await api.mygoUploadPreview(file))); }} />
    <details className="mygo-manual-install"><summary>{t("mygoManualInstall")}</summary>
      <form className="mygo-actions" onSubmit={(event) => { event.preventDefault(); startInstall(repository.trim()); }}>
        <label className="mygo-repository"><span>{t("mygoRepository")}</span><input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/repo" spellCheck={false} required /></label>
        <button type="submit" disabled={busy || !repository.trim()}>{t("install")}</button>
        <button type="button" disabled={busy} onClick={() => upload.current?.click()}>{t("installPluginPackage")}</button>
      </form>
    </details>
    {error && !preview && !deleting && <p className="plugin-feedback error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {busy && !preview && !deleting && <p role="status">{t("mygoCheckingPackage")}</p>}
    <div id="mygo-panel-marketplace" role="tabpanel" aria-labelledby="mygo-tab-marketplace" hidden={tab !== "marketplace"} className="mygo-manager-panel">
      <div className="mygo-actions"><label><span className="sr-only">{t("mygoMarketplaceSearch")}</span><input type="search" value={query} placeholder={t("mygoMarketplaceSearch")} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" disabled={catalogLoading} onClick={() => { setCatalogLoading(true); setCatalogError(""); setCatalogRequest((value) => value + 1); }}>{t("mygoRefreshMarket")}</button></div>
      {catalogLoading && <p role="status">{t("loading")}</p>}
      {catalogError && <p className="plugin-feedback error" role="alert">{catalogError}</p>}
      {catalogStatus && <small>{catalogStatus}</small>}
      {!catalogLoading && !catalogError && !visibleCatalog.length && <p className="settings-empty">{t(query.trim() ? "mygoNoSearchResults" : "mygoMarketplaceEmpty")}</p>}
      <div className="mygo-cards">{visibleCatalog.map((entry) => {
        const installed = plugins.find((plugin) => mygoRepositoryFromOrigin(plugin.origin) === entry.repository.toLowerCase());
        return <article key={entry.repository}>
          <div className="mygo-plugin-heading"><strong>{entry.name}</strong>{installed && <span className="mygo-installed-badge">{t("installed")}</span>}</div>
          <small>{entry.repository} · ★ {entry.stars}</small><p>{entry.description}</p>
          {installed ? <button type="button" onClick={() => selectTab("installed")}>{t("mygoManageInstalled")}</button> : <button type="button" className="mygo-primary" disabled={busy} onClick={() => startInstall(entry.repository)}>{busy && pendingRepository === entry.repository ? t("mygoCheckingPackage") : t("install")}</button>}
        </article>;
      })}</div>
    </div>
    <div id="mygo-panel-installed" role="tabpanel" aria-labelledby="mygo-tab-installed" hidden={tab !== "installed"} className="mygo-manager-panel">
    {!plugins.length && <p className="settings-empty">{t("mygoInstalledEmpty")}</p>}
    <div className="mygo-cards">{plugins.map((plugin) => <article key={`${plugin.manifest.id}:${plugin.identity}`}>
      <div className="mygo-plugin-heading"><strong>{plugin.manifest.name}</strong><small>{plugin.manifest.version} · {plugin.enabled ? t("enabled") : t("disabled")}</small></div>
      <small className="mygo-origin">{plugin.origin}</small>
      <div className="mygo-actions"><button disabled={busy} onClick={() => void run(() => api.mygoEnable(plugin.manifest.id, !plugin.enabled))}>{plugin.enabled ? t("disablePlugin") : t("enablePlugin")}</button><button disabled={busy} className="icon-danger" onClick={() => { setError(""); setDeleting(plugin); }}>{t("deletePlugin")}</button></div>
      <MygoSourceSettings key={plugin.identity} plugin={plugin} t={t} />
    </article>)}</div>
    </div>
    {preview && <InstallPreview key={preview.token} preview={preview} t={t} busy={busy} error={error} onCancel={() => { setPreview(null); setError(""); }} onInstall={() => void run(async () => { const installed = await api.mygoInstall(preview.token); setPlugins((current) => [...current.filter((plugin) => plugin.manifest.id !== installed.manifest.id), installed]); setPreview(null); setTab("installed"); setNotice(t("mygoInstalledHint")); })} />}
    {deleting && <ConfirmActionDialog title={`${t("deletePlugin")} · ${deleting.manifest.name}`} message={t("deletePluginConfirm")} cancelLabel={t("cancel")} confirmLabel={busy ? t("loading") : t("deletePlugin")} busy={busy} error={error} onCancel={() => { setDeleting(null); setError(""); }} onConfirm={() => void run(async () => { await api.mygoDelete(deleting.manifest.id); setPlugins((current) => current.filter((plugin) => plugin.manifest.id !== deleting.manifest.id)); setDeleting(null); })} />}
  </section>;
}
