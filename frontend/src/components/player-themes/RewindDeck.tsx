import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ArrowLeft, CaretDown, CaretUp, DotsThree, Play, Stack, VinylRecord } from "@phosphor-icons/react";
import type { Album, RewindTheme, Song } from "../../types";
import type { MobileArtPlayerLabels } from "./types";
import { RewindCassette } from "./RewindCassette";
import { findTapeAlbum, type RewindLibrary } from "./rewindLibrary";
import { loadTapeImage, paintTape, TAPE_MATERIALS } from "./rewindTexture";

function TapeThumbnail({ album, cover, variant }: { album: Album; cover?: string; variant: RewindTheme }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const record = { variant, title: album.title, album: album.title, artist: album.artist };
    paintTape(canvas, record, undefined, true);
    return cover ? loadTapeImage(cover, (image) => paintTape(canvas, record, image, true)) : undefined;
  }, [variant, album, cover]);
  return <canvas ref={ref} aria-hidden="true" />;
}

function RackTape({ album, index, cover, onPlay, onInspect, details }: { album: Album; index: number; cover?: string; onPlay: () => void; onInspect: () => void; details: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const suppress = useRef(false);
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => {
    const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; origin.current = null; suppress.current = true; };
    const pointer = (event: globalThis.PointerEvent) => { if (!event.isPrimary) cancel(); };
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("visibilitychange", visibility);
    return () => { cancel(); window.removeEventListener("blur", cancel); document.removeEventListener("pointerdown", pointer, true); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  const variant = (["rewind-classic", "rewind-studio", "rewind-crystal"] as const)[index % 3];
  const palette = TAPE_MATERIALS[variant];
  const cancel = () => { stop(); origin.current = null; suppress.current = true; };
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) { cancel(); return; }
    stop(); suppress.current = false;
    origin.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    timer.current = setTimeout(() => { origin.current = null; suppress.current = true; onInspect(); }, 520);
  };
  return <li style={{ "--rack-shell": palette.shell, "--rack-edge": palette.edge } as CSSProperties}>
    <button type="button" className="rewind-rack-tape" onPointerDown={start} onPointerMove={(event) => {
      if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8) cancel();
    }} onPointerUp={stop} onPointerCancel={cancel} onPointerLeave={cancel} onContextMenu={(event) => event.preventDefault()} onClick={(event) => {
      if (event.detail && suppress.current) { suppress.current = false; return; }
      onPlay();
    }} aria-label={`${album.title} · ${album.artist}`}>
      <span className="rewind-rack-object" aria-hidden="true">
        <span className="rewind-rack-face"><TapeThumbnail album={album} cover={cover} variant={variant} /></span>
        <span className="rewind-rack-spine"><strong>{album.title}</strong><small>{album.artist}</small></span>
        <span className="rewind-rack-side side-left" /><span className="rewind-rack-side side-right" />
      </span>
      <span className="rewind-rack-caption">{album.title}<small>{album.artist}</small></span>
    </button>
    <button type="button" className="rewind-rack-details" aria-label={`${details} · ${album.title}`} onClick={onInspect}><DotsThree weight="bold" /></button>
  </li>;
}

type Props = {
  variant: RewindTheme;
  mediaKey?: string;
  title: string;
  artist: string;
  album: string;
  cover?: string;
  playing: boolean;
  progress: number;
  labels: MobileArtPlayerLabels;
  library?: RewindLibrary;
  onCoverError?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onQueue?: () => void;
};

export function RewindDeck({ variant, mediaKey, title, artist, album, cover, playing, progress, labels, library, onCoverError, onPrevious, onNext, onQueue }: Props) {
  const [view, setView] = useState<"tape" | "artwork" | "rack">("tape");
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<{ album: Album; songs: Song[] | null; error: boolean } | null>(null);
  const [rack, setRack] = useState<{ albums: Album[]; total: number; page: number; loading: boolean; error: boolean } | null>(null);
  const libraryRef = useRef(library);
  const rackRequest = useRef<AbortController | null>(null);
  useEffect(() => { libraryRef.current = library; }, [library]);
  const loadRack = useCallback(async (page: number) => {
    const source = libraryRef.current;
    if (!source) return;
    rackRequest.current?.abort();
    const controller = new AbortController();
    rackRequest.current = controller;
    setRack(previous => ({ albums: previous?.albums ?? source.albums, total: previous?.total ?? source.albums.length, page: previous?.page ?? 0, loading: true, error: false }));
    try {
      const result = await source.loadAlbums(page, controller.signal);
      if (controller.signal.aborted) return;
      setRack(previous => ({ albums: page === 1 ? result.items : [...(previous?.albums ?? []).filter(album => !result.items.some(item => item.id === album.id)), ...result.items], total: result.total, page: result.page, loading: false, error: false }));
    } catch { if (!controller.signal.aborted) setRack(previous => previous ? { ...previous, loading: false, error: true } : null); }
  }, []);
  useEffect(() => {
    if (view === "rack") void loadRack(1);
    return () => rackRequest.current?.abort();
  }, [view, loadRack]);
  const request = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const text = {
    cassette: labels.cassette ?? "Cassette", artwork: labels.artwork ?? "Artwork", rack: labels.tapeRack ?? "Tape rack",
    details: labels.albumTracks ?? "Album tracks", expand: labels.expandTapes ?? "Show cassette faces", collapse: labels.collapseTapes ?? "Show cassette spines",
    loading: labels.loadingTracks ?? "Loading tracks…", failed: labels.failedTracks ?? "Could not load this album.", empty: labels.emptyTapes ?? "Your albums will appear here.",
    noTracks: labels.noAlbumTracks ?? "This album has no playable tracks.", retry: labels.retry ?? "Retry", back: labels.albumBack ?? "Back", play: labels.play ?? "Play",
    loadingAlbums: labels.loading ?? "Loading…", more: labels.loadMore ?? "Load more", failedAlbums: labels.failedTapes ?? "Could not load the cassette rack.",
  };
  useEffect(() => () => { request.current++; }, []);
  const inspectedID = selection?.album.id;
  useEffect(() => {
    if (inspectedID !== undefined) detailHeading.current?.focus();
    else { returnFocus.current?.focus(); returnFocus.current = null; }
  }, [inspectedID]);
  const inspect = async (item: Album) => {
    if (!library) return;
    if (!selection) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const generation = ++request.current;
    setSelection({ album: item, songs: null, error: false });
    detailHeading.current?.focus();
    try {
      const songs = await library.loadSongs(item);
      if (request.current === generation) setSelection({ album: item, songs, error: false });
    } catch { if (request.current === generation) setSelection({ album: item, songs: [], error: true }); }
  };
  const closeDetails = () => { request.current++; setSelection(null); };
  const rackAlbums = rack?.albums ?? library?.albums ?? [];
  const currentAlbum = library ? findTapeAlbum(library.albums, album, artist) ?? findTapeAlbum(rackAlbums, album, artist) : undefined;
  const hold = currentAlbum ? () => void inspect(currentAlbum) : onQueue;
  return <div ref={roomRef} className={`rewind-listening-room ${variant}`} onKeyDown={(event) => {
    if (event.key === "Escape" && selection) { event.stopPropagation(); closeDetails(); }
  }}>
    <div className="rewind-screen-bar">
      <span className="rewind-status-light" data-on={playing ? "true" : "false"} aria-hidden="true" />
      <span>LARK <b>STEREO</b></span><small>PERSONAL CASSETTE SYSTEM</small>
    </div>
    <div className="rewind-screen-pages" hidden={Boolean(selection)}>
      <div className="rewind-now-playing" hidden={view === "rack"}>
        <div className="rewind-model-area" hidden={view !== "tape"}>
          <RewindCassette variant={variant} mediaKey={mediaKey} cover={cover} title={title} artist={artist} album={album} playing={playing} progress={progress} flipLabel={labels.flipTape} onCoverError={onCoverError} onPrevious={onPrevious} onNext={onNext} onQueue={hold} />
        </div>
        <div className="rewind-artwork-page" hidden={view !== "artwork"}>
          {cover ? <img src={cover} alt={album} draggable={false} onError={onCoverError} /> : <div className="rewind-artwork-placeholder"><VinylRecord /><strong>{album}</strong></div>}
        </div>
        <div className="mobile-art-meta rewind-record-meta">
          <small>{view === "tape" ? "SIDE A / NOW PLAYING" : "ALBUM / ARTWORK"}</small>
          <strong>{title}</strong><span>{artist}</span><em>{album}</em>
          <div className="rewind-record-rule" /><p>{labels.tapeHint}</p>
          {currentAlbum ? <button type="button" className="rewind-current-details" onClick={() => void inspect(currentAlbum)}><Stack />{text.details}<span>{currentAlbum.song_count}</span></button> : null}
        </div>
      </div>
      <div className="rewind-rack-page" hidden={view !== "rack"}>
        <div className="rewind-rack-toolbar"><span>{rack?.total ?? rackAlbums.length} <b>{text.rack}</b></span><button type="button" aria-label={expanded ? text.collapse : text.expand} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <CaretUp /> : <CaretDown />}<span>{expanded ? text.collapse : text.expand}</span></button></div>
        <ol className="rewind-rack" data-expanded={expanded ? "true" : "false"} aria-busy={rack?.loading ?? false}>
          {library ? rackAlbums.map((item, index) => <RackTape key={item.id} album={item} index={index} cover={library.cover(item)} details={text.details} onPlay={() => { setView("tape"); library.playAlbum(item); }} onInspect={() => void inspect(item)} />) : null}
          {rack?.loading ? <li className="rewind-rack-more" role="status">{text.loadingAlbums}</li> : rack?.error ? <li className="rewind-rack-more" role="alert"><p>{text.failedAlbums}</p><button type="button" onClick={() => void loadRack((rack?.page ?? 0) + 1)}>{text.retry}</button></li> : rack && rack.albums.length < rack.total ? <li className="rewind-rack-more"><button type="button" onClick={() => void loadRack(rack.page + 1)}>{text.more}</button></li> : null}
        </ol>
        {!rackAlbums.length && !rack?.loading && !rack?.error ? <p className="rewind-empty"><Stack />{text.empty}</p> : null}
      </div>
    </div>
    {selection ? <section className="rewind-album-panel" aria-labelledby={headingId} aria-busy={selection.songs === null}>
      <button type="button" className="rewind-album-back" onClick={closeDetails}><ArrowLeft />{text.back}</button>
      <div className="rewind-album-header"><TapeThumbnail album={selection.album} cover={library?.cover(selection.album)} variant={variant} /><h3 ref={detailHeading} tabIndex={-1} id={headingId}>{selection.album.title}</h3><span>{selection.album.artist}</span></div>
      {selection.songs === null ? <p className="rewind-track-status" role="status">{text.loading}</p> : selection.error ? <div className="rewind-track-status" role="alert"><p>{text.failed}</p><button type="button" onClick={() => void inspect(selection.album)}>{text.retry}</button></div> : !selection.songs.length ? <p className="rewind-track-status">{text.noTracks}</p> : <ol className="rewind-album-tracks">{selection.songs.map((song, index) => <li key={song.id}><button type="button" aria-label={`${text.play} · ${song.title}`} onClick={() => { library?.playSong(song, selection.songs ?? []); returnFocus.current = roomRef.current?.querySelector<HTMLButtonElement>(".rewind-tape-stage") ?? null; setView("tape"); closeDetails(); }}><span>{index + 1}</span><strong>{song.title}<small>{song.artist}</small></strong><time>{Math.floor(song.duration_seconds / 60)}:{String(Math.floor(song.duration_seconds % 60)).padStart(2, "0")}</time><Play weight="fill" /></button></li>)}</ol>}
    </section> : null}
    <div className="rewind-page-switch" role="group" aria-label={labels.menu} hidden={Boolean(selection)}>
      <button type="button" aria-pressed={view === "tape"} onClick={() => setView("tape")}>{text.cassette}</button>
      <button type="button" aria-pressed={view === "artwork"} onClick={() => setView("artwork")}>{text.artwork}</button>
      <button type="button" aria-pressed={view === "rack"} onClick={() => setView("rack")}>{text.rack}</button>
    </div>
  </div>;
}
