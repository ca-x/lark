import type { MouseEvent, PointerEvent } from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play, Record } from "@phosphor-icons/react";

import type { TKey } from "../i18n";
import type { Album, ArtistAlbumDisplayStyle } from "../types";

type Translate = (key: TKey) => string;

type ArtistAlbumBrowserProps = {
  albums: Album[];
  displayStyle: ArtistAlbumDisplayStyle;
  resetKey: string | number;
  t: Translate;
  onOpenAlbum?: (album: Album) => void;
  onPlayAlbum?: (album: Album) => void;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function ArtistAlbumBrowser({
  albums,
  displayStyle,
  resetKey,
  t,
  onOpenAlbum,
  onPlayAlbum,
}: ArtistAlbumBrowserProps) {
  if (displayStyle === "showcase") {
    return (
      <ArtistAlbumShowcase
        albums={albums}
        resetKey={resetKey}
        t={t}
        onOpenAlbum={onOpenAlbum}
        onPlayAlbum={onPlayAlbum}
      />
    );
  }

  return (
    <div className="artist-album-grid">
      {albums.map((album) => (
        <ArtistAlbumCard
          key={album.id}
          album={album}
          className="artist-album-card"
          t={t}
          onOpenAlbum={onOpenAlbum}
          onPlayAlbum={onPlayAlbum}
        />
      ))}
    </div>
  );
}

function ArtistAlbumShowcase({
  albums,
  resetKey,
  t,
  onOpenAlbum,
  onPlayAlbum,
}: Omit<ArtistAlbumBrowserProps, "displayStyle">) {
  const total = albums.length;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const positionRef = useRef(0);
  const targetRef = useRef(0);
  const activeIndexRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const reduceMotionRef = useRef(false);
  const pointerRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    dragging: false,
    moved: false,
  });
  const clickBlockUntilRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeAlbum = albums[activeIndex];

  const wrapIndex = useCallback((index: number) => {
    if (!total) return 0;
    return ((index % total) + total) % total;
  }, [total]);

  const wrapPosition = useCallback((position: number) => {
    if (!total) return 0;
    return ((position % total) + total) % total;
  }, [total]);

  const styleCards = useCallback((nextPosition: number) => {
    const stage = stageRef.current;
    if (!stage || !total) return;

    const sampleCard = cardRefs.current.find((card) => card !== null);
    const stageWidth = stage.clientWidth || 1;
    const cardWidth = sampleCard?.offsetWidth || clamp(stageWidth * 0.32, 220, 350);
    const firstGap = Math.min(cardWidth * 0.78, stageWidth * 0.24);
    const trailGap = Math.min(cardWidth * 0.34, stageWidth * 0.095);

    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      const rawOffset = index - nextPosition;
      const offset = ((((rawOffset + total / 2) % total) + total) % total) - total / 2;
      const side = offset < 0 ? -1 : 1;
      const distance = Math.abs(offset);
      const centerProgress = 1 - Math.min(distance, 1);
      const centerEase = centerProgress * centerProgress * (3 - 2 * centerProgress);
      const xBase = distance < 1
        ? distance * firstGap
        : firstGap + (distance - 1) * trailGap;
      const x = side * xBase;
      const y = Math.min(distance, 4) * 7;
      const z = 190 - distance * 54;
      const rotation = side * -60 * Math.pow(Math.min(distance, 1), 1.6);
      const scale = Math.max(0.68, 0.8 + centerEase * 0.2 - Math.max(0, distance - 1) * 0.025);
      const opacity = distance > 5 ? 0 : Math.max(0.2, 1 - distance * 0.15);
      const filter = distance > 4 ? "blur(4px)" : distance > 3 ? "blur(2px)" : "none";

      card.style.transform = `translate3d(${x}px, ${y}px, ${z}px) rotateY(${rotation}deg) scale(${scale})`;
      card.style.zIndex = String(60 - Math.round(distance));
      card.style.opacity = String(opacity);
      card.style.filter = filter;
      card.style.pointerEvents = distance > 5 ? "none" : "";
      card.dataset.active = distance < 0.5 ? "true" : "false";
    });
  }, [total]);

  const updateActiveIndex = useCallback((nextPosition: number) => {
    const nextIndex = wrapIndex(Math.round(nextPosition));
    if (activeIndexRef.current === nextIndex) return;
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
  }, [wrapIndex]);

  const syncPosition = useCallback((nextPosition: number) => {
    if (!total) return;
    const wrapped = wrapPosition(nextPosition);
    positionRef.current = wrapped;
    targetRef.current = wrapped;
    styleCards(wrapped);
    updateActiveIndex(wrapped);
  }, [styleCards, total, updateActiveIndex, wrapPosition]);

  const animateToTarget = useCallback(() => {
    if (reduceMotionRef.current) {
      syncPosition(targetRef.current);
      return;
    }
    if (animationFrameRef.current !== null || total < 2) return;

    const tick = () => {
      let delta = targetRef.current - positionRef.current;
      if (delta > total / 2) delta -= total;
      if (delta < -total / 2) delta += total;
      if (Math.abs(delta) < 0.002) {
        syncPosition(targetRef.current);
        animationFrameRef.current = null;
        return;
      }
      positionRef.current = wrapPosition(positionRef.current + delta * 0.18);
      styleCards(positionRef.current);
      updateActiveIndex(positionRef.current);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [styleCards, syncPosition, total, updateActiveIndex, wrapPosition]);

  const settle = useCallback(() => {
    if (!total) return;
    targetRef.current = wrapPosition(Math.round(positionRef.current));
    animateToTarget();
  }, [animateToTarget, total, wrapPosition]);

  const scheduleSettle = useCallback((delay = 130) => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      settle();
    }, delay);
  }, [settle]);

  const push = useCallback((delta: number) => {
    if (total < 2) return;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    const nextPosition = wrapPosition(positionRef.current + delta);
    positionRef.current = nextPosition;
    targetRef.current = nextPosition;
    styleCards(nextPosition);
    updateActiveIndex(nextPosition);
  }, [styleCards, total, updateActiveIndex, wrapPosition]);

  const moveToIndex = useCallback((index: number) => {
    if (!total) return;
    targetRef.current = wrapPosition(index);
    animateToTarget();
  }, [animateToTarget, total, wrapPosition]);

  useLayoutEffect(() => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    animationFrameRef.current = null;
    settleTimerRef.current = null;
    positionRef.current = 0;
    targetRef.current = 0;
    activeIndexRef.current = 0;
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => syncPosition(0));
    return () => window.cancelAnimationFrame(frame);
  }, [albums, resetKey, syncPosition]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => {
      reduceMotionRef.current = query.matches;
      if (query.matches) {
        if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
        syncPosition(Math.round(positionRef.current));
      }
    };
    updatePreference();
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, [syncPosition]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        styleCards(positionRef.current);
      });
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    };
  }, [styleCards]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || total < 2) return;
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    animationFrameRef.current = null;
    settleTimerRef.current = null;
    pointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      dragging: true,
      moved: false,
    };
    event.currentTarget.dataset.dragging = "false";
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const pointer = pointerRef.current;
    if (!pointer.dragging || pointer.pointerId !== event.pointerId) return;
    const totalX = event.clientX - pointer.startX;
    const totalY = event.clientY - pointer.startY;
    if (!pointer.moved && Math.abs(totalX) > 4 && Math.abs(totalX) > Math.abs(totalY)) {
      pointer.moved = true;
      event.currentTarget.dataset.dragging = "true";
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events may not have an active pointer to capture.
      }
    }
    if (pointer.moved) {
      const cardWidth = cardRefs.current.find((card) => card !== null)?.offsetWidth || 220;
      const deltaX = event.clientX - pointer.lastX;
      pointer.lastX = event.clientX;
      if (Math.abs(deltaX) > 0.1) push(-deltaX / Math.max(cardWidth * 0.72, 150));
      event.preventDefault();
    }
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    const pointer = pointerRef.current;
    if (!pointer.dragging || pointer.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may already have released capture after pointer cancellation.
      }
    }
    event.currentTarget.dataset.dragging = "false";
    pointer.dragging = false;
    if (pointer.moved) {
      clickBlockUntilRef.current = event.timeStamp + 280;
      event.preventDefault();
      settle();
    }
  }

  function handleCardClick(event: MouseEvent<HTMLButtonElement>, album: Album, index: number) {
    if (event.timeStamp < clickBlockUntilRef.current) return;
    if (activeIndexRef.current === index) {
      onOpenAlbum?.(album);
      return;
    }
    moveToIndex(index);
  }

  const meta = activeAlbum
    ? [activeAlbum.year ? String(activeAlbum.year) : "", `${activeAlbum.song_count} ${t("count")}`]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <section className="artist-album-cover-flow">
      <div
        ref={stageRef}
        className="artist-album-cover-flow-stage"
        data-dragging="false"
        role="region"
        tabIndex={0}
        aria-label={t("artistAlbumDisplayShowcase")}
        onWheel={(event) => {
          if (total < 2) return;
          event.preventDefault();
          const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
          push(clamp(delta, -240, 240) / 230);
          scheduleSettle(170);
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            syncPosition(positionRef.current + 1);
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            syncPosition(positionRef.current - 1);
          }
          if (event.key === "Enter" && activeAlbum) {
            event.preventDefault();
            onOpenAlbum?.(activeAlbum);
          }
          if (event.key === " " && activeAlbum) {
            event.preventDefault();
            onPlayAlbum?.(activeAlbum);
          }
        }}
      >
        <div className="artist-album-cover-flow-ambience" aria-hidden="true" />
        <div className="artist-album-cover-flow-cards">
          {albums.map((album, index) => (
            <button
              key={album.id}
              ref={(node) => {
                cardRefs.current[index] = node;
              }}
              type="button"
              className="artist-album-cover-flow-card"
              data-active={index === activeIndex ? "true" : "false"}
              tabIndex={-1}
              aria-label={`${t("albums")} · ${album.title}`}
              aria-hidden={index !== activeIndex}
              onClick={(event) => handleCardClick(event, album, index)}
            >
              <span className="artist-album-cover-flow-face">
                <span className="cover plain-cover">
                  <AlbumCoverImage src={`/api/albums/${album.id}/cover`} />
                  <Record weight="fill" />
                </span>
                <span className="artist-album-cover-flow-shine" aria-hidden="true" />
              </span>
              <span className="artist-album-cover-flow-reflection" aria-hidden="true">
                <span className="cover plain-cover">
                  <AlbumCoverImage src={`/api/albums/${album.id}/cover`} />
                  <Record weight="fill" />
                </span>
              </span>
            </button>
          ))}
        </div>

        {activeAlbum ? (
          <div
            className="artist-album-cover-flow-info"
            aria-live="polite"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="artist-album-cover-flow-open"
              disabled={!onOpenAlbum}
              onClick={() => onOpenAlbum?.(activeAlbum)}
            >
              <strong>{activeAlbum.title}</strong>
              <span>{meta}</span>
            </button>
            <button
              type="button"
              className="artist-album-cover-flow-play"
              disabled={!onPlayAlbum}
              aria-label={`${t("listenNow")} ${activeAlbum.title}`}
              onClick={() => onPlayAlbum?.(activeAlbum)}
            >
              <Play weight="fill" aria-hidden="true" />
              <span>{t("listenNow")}</span>
            </button>
          </div>
        ) : null}

        {total > 1 ? (
          <div
            className="artist-album-cover-flow-pagination"
            aria-label={t("albums")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {total <= 12 ? albums.map((album, index) => (
              <button
                key={album.id}
                type="button"
                className={index === activeIndex ? "active" : ""}
                aria-label={`${album.title} · ${index + 1} / ${total}`}
                onClick={() => moveToIndex(index)}
              />
            )) : (
              <span className="artist-album-cover-flow-count">{activeIndex + 1} / {total}</span>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ArtistAlbumCard({
  album,
  className,
  t,
  onOpenAlbum,
  onPlayAlbum,
}: {
  album: Album;
  className: string;
  t: Translate;
  onOpenAlbum?: (album: Album) => void;
  onPlayAlbum?: (album: Album) => void;
}) {
  const meta = [album.year ? String(album.year) : "", `${album.song_count} ${t("count")}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className={className}>
      <div className="cover plain-cover">
        <button
          type="button"
          className="artist-album-cover-action"
          aria-label={`${t("play")} ${album.title}`}
          onClick={() => onPlayAlbum?.(album)}
        >
          <AlbumCoverImage src={`/api/albums/${album.id}/cover`} />
          <Record weight="fill" />
        </button>
        <button
          type="button"
          className="card-play"
          aria-label={`${t("listenNow")} ${album.title}`}
          onClick={() => onPlayAlbum?.(album)}
        >
          <span className="card-play-label">{t("listenNow")}</span>
          <Play weight="fill" />
        </button>
      </div>
      <button
        type="button"
        className="artist-album-title"
        onClick={() => onOpenAlbum?.(album)}
      >
        {album.title}
      </button>
      <span>{meta}</span>
    </article>
  );
}

const AlbumCoverImage = memo(function AlbumCoverImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) return null;
  return (
    <img
      className="cover-image"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      onLoad={(event) => {
        event.currentTarget.dataset.loaded = "true";
      }}
      onError={() => setFailed(true)}
    />
  );
});
