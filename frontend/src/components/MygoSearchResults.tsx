import { ArrowSquareOut, MusicNotes, Play } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { createT } from "../i18n";
import type { Song } from "../types";
import { api } from "../services/api";
import { appendMygoPage, mygoErrorMessage, mygoImageURL, mygoPageTracks, mygoSong, type MygoPage, type MygoPlugin } from "../features/plugins/mygo";
import "./MygoSearchResults.css";

interface MygoSearchResultsProps {
  sources: MygoPlugin[];
  query: string;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list: Song[]) => void | Promise<void>;
  onOpenSource: (source: MygoPlugin) => void;
}

export function MygoSearchResults({ sources, query, t, onPlay, onOpenSource }: MygoSearchResultsProps) {
  const search = query.trim();
  const searchable = sources.filter((source) => source.enabled && source.exports.includes("search"));
  if (!search || !searchable.length) return null;
  return <section className="mygo-search-results" aria-label={t("mygoSearchResults")}>
    <h3>{t("mygoSearchResults")}</h3>
    {searchable.map((source) => <MygoSourceResults
      key={JSON.stringify([source.manifest.id, source.identity, source.digest, source.origin, search])}
      source={source} query={search} t={t} onPlay={onPlay} onOpenSource={onOpenSource}
    />)}
  </section>;
}

function MygoSearchArtwork({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="mygo-search-artwork" aria-hidden="true">
    {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <MusicNotes />}
  </span>;
}

function MygoSourceResults({ source, query, t, onPlay, onOpenSource }: Omit<MygoSearchResultsProps, "sources"> & { source: MygoPlugin }) {
  const [page, setPage] = useState<MygoPage>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [playError, setPlayError] = useState("");
  const nextOffset = useRef(0);
  const failedOffset = useRef(0);
  const request = useRef<AbortController | null>(null);
  const plugin = source.manifest.id;
  const identity = source.identity;

  async function load(offset: number) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    failedOffset.current = offset;
    try {
      const result = await api.mygoCall<MygoPage>(plugin, "search", { query, kind: "tracks", offset }, identity, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      nextOffset.current = offset + mygoPageTracks(result).length;
      setPage((previous) => offset === 0 ? result : appendMygoPage(previous, result));
    } catch (cause) {
      if (!controller.signal.aborted && request.current === controller) setError(mygoErrorMessage(cause));
    } finally {
      if (!controller.signal.aborted && request.current === controller) setBusy(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(0), 300);
    return () => { window.clearTimeout(timer); request.current?.abort(); };
  }, [plugin, identity, query]);

  const tracks = mygoPageTracks(page);
  const songs = tracks.filter((track) => !track.unavailable).map((track) => mygoSong(plugin, track, identity, source.manifest.name));
  async function play(trackId: string) {
    const song = songs.find((item) => item.mygo?.track === trackId);
    if (!song) return;
    setPlayError("");
    try { await onPlay(song, songs); }
    catch (cause) { if (!request.current?.signal.aborted) setPlayError(mygoErrorMessage(cause)); }
  }

  return <section className="mygo-search-source" aria-label={source.manifest.name} aria-busy={busy}>
    <h4><button type="button" className="mygo-search-source-link" onClick={() => onOpenSource(source)}>
      <MusicNotes aria-hidden="true" /><span>{source.manifest.name}</span><ArrowSquareOut aria-hidden="true" />
    </button></h4>
    {tracks.length > 0 && <ul className="mygo-search-tracks">{tracks.map((track, index) => {
      const image = mygoImageURL(plugin, track.album?.imageUrl, identity);
      const seconds = Math.max(0, Math.floor((track.duration || 0) / 1000));
      return <li key={`${track.id}:${index}`}>
        <button type="button" className="mygo-search-track" disabled={track.unavailable} aria-label={`${t("play")} ${track.name}`} onClick={() => void play(track.id)}>
          <MygoSearchArtwork key={image || "empty"} src={image} />
          <span className="mygo-search-track-info"><strong>{track.name}</strong><small>{track.artists?.map((artist) => artist.name).join(" / ") || track.album?.name}</small></span>
          <span className="mygo-search-duration">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
          <Play className="mygo-search-play" aria-hidden="true" />
        </button>
      </li>;
    })}</ul>}
    {busy && <p className="mygo-search-status" role="status">{t("loading")}</p>}
    {error && <div className="mygo-search-error"><p role="alert">{error}</p><button type="button" disabled={busy} onClick={() => void load(failedOffset.current)}>{t("retry")}</button></div>}
    {playError && <p className="mygo-search-status" role="alert">{playError}</p>}
    {!busy && !error && !tracks.length && <p className="mygo-search-status" role="status">{t("mygoSearchEmpty")}</p>}
    {page.more && !error && <button type="button" className="mygo-search-next" disabled={busy} onClick={() => void load(nextOffset.current)}>{t("nextPage")}</button>}
  </section>;
}
