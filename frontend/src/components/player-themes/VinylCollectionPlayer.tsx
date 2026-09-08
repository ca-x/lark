import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowClockwise, ArrowsClockwise, CaretLeft, CaretRight, Pause, Play, Record, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward, SpeakerHigh } from "@phosphor-icons/react";
import type { Album, Song } from "../../types";
import type { createT } from "../../i18n";
import { api } from "../../services/api";
import { albumCoverUrl, coverUrl } from "../../utils/app";
import { COLLECTION_LOAD_TIMEOUT_MS, MAX_PLAYBACK_QUEUE_SIZE } from "../../constants";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { createAnimationActivity } from "./animationActivity";
import { useDiscScratchSeek } from "./useDiscScratchSeek";
import { useCoverFallback } from "./useCoverFallback";
import type { PlayerThemePlayMode } from "./types";
import deckImage from "./vinyl-collection/deck.svg";
import fixturesImage from "./vinyl-collection/fixtures.svg";
import tonearmImage from "./vinyl-collection/tonearm.svg";
import recordImage from "./vinyl-collection/record.svg";

type Props = {
  albums: Album[];
  current: Song | null;
  displaySong?: Song;
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
  playMode: PlayerThemePlayMode;
  playModeLabel: string;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list?: Song[]) => void;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (value: number) => void;
  onCyclePlayMode: () => void;
};

type TrackResult = { albumId: number; status: "ready" | "error"; songs: Song[] };

export function VinylCollectionPlayer({ albums: cachedAlbums, current, displaySong, playing, progress, duration, volume, playMode, playModeLabel, t, onPlay, onToggle, onPrevious, onNext, onSeek, onVolume, onCyclePlayMode }: Props) {
  const [catalog, setCatalog] = useState<{ items: Album[]; total: number; page: number; hasMore: boolean } | null>(null);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const albums = catalog?.items ?? cachedAlbums;
  const [selectedId, setSelectedId] = useState<number | null>(current?.album_id ?? displaySong?.album_id ?? null);
  const selected = albums.find((album) => album.id === selectedId) ?? albums[0];
  const selectedIndex = selected ? albums.indexOf(selected) : -1;
  const [flipped, setFlipped] = useState(false);
  const [result, setResult] = useState<TrackResult | null>(null);
  const [retry, setRetry] = useState(0);
  const tracks = result?.albumId === selected?.id && result?.status === "ready" ? result.songs : [];
  const loading = Boolean(selected && result?.albumId !== selected.id);
  const failed = result?.albumId === selected?.id && result?.status === "error";
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const deckRef = useRef<HTMLDivElement>(null);
  const loadedDiscRef = useRef<HTMLButtonElement>(null);
  const sleeveDiscRef = useRef<HTMLButtonElement>(null);
  const rotorRef = useRef<HTMLSpanElement>(null);
  const pendingFlight = useRef<{ albumId: number; rect: DOMRect } | null>(null);
  const spinRef = useRef({ angle: 0, speed: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressDiscClick = useRef(false);
  const shelfDrag = useRef<{ id: number; x: number; index: number; moved: boolean } | null>(null);
  const suppressShelfClick = useRef(false);
  const wheelTime = useRef(0);
  const selectedLoaded = Boolean(current && selected?.id === current.album_id);
  const active = playing && Boolean(current);
  const scratch = useDiscScratchSeek({ duration, progress, onSeek: current ? onSeek : undefined, scratchCycleSeconds: 12, trackKey: current?.id });
  const trackTime = Math.max(0, Math.min(scratch.progress, duration || 0));

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), COLLECTION_LOAD_TIMEOUT_MS);
    let cancelled = false;
    setCatalogBusy(true);
    setCatalogFailed(false);
    api.albumsPage(catalogPage, 60, 0, controller.signal).then((page) => {
      if (cancelled) return;
      setCatalog((previous) => {
        const items = catalogPage === 1 ? [] : previous?.items ?? [];
        const ids = new Set(items.map((album) => album.id));
        const additions = page.items.filter((album) => !ids.has(album.id));
        return { items: [...items, ...additions], total: page.total, page: catalogPage, hasMore: additions.length > 0 && page.offset + page.items.length < page.total };
      });
    }).catch(() => { if (!cancelled) setCatalogFailed(true); }).finally(() => {
      window.clearTimeout(timer);
      if (!cancelled) setCatalogBusy(false);
    });
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [catalogPage, catalogRetry]);

  useEffect(() => {
    if (catalog && !catalogBusy && !catalogFailed && catalog.page === catalogPage && catalog.hasMore && selectedIndex >= albums.length - 5) {
      setCatalogPage((page) => page + 1);
    }
  }, [catalog, catalogBusy, catalogFailed, catalogPage, albums.length, selectedIndex]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), COLLECTION_LOAD_TIMEOUT_MS);
    let cancelled = false;
    api.albumSongs(selected.id, MAX_PLAYBACK_QUEUE_SIZE, controller.signal).then((songs) => {
      if (!cancelled) setResult({ albumId: selected.id, songs, status: "ready" });
    }).catch(() => {
      if (!cancelled) setResult({ albumId: selected.id, songs: [], status: "error" });
    }).finally(() => window.clearTimeout(timer));
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [selected?.id, retry]);

  // Keep physical inertia local to the artwork, without rerendering the player every frame.
  useEffect(() => {
    const rotor = rotorRef.current;
    if (!rotor || reducedMotion) return;
    let last = 0;
    const spin = spinRef.current;
    const target = active && !scratch.scratching ? 200 : 0; // 33 1/3 RPM
    const activity = createAnimationActivity(rotor, (now) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      spin.speed += (target - spin.speed) * (1 - Math.exp(-dt * 7));
      if (Math.abs(spin.speed - target) < 0.1) spin.speed = target;
      spin.angle = (spin.angle + spin.speed * dt) % 360;
      rotor.style.transform = `rotate(${spin.angle}deg)`;
    }, () => target !== 0 || spin.speed !== 0);
    return activity.dispose;
  }, [active, reducedMotion, scratch.scratching]);

  useLayoutEffect(() => {
    const disc = loadedDiscRef.current;
    const flight = pendingFlight.current;
    if (!disc || !flight || flight.albumId !== current?.album_id) return;
    pendingFlight.current = null;
    if (reducedMotion || disc.closest(".vinyl-collection-player")?.getAttribute("data-input") === "keyboard") return;
    const end = disc.getBoundingClientRect();
    const dx = flight.rect.x + flight.rect.width / 2 - end.x - end.width / 2;
    const dy = flight.rect.y + flight.rect.height / 2 - end.y - end.height / 2;
    const scale = flight.rect.width / end.width;
    const animation = disc.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 1 },
      { transform: `translate(${dx * 0.6}px, ${dy - 30}px) scale(${scale * 1.04})`, offset: 0.35 },
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
    ], { duration: 760, easing: "cubic-bezier(.23,1,.32,1)" });
    return () => animation.cancel();
  }, [current?.album_id, reducedMotion]);

  function loadMoreAlbums() {
    if (catalogFailed) setCatalogRetry((value) => value + 1);
    else if (catalog?.hasMore) setCatalogPage((page) => page + 1);
    else {
      setCatalogPage(1);
      setCatalogRetry((value) => value + 1);
    }
  }

  function chooseAlbum(index: number) {
    const album = albums[Math.max(0, Math.min(albums.length - 1, index))];
    if (album) { setSelectedId(album.id); setFlipped(false); }
  }

  function playRecord(song = tracks[0]) {
    if (!song) return;
    if (current?.id === song.id) { onToggle(); return; }
    if (sleeveDiscRef.current && !selectedLoaded) {
      pendingFlight.current = { albumId: song.album_id, rect: sleeveDiscRef.current.getBoundingClientRect() };
    }
    onPlay(song, tracks);
  }

  function toggleDeck() {
    if (current) onToggle();
    else playRecord();
  }

  function finishRecordDrag(event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id) return;
    const target = deckRef.current?.getBoundingClientRect();
    const overDeck = target && event.clientX >= target.left && event.clientX <= target.right && event.clientY >= target.top && event.clientY <= target.bottom;
    suppressDiscClick.current = drag.moved;
    if (commit && drag.moved && overDeck) playRecord();
    event.currentTarget.style.transform = "";
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const PlayModeIcon = playMode === "shuffle" ? Shuffle : playMode === "repeat-one" ? RepeatOnce : Repeat;
  const canToggle = Boolean(current || tracks.length);

  return (
    <div className="vinyl-collection-player" data-playing={active} data-dragging={dragging}
      onKeyDownCapture={(event) => { event.currentTarget.dataset.input = "keyboard"; }}
      onPointerDownCapture={(event) => { event.currentTarget.dataset.input = "pointer"; }}>
      <header className="vc-heading"><span>{t("homePlayerVinylCollection")}</span><span>{catalog?.total ?? albums.length} {t("album")}</span></header>
      <div className="vc-listening-room">
        <div className="vc-deck-column">
          <div className="vc-deck" ref={deckRef}>
            <img className="vc-deck-layer" src={deckImage} alt="" draggable={false} />
            <button ref={loadedDiscRef} type="button" className="vc-loaded-disc" data-loaded={Boolean(current)} {...scratch.scratchProps}
              aria-label={`${active ? t("pause") : t("play")} · ${t("vinylScratchHint")}`} disabled={!canToggle} onLostPointerCapture={scratch.scratchProps.onPointerCancel} onClick={toggleDeck}>
              <img src={recordImage} alt="" draggable={false} />
              <span className="vc-rotor" ref={rotorRef}><span className="vc-disc-label"><Cover src={coverUrl(current)} /><span className="vc-label-hole" /></span></span>
            </button>
            <img className="vc-deck-layer vc-fixtures" src={fixturesImage} alt="" draggable={false} />
            <img className="vc-deck-layer vc-tonearm" src={tonearmImage} alt="" draggable={false}
              style={{ transform: `rotate(${active ? 24.1 + scratch.pct * 24.4 : 3}deg)` }} />
            <button type="button" className="vc-arm-control" aria-label={active ? t("vinylLiftArm") : t("vinylLowerArm")} title={active ? t("vinylLiftArm") : t("vinylLowerArm")} onClick={toggleDeck} disabled={!canToggle} />
            <button type="button" className="vc-power-control" aria-label={active ? t("pause") : t("play")} title={active ? t("pause") : t("play")} onClick={toggleDeck} disabled={!canToggle} />
          </div>
          <div className="vc-now-playing" aria-live="polite"><strong>{current?.title || t("vinylReady")}</strong><span>{current?.artist || t("vinylLoadHint")}</span></div>
          <div className="vc-controls">
            <div className="vc-progress"><span>{time(trackTime)}</span><input type="range" aria-label={t("position")} min="0" max={Math.max(0, duration)} step="0.1" value={trackTime} disabled={!current || !duration} onChange={(event) => onSeek(Number(event.target.value))} /><span>{time(duration)}</span></div>
            <div className="vc-transport">
              <button type="button" aria-label={playModeLabel} title={playModeLabel} onClick={onCyclePlayMode}><PlayModeIcon /></button>
              <button type="button" aria-label={t("previous")} disabled={!current} onClick={onPrevious}><SkipBack weight="fill" /></button>
              <button type="button" className="vc-play" aria-label={active ? t("pause") : t("play")} disabled={!canToggle} onClick={toggleDeck}>{active ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
              <button type="button" aria-label={t("next")} disabled={!current} onClick={onNext}><SkipForward weight="fill" /></button>
              <label className="vc-volume"><SpeakerHigh aria-hidden="true" /><input type="range" aria-label={t("volume")} min="0" max="1" step="0.01" value={volume} onChange={(event) => onVolume(Number(event.target.value))} /></label>
            </div>
          </div>
        </div>
        <div className="vc-sleeve-column">
          <div className="vc-sleeve-stage">
            <button type="button" className="vc-sleeve-disc" ref={sleeveDiscRef} data-loaded={selectedLoaded} disabled={!tracks.length || selectedLoaded} aria-label={t("vinylLoadRecord")} title={t("vinylLoadRecord")}
              onPointerDown={(event) => {
                if (event.button !== 0 || dragRef.current) return;
                suppressDiscClick.current = false;
                dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.id !== event.pointerId) return;
                const x = event.clientX - drag.x, y = event.clientY - drag.y;
                if (Math.hypot(x, y) > 6) { drag.moved = true; setDragging(true); }
                if (drag.moved) event.currentTarget.style.transform = `translate(${x}px, ${y}px)`;
              }}
              onPointerUp={(event) => finishRecordDrag(event, true)} onPointerCancel={(event) => finishRecordDrag(event, false)}
              onLostPointerCapture={(event) => finishRecordDrag(event, false)}
              onClick={(event) => { if (suppressDiscClick.current && event.detail !== 0) { suppressDiscClick.current = false; return; } playRecord(); }}>
              <img src={recordImage} alt="" draggable={false} /><span className="vc-disc-label"><Cover src={albumCoverUrl(selected)} /><span className="vc-label-hole" /></span>
            </button>
            <div className="vc-sleeve" data-flipped={flipped}>
              <div className="vc-sleeve-front" aria-hidden={flipped} inert={flipped}><Cover src={albumCoverUrl(selected)} /><div className="vc-sleeve-caption"><strong>{selected?.title || t("brand")}</strong><span>{selected?.artist || t("vinylReady")}</span></div></div>
              <div className="vc-sleeve-back" aria-hidden={!flipped} inert={!flipped}>
                <header><strong>{selected?.title || t("album")}</strong><span>{selected?.artist}</span></header>
                <div className="vc-track-list" aria-busy={loading}>
                  {loading ? <p role="status">{t("loading")}</p> : failed ? <div role="alert"><p>{t("vinylLoadError")}</p><button type="button" onClick={() => { setResult(null); setRetry((value) => value + 1); }}><ArrowClockwise />{t("retry")}</button></div> : tracks.length ? tracks.map((song, index) => (
                    <button key={song.id} type="button" className={current?.id === song.id ? "active" : ""} aria-label={`${t("play")} ${song.title}`} aria-current={current?.id === song.id ? "true" : undefined} onClick={() => playRecord(song)}>
                      <span>{current?.id === song.id && active ? <Pause weight="fill" /> : String(index + 1).padStart(2, "0")}</span><span>{song.title}</span><time>{time(song.duration_seconds)}</time>
                    </button>
                  )) : <p>{t("noSongs")}</p>}
                </div>
                <footer><span>{selected?.year || "LARK"}</span><Record /><span>{tracks.length} {t("songs")}</span></footer>
              </div>
            </div>
          </div>
          <div className="vc-sleeve-actions"><button type="button" onClick={() => setFlipped((value) => !value)} aria-pressed={flipped}><ArrowsClockwise />{flipped ? t("vinylShowCover") : t("vinylShowTracks")}</button><button type="button" disabled={!tracks.length} onClick={() => selectedLoaded ? onToggle() : playRecord()}>{selectedLoaded && active ? <Pause weight="fill" /> : <Play weight="fill" />}{selectedLoaded && active ? t("pause") : t("vinylPlayRecord")}</button></div>
          <p className="vc-sleeve-hint" role="status">{loading ? t("loading") : failed ? t("vinylLoadError") : !tracks.length ? t("noSongs") : selectedLoaded ? t("vinylScratchHint") : t("vinylLoadHint")}</p>
          {failed && !flipped ? <button type="button" className="vc-retry" onClick={() => { setResult(null); setRetry((value) => value + 1); }}>{t("retry")}</button> : null}
        </div>
      </div>
      <div className="vc-shelf-navigation">
        <button type="button" aria-label={t("vinylPreviousRecord")} disabled={selectedIndex <= 0} onClick={() => chooseAlbum(selectedIndex - 1)}><CaretLeft /></button>
        <div className="vc-shelf" role="group" aria-label={t("vinylBrowseRecords")} tabIndex={albums.length ? 0 : -1}
          onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); chooseAlbum(event.key === "Home" ? 0 : event.key === "End" ? albums.length - 1 : selectedIndex + (event.key === "ArrowRight" ? 1 : -1)); } }}
          onWheel={(event) => { if (Math.abs(event.deltaX) < Math.abs(event.deltaY) && !event.shiftKey) return; if (Date.now() - wheelTime.current < 140) return; wheelTime.current = Date.now(); chooseAlbum(selectedIndex + (event.deltaX + event.deltaY > 0 ? 1 : -1)); }}
          onPointerDown={(event) => { if (event.button === 0 && !shelfDrag.current) { suppressShelfClick.current = false; shelfDrag.current = { id: event.pointerId, x: event.clientX, index: selectedIndex, moved: false }; } }}
          onPointerMove={(event) => { const drag = shelfDrag.current; if (!drag || drag.id !== event.pointerId) return; if (event.buttons === 0) { shelfDrag.current = null; return; } const delta = event.clientX - drag.x; if (Math.abs(delta) > 8) { drag.moved = true; event.currentTarget.setPointerCapture(event.pointerId); chooseAlbum(drag.index - Math.round(delta / 48)); } }}
          onPointerUp={() => { suppressShelfClick.current = Boolean(shelfDrag.current?.moved); shelfDrag.current = null; }}
          onPointerCancel={() => { shelfDrag.current = null; suppressShelfClick.current = true; }}
          onLostPointerCapture={() => { shelfDrag.current = null; }}
          onClickCapture={(event) => { if (suppressShelfClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressShelfClick.current = false; } }}>
          {albums.slice(Math.max(0, selectedIndex - 12), selectedIndex + 13).map((album) => {
            const offset = albums.indexOf(album) - selectedIndex;
            const x = offset === 0 ? 0 : Math.sign(offset) * (70 + Math.abs(offset) * 29);
            return <button key={album.id} type="button" className="vc-shelf-record" aria-label={`${album.title} · ${album.artist}`} aria-pressed={offset === 0} tabIndex={offset === 0 ? 0 : -1} onClick={() => { setSelectedId(album.id); setFlipped(false); }} style={{ transform: `translateX(${x}px) translateZ(${-Math.min(Math.abs(offset), 8) * 12}px) rotateY(${offset === 0 ? 0 : -Math.sign(offset) * 56}deg)`, zIndex: 20 - Math.abs(offset) }}><Cover src={albumCoverUrl(album)} /><span>{album.title}</span></button>;
          })}
        </div>
        <button type="button" aria-label={t("vinylNextRecord")} disabled={selectedIndex < 0 || selectedIndex >= albums.length - 1} onClick={() => chooseAlbum(selectedIndex + 1)}><CaretRight /></button>
      </div>
      {catalogBusy || catalogFailed || (catalog && albums.length < catalog.total) ? <div className="vc-catalog-status" role="status">
        {catalogBusy ? t("loading") : <button type="button" onClick={loadMoreAlbums}>{catalogFailed ? t("retry") : catalog?.hasMore ? t("loadMore") : t("refresh")}</button>}
      </div> : null}
      <div className="vc-selection" aria-live="polite"><strong>{selected?.title || t("noSongs")}</strong><span>{selected?.artist}</span></div>
    </div>
  );
}

function Cover({ src }: { src?: string }) {
  const cover = useCoverFallback(src);
  return cover.displayUrl ? <img src={cover.displayUrl} alt="" draggable={false} onError={cover.onCoverError} /> : <span className="vc-cover-fallback" aria-hidden="true"><Record weight="thin" /><span>LARK</span></span>;
}

function time(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
