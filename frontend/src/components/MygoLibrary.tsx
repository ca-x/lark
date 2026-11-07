import { Heart, Play, Plus } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { createT } from "../i18n";
import type { Song } from "../types";
import { api } from "../services/api";
import { appendMygoPage, mygoPageTracks, mygoImageURL, mygoSong, normalizeMygoPage, notifyMygoLike, type MygoLike, type MygoEntity, type MygoPage, type MygoPlugin, type MygoTrack } from "../features/plugins/mygo";
import { MygoSourceSettings } from "./MygoPlugins";
import { mygoErrorMessage } from "../features/plugins/mygo";
import { MygoSignInPrompt } from "./MygoSignInPrompt";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { pluginNavigation } from "../features/plugins/navigation";

export function MygoLibrary({ t, onPlay }: { t: ReturnType<typeof createT>; onPlay: (song: Song, list: Song[]) => void | Promise<void> }) {
  const [plugins, setPlugins] = useState<MygoPlugin[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let sequence = 0;
    const refresh = () => { const request = ++sequence; void Promise.all([api.pluginPlatform(), api.mygoPlugins()]).then(([platform, result]) => { if (alive && request === sequence) { setEnabled(platform.mygo); setPlugins(pluginNavigation(platform, result.plugins || [], [], false).sources); setError(""); } }).catch((error) => { if (alive && request === sequence) setError(mygoErrorMessage(error)); }); };
    refresh(); window.addEventListener("lark:plugins-changed", refresh);
    return () => { alive = false; window.removeEventListener("lark:plugins-changed", refresh); };
  }, []);
  const active = plugins.find((plugin) => plugin.manifest.id === selected) || plugins[0];
  if (!enabled && !error) return <section className="mygo-panel"><h3>{t("mygoSources")}</h3><p role="status">{t("mygoSourcesDisabled")}</p></section>;
  if (error || !active) return <section className="mygo-panel"><h3>{t("mygoSources")}</h3><p role={error ? "alert" : "status"}>{error || t("mygoEmpty")}</p></section>;
  return <MygoSourceBrowser key={`${active.manifest.id}:${active.identity}`} active={active} plugins={plugins} onSelect={setSelected} t={t} onPlay={onPlay} />;
}

function MygoSourceBrowser({ active, plugins, onSelect, t, onPlay }: { active: MygoPlugin; plugins: MygoPlugin[]; onSelect: (id: string) => void; t: ReturnType<typeof createT>; onPlay: (song: Song, list: Song[]) => void | Promise<void> }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<MygoPage>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [playlists, setPlaylists] = useState<MygoEntity[]>([]);
  const [target, setTarget] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [openedPlaylist, setOpenedPlaylist] = useState("");
  const [prompt, setPrompt] = useState<{ text?: string; qr?: string } | null>(null);
  const [deletingPlaylist, setDeletingPlaylist] = useState("");
  const signInRequest = useRef<AbortController | null>(null);
  const request = useRef<{ method: string; params: Record<string, unknown>; offset: number }>({ method: "home", params: {}, offset: 0 });
  const source = active.manifest.id;
  const can = (method: string) => active.exports.includes(method);
  const call = <T = MygoPage,>(method: string, params: unknown = {}, signal?: AbortSignal) => api.mygoCall<T>(source, method, params, active.identity, signal);
  useEffect(() => () => signInRequest.current?.abort(), []);

  useEffect(() => {
    const receive = (event: Event) => {
      const value = (event as CustomEvent<MygoLike>).detail;
      if (value.plugin === source && value.identity === active.identity) setLiked((old) => ({ ...old, [value.track]: value.on }));
    };
    window.addEventListener("lark:mygo-like", receive);
    return () => window.removeEventListener("lark:mygo-like", receive);
  }, [source, active.identity]);

  async function run(action: () => Promise<unknown>) {
    if (busy || !source) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (error) { setError(mygoErrorMessage(error)); }
    finally { setBusy(false); }
  }

  async function load(method: string, params: Record<string, unknown> = {}, append = false) {
    await run(async () => {
      const value = await call<MygoPage | MygoEntity[]>(method, params);
      const result = normalizeMygoPage(method, value);
      const items = [...mygoPageTracks(result), ...(result.sections || []).flatMap(mygoPageTracks)];
      if (can("isLiked") && items.length) {
        const flags = await call<Record<string, boolean>>("isLiked", { ids: items.map((track) => track.id) });
        setLiked((old) => ({ ...old, ...flags }));
      } else if (method === "liked") setLiked((old) => ({ ...old, ...Object.fromEntries(items.map((track) => [track.id, true])) }));
      const count = mygoPageTracks(result).length + (result.albums?.length || 0) + (result.artists?.length || 0) + (result.playlists?.length || 0) + (result.shows?.length || 0) + (result.stations?.length || 0);
      request.current = { method, params, offset: Number(params.offset || 0) + count };
      setPage((old) => append ? appendMygoPage(old, result) : result);
      setOpenedPlaylist(method === "playlist" ? String(params.id) : "");
      if (method === "playlists") { setPlaylists(result.playlists || []); setTarget((current) => current || result.playlists?.[0]?.id || ""); }
    });
  }

  async function signIn() {
    await run(async () => {
      const controller = new AbortController();
      signInRequest.current = controller;
      setPrompt({ text: t("loading") });
      let polling = false;
      const timer = window.setInterval(() => {
        if (polling || controller.signal.aborted) return;
        polling = true;
        void api.mygoPrompt(source, active.identity).then((value) => { if (!controller.signal.aborted) setPrompt(value || { text: t("loading") }); }).catch(() => undefined).finally(() => { polling = false; });
      }, 1000);
      try { const account = await call<{ name?: string }>("signIn", {}, controller.signal); setNotice(account?.name || t("done")); }
      catch (error) { if (!controller.signal.aborted) throw error; }
      finally { window.clearInterval(timer); signInRequest.current = null; setPrompt(null); }
    });
  }

  async function like(track: MygoTrack) {
    const next = !(liked[track.id] ?? track.liked ?? false);
    await run(async () => { await call("like", { id: track.id, on: next }); notifyMygoLike({ plugin: source, identity: active.identity, track: track.id, on: next }); setNotice(t("done")); });
  }

  const allTracks = [...mygoPageTracks(page), ...(page.sections || []).flatMap(mygoPageTracks)].filter((track) => !track.unavailable);
  function tracks(items: MygoTrack[]) {
    return <ul className="mygo-tracks">{items.map((track, index) => <li key={`${track.id}:${index}`}>
      {track.album?.imageUrl ? <img src={mygoImageURL(source, track.album.imageUrl, active.identity)} alt="" loading="lazy" /> : <span aria-hidden="true">♪</span>}
      <div className="mygo-track-title"><strong>{track.name}</strong><small>{track.artists?.map((artist) => artist.name).join(" / ")} · {Math.floor((track.duration || 0) / 60000)}:{String(Math.floor((track.duration || 0) / 1000) % 60).padStart(2, "0")}</small></div>
      <div className="mygo-track-actions">
        <button disabled={busy || track.unavailable} aria-label={`${t("play")} ${track.name}`} onClick={() => void run(async () => { const songs = allTracks.map((item) => mygoSong(source, { ...item, liked: liked[item.id] ?? item.liked }, active.identity)); const song = songs.find((item) => item.mygo?.track === track.id); if (song) await onPlay(song, songs); })}><Play aria-hidden="true" /></button>
        <button disabled={busy || !can("like")} title={!can("like") ? t("mygoUnavailable") : undefined} aria-label={(liked[track.id] ?? track.liked) ? t("mygoUnfavorite") : t("mygoFavorite")} aria-pressed={liked[track.id] ?? track.liked ?? false} onClick={() => void like(track)}><Heart weight={(liked[track.id] ?? track.liked) ? "fill" : "regular"} aria-hidden="true" /></button>
        {can("addToPlaylist") && <button disabled={busy || !target} title={t("mygoPlaylistTarget")} aria-label={t("addToPlaylist")} onClick={() => void run(async () => { await call("addToPlaylist", { id: target, trackIds: [track.id] }); setNotice(t("done")); })}><Plus aria-hidden="true" /></button>}
        {openedPlaylist && can("removeFromPlaylist") && <button disabled={busy} onClick={() => void run(async () => { await call("removeFromPlaylist", { id: openedPlaylist, trackIds: [track.id] }); setPage((old) => ({ ...old, tracks: old.tracks?.filter((item) => item.id !== track.id) })); setNotice(t("done")); })}>{t("mygoRemoveTrack")}</button>}
      </div>
    </li>)}</ul>;
  }

  function entities(value: MygoPage) {
    return <div className="mygo-cards">{(["playlists", "albums", "artists", "shows", "stations"] as const).flatMap((kind) => (value[kind] || []).map((entity) => <button className="mygo-collection-button" disabled={busy} key={`${kind}:${entity.id}`} onClick={() => void load(kind === "playlists" ? "playlist" : kind === "albums" ? "album" : kind === "artists" ? "artist" : kind === "stations" ? "stationNext" : "show", { id: entity.id, offset: 0 })}>{entity.name}</button>))}</div>;
  }

  return <section className="mygo-panel" aria-label={t("mygoSources")}>
    <header><div><h3>{t("mygoSources")}</h3><p>{t("mygoBrowseHint")}</p></div></header>
    {error && <p role="alert" className="plugin-feedback error">{error}</p>}
    {!active ? <p>{t("mygoEmpty")}</p> : <>
      <label className="mygo-repository"><span>{t("mygoSources")}</span><select value={source} disabled={busy} onChange={(event) => onSelect(event.target.value)}>
        {plugins.map((plugin) => <option key={plugin.manifest.id} value={plugin.manifest.id}>{plugin.manifest.name}</option>)}
      </select></label>
      <MygoSourceSettings key={source} plugin={active} t={t} />
      <nav className="mygo-source-tabs" aria-label={t("mygoSources")}>
        {can("home") && <button disabled={busy} onClick={() => void load("home")}>{t("mygoHome")}</button>}
        {can("liked") && <button disabled={busy} onClick={() => void load("liked", { offset: 0 })}>{t("mygoLiked")}</button>}
        {can("playlists") && <button disabled={busy} onClick={() => void load("playlists")}>{t("mygoLoadPlaylists")}</button>}
        {(active.manifest.navigation || []).filter((nav) => nav.page && can("browse")).map((nav) => <button key={nav.page} disabled={busy} onClick={() => void load("browse", { page: nav.page })}>{nav.title}</button>)}
        {(active.manifest.navigation || []).filter((nav) => nav.builtin && !["home", "liked", "playlists"].includes(nav.builtin) && can(nav.builtin)).map((nav) => <button key={nav.builtin} disabled={busy} onClick={() => void load(nav.builtin!, { offset: 0 })}>{nav.title || nav.builtin}</button>)}
        {can("signIn") && <button disabled={busy} onClick={() => void signIn()}>{t("mygoSignIn")}</button>}
        {can("signOut") && <button disabled={busy} onClick={() => void run(async () => { await call("signOut"); setNotice(t("done")); })}>{t("mygoSignOut")}</button>}
      </nav>
      {can("search") && <form className="mygo-actions" onSubmit={(event) => { event.preventDefault(); void load("search", { query, kind: "tracks", offset: 0 }); }}><label><span className="sr-only">{t("search")}</span><input value={query} placeholder={t("search")} onChange={(event) => setQuery(event.target.value)} /></label><button disabled={busy || !query.trim()}>{t("search")}</button></form>}
      {can("createPlaylist") && <form className="mygo-actions" onSubmit={(event) => { event.preventDefault(); void run(async () => { const playlist = await call<MygoEntity>("createPlaylist", { name: playlistName }); setPlaylists((old) => [...old, playlist]); setTarget(playlist.id); setPlaylistName(""); setNotice(t("done")); }); }}><label><span className="sr-only">{t("mygoPlaylistName")}</span><input placeholder={t("mygoPlaylistName")} value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} /></label><button disabled={busy || !playlistName.trim()}>{t("mygoCreatePlaylist")}</button></form>}
      {playlists.length > 0 && <div className="mygo-actions"><label><span>{t("mygoPlaylistTarget")}</span><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="" disabled>{t("mygoPlaylistTarget")}</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select></label>
        {can("renamePlaylist") && <button disabled={busy || !target || !playlistName.trim()} onClick={() => void run(async () => { await call("renamePlaylist", { id: target, name: playlistName }); setPlaylists((old) => old.map((playlist) => playlist.id === target ? { ...playlist, name: playlistName } : playlist)); setNotice(t("done")); })}>{t("mygoRenamePlaylist")}</button>}
        {can("deletePlaylist") && <button disabled={busy || !target} onClick={() => { setError(""); setDeletingPlaylist(target); }}>{t("mygoDeletePlaylist")}</button>}
      </div>}
      {busy && <p role="status">{t("loading")}</p>}{notice && <p role="status">{notice}</p>}
      {prompt && <MygoSignInPrompt prompt={prompt} t={t} onCancel={() => signInRequest.current?.abort()} />}
      {deletingPlaylist && <ConfirmActionDialog title={t("mygoDeletePlaylist")} message={playlists.find((playlist) => playlist.id === deletingPlaylist)?.name || deletingPlaylist} cancelLabel={t("cancel")} confirmLabel={busy ? t("loading") : t("mygoDeletePlaylist")} busy={busy} error={error} onCancel={() => { setDeletingPlaylist(""); setError(""); }} onConfirm={() => void run(async () => { await call("deletePlaylist", { id: deletingPlaylist }); setPlaylists((old) => old.filter((playlist) => playlist.id !== deletingPlaylist)); setTarget(""); setDeletingPlaylist(""); setNotice(t("done")); })} />}
      {page.title && <h4>{page.title}</h4>}{tracks(mygoPageTracks(page))}{entities(page)}
      {(page.links || []).map((link) => <button key={link.page} disabled={busy} onClick={() => void load("browse", { page: link.page })}>{link.title}</button>)}
      {(page.sections || []).map((section, index) => <section key={index}><h4>{section.title}</h4>{tracks(mygoPageTracks(section))}{entities(section)}{(section.links || []).map((link) => <button key={link.page} disabled={busy} onClick={() => void load("browse", { page: link.page })}>{link.title}</button>)}{section.morePage && <button disabled={busy} onClick={() => void load("browse", { page: section.morePage })}>{t("nextPage")}</button>}</section>)}
      {page.more && <button disabled={busy} onClick={() => void load(request.current.method, { ...request.current.params, offset: request.current.offset }, true)}>{t("nextPage")}</button>}
    </>}
  </section>;
}
