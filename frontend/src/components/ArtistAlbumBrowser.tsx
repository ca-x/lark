import type { MouseEvent, PointerEvent } from "react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Play, Record } from "@phosphor-icons/react";

import type { TKey } from "../i18n";
import type { Album, ArtistAlbumDisplayStyle } from "../types";

type Translate = (key: TKey) => string;
type ArtistAlbumCardAction = "card" | "cover" | "title" | "play";

type ArtistAlbumBrowserProps = {
  albums: Album[];
  displayStyle: ArtistAlbumDisplayStyle;
  resetKey: string | number;
  t: Translate;
  onOpenAlbum?: (album: Album) => void;
  onPlayAlbum?: (album: Album) => void;
};

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
  const looping = albums.length > 1;
  const items = useMemo(
    () => (looping ? [...albums, ...albums, ...albums] : albums),
    [albums, looping],
  );
  const showcaseRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({
    pointerId: 0,
    startX: 0,
    scrollLeft: 0,
    dragging: false,
    moved: false,
  });
  const clickBlockUntilRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [displayIndex, setDisplayIndex] = useState(looping ? albums.length : 0);

  useLayoutEffect(() => {
    const node = showcaseRef.current;
    const startIndex = looping ? albums.length : 0;
    setActiveIndex(0);
    setDisplayIndex(startIndex);
    if (!node) return;
    window.requestAnimationFrame(() => {
      scrollCardIntoCenter(startIndex, "auto");
    });
  }, [albums.length, looping, resetKey]);

  function scrollCardIntoCenter(index: number, behavior: ScrollBehavior) {
    const node = showcaseRef.current;
    const child = node?.children[index];
    if (!(node && child instanceof HTMLElement)) return;
    const left = child.offsetLeft + child.offsetWidth / 2 - node.clientWidth / 2;
    node.scrollTo({ left, behavior });
  }

  useEffect(() => {
    const node = showcaseRef.current;
    if (!node || !("ResizeObserver" in window)) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => scrollCardIntoCenter(displayIndex, "auto"));
    });
    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [displayIndex, items.length]);

  function updateIndex() {
    const node = showcaseRef.current;
    if (!node) return;
    const center = node.scrollLeft + node.clientWidth / 2;
    let nextDisplayIndex = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    Array.from(node.children).forEach((child, index) => {
      if (!(child instanceof HTMLElement)) return;
      const childCenter = child.offsetLeft + child.offsetWidth / 2;
      const distance = Math.abs(childCenter - center);
      if (distance < minDistance) {
        minDistance = distance;
        nextDisplayIndex = index;
      }
    });

    const nextActiveIndex = albums.length ? nextDisplayIndex % albums.length : 0;
    setDisplayIndex(nextDisplayIndex);
    setActiveIndex(nextActiveIndex);
    if (!looping) return;
    if (nextDisplayIndex >= albums.length && nextDisplayIndex < albums.length * 2) return;

    const middleIndex = albums.length + nextActiveIndex;
    window.requestAnimationFrame(() => {
      scrollCardIntoCenter(middleIndex, "auto");
      setDisplayIndex(middleIndex);
    });
  }

  function scrollToIndex(index: number) {
    const targetIndex = looping ? albums.length + index : index;
    scrollToDisplayIndex(targetIndex);
    setActiveIndex(index);
  }

  function scrollToDisplayIndex(targetIndex: number) {
    scrollCardIntoCenter(targetIndex, "smooth");
    setActiveIndex(albums.length ? targetIndex % albums.length : 0);
    setDisplayIndex(targetIndex);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const node = showcaseRef.current;
    if (!node) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: node.scrollLeft,
      dragging: true,
      moved: false,
    };
    node.dataset.dragging = "false";
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events may not have an active pointer to capture.
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const node = showcaseRef.current;
    const drag = dragRef.current;
    if (!node || !drag.dragging || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 4) {
      drag.moved = true;
      node.dataset.dragging = "true";
      event.preventDefault();
    }
    if (drag.moved) node.scrollLeft = drag.scrollLeft - deltaX;
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const node = showcaseRef.current;
    const drag = dragRef.current;
    if (!node || !drag.dragging || drag.pointerId !== event.pointerId) return;
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    node.dataset.dragging = "false";
    drag.dragging = false;
    if (drag.moved) {
      clickBlockUntilRef.current = Date.now() + 350;
      event.preventDefault();
      updateIndex();
      return;
    }

    const targetCard = (event.target as HTMLElement | null)?.closest(".artist-album-card");
    const targetIndex = Array.from(node.children).findIndex((child) => child === targetCard);
    if (targetIndex >= 0 && targetIndex !== displayIndex) {
      clickBlockUntilRef.current = Date.now() + 350;
      event.preventDefault();
      event.stopPropagation();
      scrollToDisplayIndex(targetIndex);
    }
  }

  function shouldBlockClick(event: MouseEvent<HTMLElement>) {
    if (Date.now() > clickBlockUntilRef.current) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function guardCardAction(event: MouseEvent<HTMLElement>, index: number) {
    if (shouldBlockClick(event)) return true;
    if (index === displayIndex) return false;
    event.preventDefault();
    event.stopPropagation();
    scrollToDisplayIndex(index);
    return true;
  }

  function cardClassName(index: number) {
    const distance = index - displayIndex;
    const absDistance = Math.abs(distance);
    const direction = distance < 0 ? "left" : distance > 0 ? "right" : "center";
    if (absDistance === 0) return "artist-album-card active showcase-center";
    if (absDistance === 1) return `artist-album-card showcase-side showcase-${direction}`;
    if (absDistance === 2) return `artist-album-card showcase-far showcase-${direction}`;
    return `artist-album-card showcase-hidden showcase-${direction}`;
  }

  return (
    <>
      <div
        ref={showcaseRef}
        className="artist-album-grid artist-album-grid-showcase"
        onScroll={updateIndex}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        {items.map((album, index) => (
          <ArtistAlbumCard
            key={`${album.id}-${index}`}
            album={album}
            className={cardClassName(index)}
            t={t}
            onOpenAlbum={onOpenAlbum}
            onPlayAlbum={onPlayAlbum}
            onBeforeAction={(event) => guardCardAction(event, index)}
            isActive={index === displayIndex}
            variant="showcase"
          />
        ))}
      </div>
      <div className="artist-album-showcase-dots" aria-label={t("albums")}>
        {albums.map((album, index) => (
          <button
            key={album.id}
            type="button"
            className={index === activeIndex ? "active" : ""}
            aria-label={`${t("albums")} ${index + 1}`}
            onClick={() => scrollToIndex(index)}
          />
        ))}
      </div>
    </>
  );
}

function ArtistAlbumCard({
  album,
  className,
  t,
  onOpenAlbum,
  onPlayAlbum,
  onBeforeAction,
  isActive = true,
  variant = "classic",
}: {
  album: Album;
  className: string;
  t: Translate;
  onOpenAlbum?: (album: Album) => void;
  onPlayAlbum?: (album: Album) => void;
  onBeforeAction?: (event: MouseEvent<HTMLElement>, action: ArtistAlbumCardAction) => boolean;
  isActive?: boolean;
  variant?: "classic" | "showcase";
}) {
  const meta = [album.year ? String(album.year) : "", `${album.song_count} ${t("count")}`]
    .filter(Boolean)
    .join(" · ");

  if (variant === "showcase") {
    return (
      <button
        type="button"
        className={className}
        data-active={isActive ? "true" : "false"}
        aria-label={`${t("listenNow")} ${album.title}`}
        onClick={(event) => {
          if (onBeforeAction?.(event, "card")) return;
          onPlayAlbum?.(album);
        }}
      >
        <span className="cover plain-cover">
          <AlbumCoverImage src={`/api/albums/${album.id}/cover`} />
          <Record weight="fill" />
        </span>
        <span className="card-play" aria-hidden="true">
          <span className="card-play-label">{t("listenNow")}</span>
          <Play weight="fill" />
        </span>
        <strong className="artist-album-title">{album.title}</strong>
        <span className="artist-album-meta">{meta}</span>
      </button>
    );
  }

  return (
    <article
      className={className}
      data-active={isActive ? "true" : "false"}
      onClickCapture={(event) => {
        if (isActive) return;
        onBeforeAction?.(event, "card");
      }}
    >
      <div className="cover plain-cover">
        <button
          type="button"
          className="artist-album-cover-action"
          aria-label={`${t("play")} ${album.title}`}
          onClick={(event) => {
            if (onBeforeAction?.(event, "cover")) return;
            onPlayAlbum?.(album);
          }}
        >
          <AlbumCoverImage src={`/api/albums/${album.id}/cover`} />
          <Record weight="fill" />
        </button>
        <button
          type="button"
          className="card-play"
          aria-label={`${t("listenNow")} ${album.title}`}
          onClick={(event) => {
            event.stopPropagation();
            if (onBeforeAction?.(event, "play")) return;
            onPlayAlbum?.(album);
          }}
        >
          <span className="card-play-label">{t("listenNow")}</span>
          <Play weight="fill" />
        </button>
      </div>
      <button
        type="button"
        className="artist-album-title"
        onClick={(event) => {
          if (onBeforeAction?.(event, "title")) return;
          onOpenAlbum?.(album);
        }}
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
