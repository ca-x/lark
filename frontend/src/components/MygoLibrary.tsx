import { Check, Heart, MusicNotes, Play, Plus } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { createT } from "../i18n";
import type { Song } from "../types";
import { api } from "../services/api";
import { appendMygoPage, mygoPageTracks, mygoImageURL, mygoSong, normalizeMygoPage, notifyMygoLike, type MygoAccount, type MygoLike, type MygoEntity, type MygoPage, type MygoPlugin, type MygoTrack } from "../features/plugins/mygo";
import { MygoSourceSettings } from "./MygoPlugins";
import { mygoErrorMessage } from "../features/plugins/mygo";
import { MygoSignInPrompt } from "./MygoSignInPrompt";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { pluginNavigation } from "../features/plugins/navigation";

export function MygoLibrary({ t, onPlay, initialSourceId = "" }: { t: ReturnType<typeof createT>; onPlay: (song: Song, list: Song[]) => void | Promise<void>; initialSourceId?: string }) {
  const [plugins, setPlugins] = useState<MygoPlugin[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState(initialSourceId);
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
  return <section className="mygo-panel mygo-library" aria-label={t("mygoSources")}>
    <header className="mygo-library-heading"><div><h3>{t("mygoSources")}</h3><p>{t("mygoBrowseHint")}</p></div></header>
    <nav className="mygo-source-picker" aria-label={t("mygoSources")}>
      {plugins.map((plugin) => <button type="button" key={plugin.manifest.id} data-source={plugin.manifest.id} aria-current={plugin.manifest.id === active.manifest.id ? "true" : undefined} onClick={() => setSelected(plugin.manifest.id)}>
        <MusicNotes aria-hidden="true" /><span>{plugin.manifest.name}</span>{plugin.manifest.id === active.manifest.id && <Check className="mygo-source-check" aria-hidden="true" />}
      </button>)}
    </nav>
    <MygoSourceBrowser key={`${active.manifest.id}:${active.identity}`} active={active} t={t} onPlay={onPlay} />
  </section>;
}

function MygoArtwork({ src, className = "" }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className={`mygo-artwork ${className}`} aria-hidden="true">
    {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <MusicNotes />}
  </span>;
}

function MygoSourceBrowser({ active, t, onPlay }: { active: MygoPlugin; t: ReturnType<typeof createT>; onPlay: (song: Song, list: Song[]) => void | Promise<void> }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<MygoPage>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [account, setAccount] = useState<MygoAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(active.exports.includes("account"));
  const [accountError, setAccountError] = useState("");
  const accountRequest = useRef(0);
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
    if (!active.exports.includes("account")) return;
    const controller = new AbortController();
    const refresh = () => { if (!signInRequest.current) void refreshAccount(controller.signal); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [active.identity]);
  useEffect(() => { if (active.exports.includes("home")) void load("home"); }, [active.identity]);

  useEffect(() => {
    const receive = (event: Event) => {
      const value = (event as CustomEvent<MygoLike>).detail;
      if (value.plugin === source && value.identity === active.identity) setLiked((old) => ({ ...old, [value.track]: value.on }));
    };
    window.addEventListener("lark:mygo-like", receive);
    return () => window.removeEventListener("lark:mygo-like", receive);
  }, [source, active.identity]);

  async function run(action: () => Promise<unknown>) {
    if (busy || !source) return false;
    setBusy(true); setError(""); setNotice("");
    try { await action(); return true; }
    catch (error) { setError(mygoErrorMessage(error)); return false; }
    finally { setBusy(false); }
  }

  async function refreshAccount(signal?: AbortSignal) {
    if (!can("account")) return;
    const request = ++accountRequest.current;
    setAccountLoading(true); setAccountError("");
    try {
      const value = await call<MygoAccount | null>("account", {}, signal);
      if (!signal?.aborted && request === accountRequest.current) setAccount(value);
    } catch (error) {
      if (!signal?.aborted && request === accountRequest.current) setAccountError(mygoErrorMessage(error));
    } finally {
      if (!signal?.aborted && request === accountRequest.current) setAccountLoading(false);
    }
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
    let signedIn = false;
    const completed = await run(async () => {
      const controller = new AbortController();
      signInRequest.current = controller;
      setPrompt({ text: t("loading") });
      let polling = false;
      const timer = window.setInterval(() => {
        if (polling || controller.signal.aborted) return;
        polling = true;
        void api.mygoPrompt(source, active.identity).then((value) => { if (!controller.signal.aborted) setPrompt(value || { text: t("loading") }); }).catch(() => undefined).finally(() => { polling = false; });
      }, 1000);
      try {
        const profile = await call<MygoAccount | null>("signIn", {}, controller.signal);
        if (!controller.signal.aborted) {
          signedIn = true;
          setPrompt(null);
          accountRequest.current++;
          setAccount(profile || null); setPage({}); setLiked({}); setPlaylists([]); setTarget("");
          setNotice(profile?.name || t("done"));
          await refreshAccount(controller.signal);
        }
      }
      catch (error) { if (!controller.signal.aborted) throw error; }
      finally { window.clearInterval(timer); signInRequest.current = null; setPrompt(null); }
    });
    if (completed && signedIn && can("home")) await load("home");
  }

  async function signOut() {
    const completed = await run(async () => {
      await call("signOut");
      accountRequest.current++;
      setAccount(null); setAccountError(""); setPage({}); setLiked({}); setPlaylists([]); setTarget("");
      setNotice(t("done"));
      await refreshAccount();
    });
    if (completed && can("home")) await load("home");
  }

  async function like(track: MygoTrack) {
    const next = !(liked[track.id] ?? track.liked ?? false);
    await run(async () => { await call("like", { id: track.id, on: next }); notifyMygoLike({ plugin: source, identity: active.identity, track: track.id, on: next }); setNotice(t("done")); });
  }

  const allTracks = [...mygoPageTracks(page), ...(page.sections || []).flatMap(mygoPageTracks)].filter((track) => !track.unavailable);
  async function play(trackId?: string) {
    await run(async () => {
      const songs = allTracks.map((item) => mygoSong(source, { ...item, liked: liked[item.id] ?? item.liked }, active.identity));
      const song = trackId === undefined ? songs[0] : songs.find((item) => item.mygo?.track === trackId);
      if (song) await onPlay(song, songs);
    });
  }

  function tracks(items: MygoTrack[]) {
    return <ul className="mygo-tracks">{items.map((track, index) => <li key={`${track.id}:${index}`}>
      <MygoArtwork key={track.album?.imageUrl || "empty"} src={mygoImageURL(source, track.album?.imageUrl, active.identity)} />
      <div className="mygo-track-title"><strong>{track.name}</strong><small>{track.artists?.length ? `${track.artists.map((artist) => artist.name).join(" / ")} · ` : ""}{Math.floor((track.duration || 0) / 60000)}:{String(Math.floor((track.duration || 0) / 1000) % 60).padStart(2, "0")}</small></div>
      <div className="mygo-track-actions">
        <button disabled={busy || track.unavailable} aria-label={`${t("play")} ${track.name}`} onClick={() => void play(track.id)}><Play aria-hidden="true" /></button>
        <button disabled={busy || !can("like")} title={!can("like") ? t("mygoUnavailable") : undefined} aria-label={(liked[track.id] ?? track.liked) ? t("mygoUnfavorite") : t("mygoFavorite")} aria-pressed={liked[track.id] ?? track.liked ?? false} onClick={() => void like(track)}><Heart weight={(liked[track.id] ?? track.liked) ? "fill" : "regular"} aria-hidden="true" /></button>
        {can("addToPlaylist") && <button disabled={busy || !target} title={t("mygoPlaylistTarget")} aria-label={t("addToPlaylist")} onClick={() => void run(async () => { await call("addToPlaylist", { id: target, trackIds: [track.id] }); setNotice(t("done")); })}><Plus aria-hidden="true" /></button>}
        {openedPlaylist && can("removeFromPlaylist") && <button disabled={busy} onClick={() => void run(async () => { await call("removeFromPlaylist", { id: openedPlaylist, trackIds: [track.id] }); setPage((old) => ({ ...old, tracks: old.tracks?.filter((item) => item.id !== track.id) })); setNotice(t("done")); })}>{t("mygoRemoveTrack")}</button>}
      </div>
    </li>)}</ul>;
  }

  function entities(value: MygoPage) {
    return <div className="mygo-collections">{(["playlists", "albums", "artists", "shows", "stations"] as const).flatMap((kind) => (value[kind] || []).map((entity) => <button className="mygo-collection-button" disabled={busy} key={`${kind}:${entity.id}`} onClick={() => void load(kind === "playlists" ? "playlist" : kind === "albums" ? "album" : kind === "artists" ? "artist" : kind === "stations" ? "stationNext" : "show", { id: entity.id, offset: 0 })}>
      <MygoArtwork key={entity.imageUrl || "empty"} src={mygoImageURL(source, entity.imageUrl, active.identity)} className={kind === "artists" ? "mygo-artist-artwork" : ""} /><span>{entity.name}</span>
    </button>))}</div>;
  }

  const isCurrent = (method: string, page?: string) => request.current.method === method && (page === undefined || request.current.params.page === page) ? "page" as const : undefined;

  return <div className="mygo-source-browser">
    <header className="mygo-source-heading"><h3>{active.manifest.name}</h3><MygoSourceSettings key={source} plugin={active} t={t} /></header>
    {error && <p role="alert" className="plugin-feedback error">{error}</p>}
      {(can("account") || can("signIn") || can("signOut")) && <div className="mygo-account-status" data-state={accountLoading ? "loading" : accountError ? "unknown" : account ? "signed-in" : "signed-out"}>
        {account?.imageUrl && <MygoArtwork key={account.imageUrl} src={mygoImageURL(source, account.imageUrl, active.identity)} className="mygo-account-avatar" />}
        {can("account") && <>
        <span role="status">{accountLoading ? t("mygoAccountChecking") : accountError ? t("mygoAccountUnknown") : account ? `${t("mygoAccountSignedIn")} · ${account.name || account.id}` : t("mygoAccountSignedOut")}</span>
        <button type="button" disabled={busy || accountLoading} onClick={() => void refreshAccount()}>{t("mygoAccountRefresh")}</button>
        </>}
        {can("signIn") && (!can("account") || !account || accountError) && <button className="mygo-sign-in" disabled={busy || accountLoading} onClick={() => void signIn()}>{t("mygoSignIn")}</button>}
        {can("signOut") && (!can("account") || account) && <button className="mygo-sign-out" disabled={busy} onClick={() => void signOut()}>{t("mygoSignOut")}</button>}
        {accountError && <p role="alert" className="plugin-feedback error">{accountError}</p>}
      </div>}
      <nav className="mygo-source-tabs" aria-label={active.manifest.name}>
        {can("home") && <button disabled={busy} aria-current={isCurrent("home")} onClick={() => void load("home")}>{t("mygoHome")}</button>}
        {can("liked") && <button disabled={busy} aria-current={isCurrent("liked")} onClick={() => void load("liked", { offset: 0 })}>{t("mygoLiked")}</button>}
        {can("playlists") && <button disabled={busy} aria-current={isCurrent("playlists")} onClick={() => void load("playlists")}>{t("mygoLoadPlaylists")}</button>}
        {(active.manifest.navigation || []).filter((nav) => nav.page && can("browse")).map((nav) => <button key={nav.page} disabled={busy} aria-current={isCurrent("browse", nav.page)} onClick={() => void load("browse", { page: nav.page })}>{nav.title}</button>)}
        {(active.manifest.navigation || []).filter((nav) => nav.builtin && !["home", "liked", "playlists"].includes(nav.builtin) && can(nav.builtin)).map((nav) => <button key={nav.builtin} disabled={busy} aria-current={isCurrent(nav.builtin!)} onClick={() => void load(nav.builtin!, { offset: 0 })}>{nav.title || nav.builtin}</button>)}
      </nav>
      {can("search") && <form className="mygo-actions mygo-source-search" role="search" aria-label={active.manifest.name} onSubmit={(event) => { event.preventDefault(); void load("search", { query, kind: "tracks", offset: 0 }); }}><label><span className="sr-only">{t("mygoSearch")}</span><input type="search" value={query} placeholder={t("mygoSearchPlaceholder")} onChange={(event) => setQuery(event.target.value)} /></label><button disabled={busy || !query.trim()}>{t("mygoSearch")}</button></form>}
      {(can("createPlaylist") || playlists.length > 0) && <details className="mygo-playlist-tools"><summary>{t("mygoPlaylistTools")}</summary><div>
      {can("createPlaylist") && <form className="mygo-actions" onSubmit={(event) => { event.preventDefault(); void run(async () => { const playlist = await call<MygoEntity>("createPlaylist", { name: playlistName }); setPlaylists((old) => [...old, playlist]); setTarget(playlist.id); setPlaylistName(""); setNotice(t("done")); }); }}><label><span className="sr-only">{t("mygoPlaylistName")}</span><input placeholder={t("mygoPlaylistName")} value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} /></label><button disabled={busy || !playlistName.trim()}>{t("mygoCreatePlaylist")}</button></form>}
      {playlists.length > 0 && <div className="mygo-actions"><label><span>{t("mygoPlaylistTarget")}</span><select value={target} onChange={(event) => setTarget(event.target.value)}><option value="" disabled>{t("mygoPlaylistTarget")}</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select></label>
        {can("renamePlaylist") && <button disabled={busy || !target || !playlistName.trim()} onClick={() => void run(async () => { await call("renamePlaylist", { id: target, name: playlistName }); setPlaylists((old) => old.map((playlist) => playlist.id === target ? { ...playlist, name: playlistName } : playlist)); setNotice(t("done")); })}>{t("mygoRenamePlaylist")}</button>}
        {can("deletePlaylist") && <button disabled={busy || !target} onClick={() => { setError(""); setDeletingPlaylist(target); }}>{t("mygoDeletePlaylist")}</button>}
      </div>}
      </div></details>}
      {busy && <p role="status">{t("loading")}</p>}{notice && <p role="status">{notice}</p>}
      {prompt && <MygoSignInPrompt prompt={prompt} t={t} onCancel={() => signInRequest.current?.abort()} />}
      {deletingPlaylist && <ConfirmActionDialog title={t("mygoDeletePlaylist")} message={playlists.find((playlist) => playlist.id === deletingPlaylist)?.name || deletingPlaylist} cancelLabel={t("cancel")} confirmLabel={busy ? t("loading") : t("mygoDeletePlaylist")} busy={busy} error={error} onCancel={() => { setDeletingPlaylist(""); setError(""); }} onConfirm={() => void run(async () => { await call("deletePlaylist", { id: deletingPlaylist }); setPlaylists((old) => old.filter((playlist) => playlist.id !== deletingPlaylist)); setTarget(""); setDeletingPlaylist(""); setNotice(t("done")); })} />}
      <div className="mygo-source-content" aria-busy={busy}>
      {(page.title || openedPlaylist) && <div className="mygo-page-heading">
        {page.title && <h4>{page.title}</h4>}
        {openedPlaylist && <button type="button" className="mygo-play-all mygo-primary" disabled={busy || !allTracks.length} onClick={() => void play()}><Play weight="fill" aria-hidden="true" />{page.more ? t("mygoPlayLoaded") : t("playAll")}</button>}
      </div>}
      {tracks(mygoPageTracks(page))}{entities(page)}
      {(page.links || []).map((link) => <button key={link.page} disabled={busy} onClick={() => void load("browse", { page: link.page })}>{link.title}</button>)}
      {(page.sections || []).map((section, index) => <section key={index}><h4>{section.title}</h4>{tracks(mygoPageTracks(section))}{entities(section)}{(section.links || []).map((link) => <button key={link.page} disabled={busy} onClick={() => void load("browse", { page: link.page })}>{link.title}</button>)}{section.morePage && <button disabled={busy} onClick={() => void load("browse", { page: section.morePage })}>{t("nextPage")}</button>}</section>)}
      {page.more && <button disabled={busy} onClick={() => void load(request.current.method, { ...request.current.params, offset: request.current.offset }, true)}>{t("nextPage")}</button>}
      </div>
  </div>;
}
