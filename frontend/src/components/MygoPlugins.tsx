import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { createT } from "../i18n";
import type { MygoCatalogEntry, MygoPlugin, MygoPreview } from "../features/plugins/mygo";
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

function InstallPreview({ preview, t, busy, onCancel, onInstall }: { preview: MygoPreview; t: Translator; busy: boolean; onCancel: () => void; onInstall: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="mygo-preview" aria-labelledby="mygo-preview-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h3 id="mygo-preview-title">{preview.manifest.name} <small>{preview.manifest.version}</small></h3>
    <p>{t("mygoPreviewHint")}</p>
    <dl><dt>{t("pluginSources")}</dt><dd>{preview.origin}</dd><dt>SHA-256</dt><dd><code>{preview.digest}</code></dd><dt>{t("pluginPermissions")}</dt><dd>{preview.manifest.permissions.network?.join(", ") || t("noPluginPermissions")}</dd></dl>
    <p>{t("mygoPluginHint")}</p>
    <div className="mygo-actions"><button disabled={busy} onClick={onCancel}>{t("cancel")}</button><button disabled={busy} className="mygo-primary" onClick={onInstall}>{busy ? t("loading") : t("mygoConfirmInstall")}</button></div>
  </dialog>;
}

export function MygoPluginManager({ t }: { t: Translator }) {
  const [plugins, setPlugins] = useState<MygoPlugin[]>([]);
  const [catalog, setCatalog] = useState<MygoCatalogEntry[]>([]);
  const [catalogStatus, setCatalogStatus] = useState("");
  const [repository, setRepository] = useState("");
  const [preview, setPreview] = useState<MygoPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  async function refresh() { setPlugins((await api.mygoPlugins()).plugins || []); }
  useEffect(() => { void refresh().catch((error) => setError(String(error))); }, []);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); await refresh(); window.dispatchEvent(new Event("lark:plugins-changed")); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <section className="mygo-panel" aria-label={t("mygoSources")}>
    <header><div><h3>{t("mygoSources")}</h3><p>{t("mygoPluginHint")}</p></div><button disabled={busy} onClick={() => upload.current?.click()}>{t("installPluginPackage")}</button></header>
    <input className="sr-only" ref={upload} type="file" accept=".zip,application/zip" aria-label={t("installPluginPackage")} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(async () => setPreview(await api.mygoUploadPreview(file))); }} />
    <form className="mygo-actions" onSubmit={(event) => { event.preventDefault(); void run(async () => setPreview(await api.mygoPreview(repository))); }}>
      <label className="mygo-repository"><span>{t("mygoRepository")}</span><input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/repo" spellCheck={false} required /></label>
      <button type="submit" disabled={busy || !repository.trim()}>{t("mygoPreview")}</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => { const result = await api.mygoMarketplace(); setCatalog(result.plugins || []); setCatalogStatus(`${t("mygoCatalogUpdated")} ${new Date(result.cache.updated_at).toLocaleString()}${result.cache.truncated ? ` · ${t("mygoCatalogTruncated")}` : ""}`); })}>{t("pluginMarketplace")}</button>
    </form>
    {error && <p className="plugin-feedback error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {busy && <p role="status">{t("loading")}</p>}
    {catalogStatus && <p role="status">{catalogStatus}</p>}
    <div className="mygo-cards">{catalog.map((entry) => <article key={entry.repository}><strong>{entry.name}</strong><small>{entry.repository} · ★ {entry.stars}</small><p>{entry.description}</p><button disabled={busy} onClick={() => void run(async () => setPreview(await api.mygoPreview(entry.repository)))}>{t("mygoPreview")}</button></article>)}</div>
    {!plugins.length && <p className="settings-empty">{t("mygoEmpty")}</p>}
    <div className="mygo-cards">{plugins.map((plugin) => <article key={plugin.manifest.id}>
      <div className="mygo-plugin-heading"><strong>{plugin.manifest.name}</strong><small>{plugin.manifest.version} · {plugin.enabled ? t("enabled") : t("disabled")}</small></div>
      <small className="mygo-origin">{plugin.origin}</small>
      <div className="mygo-actions"><button disabled={busy} onClick={() => void run(() => api.mygoEnable(plugin.manifest.id, !plugin.enabled))}>{plugin.enabled ? t("disablePlugin") : t("enablePlugin")}</button><button disabled={busy} className="icon-danger" onClick={() => { if (window.confirm(`${t("deletePlugin")} ${plugin.manifest.name}?`)) void run(() => api.mygoDelete(plugin.manifest.id)); }}>{t("deletePlugin")}</button></div>
      <MygoSourceSettings key={plugin.identity} plugin={plugin} t={t} />
    </article>)}</div>
    {preview && <InstallPreview preview={preview} t={t} busy={busy} onCancel={() => setPreview(null)} onInstall={() => void run(async () => { await api.mygoInstall(preview.token); setPreview(null); setNotice(t("installed")); })} />}
  </section>;
}
