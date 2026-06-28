import type { CSSProperties, RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";
import * as THREE from "three";

import type { Playlist } from "../../types";
import type { PlayerThemePlayMode } from "./types";
import { useCoverFallback } from "./useCoverFallback";

type MineradioStagePlayerProps = {
  cover?: string;
  playing: boolean;
  progress?: number;
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
  playMode?: PlayerThemePlayMode;
  playModeLabel?: string;
  immersiveStage?: boolean;
  activeLyricText?: string;
  playlists?: Playlist[];
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
  onOpenPlaylist?: (playlist: Playlist) => void;
};

export function MineradioStagePlayer({
  cover,
  playing,
  progress = 0,
  duration = 0,
  title = "Lark",
  artist = "Sonora",
  album = "Now Playing",
  playMode = "sequence",
  playModeLabel = "Play mode",
  immersiveStage = false,
  activeLyricText = "",
  playlists = [],
  onToggle,
  onPrevious,
  onNext,
  onCyclePlayMode,
  onSeek,
  onOpenPlaylist,
}: MineradioStagePlayerProps) {
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const canSeek = Boolean(duration && onSeek);
  const coverState = useCoverFallback(cover);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shelfItems = useMemo(() => playlists.slice(0, 5), [playlists]);
  const playlistSignature = useMemo(
    () => shelfItems.map((item) => `${item.id}:${item.name}:${item.song_count}:${item.cover_theme}`).join("|"),
    [shelfItems],
  );

  useMineradioStageScene(canvasRef, {
    playing,
    immersiveStage,
    playlistSignature,
    playlists: shelfItems,
  });

  const playModeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;
  const stageStyle = {
    "--mineradio-progress": `${(pct * 100).toFixed(2)}%`,
    ...(coverState.coverImage ? { "--mineradio-cover": coverState.coverImage } : {}),
  } as CSSProperties;

  return (
    <div
      className="mineradio-stage-player"
      data-playing={playing ? "true" : "false"}
      data-immersive={immersiveStage ? "true" : "false"}
      style={stageStyle}
    >
      <canvas ref={canvasRef} className="mineradio-stage-canvas" aria-hidden="true" />
      <span className="mineradio-stage-vignette" aria-hidden="true" />
      <span className="mineradio-stage-scanline" aria-hidden="true" />

      <div className="mineradio-stage-core">
        <button
          type="button"
          className="mineradio-stage-art"
          data-has-cover={coverState.hasCover ? "true" : "false"}
          aria-label={playing ? "Pause" : "Play"}
          disabled={!onToggle}
          onClick={onToggle}
        >
          <span className="mineradio-stage-art-glow" aria-hidden="true" />
          <span className="mineradio-stage-disc" aria-hidden="true" />
          <span className="mineradio-stage-cover">
            {coverState.displayUrl ? (
              <img src={coverState.displayUrl} alt="" loading="eager" decoding="async" onError={coverState.onCoverError} />
            ) : (
              <strong>{initials(artist, title)}</strong>
            )}
          </span>
        </button>

        <div className="mineradio-stage-console">
          <span className="mineradio-stage-kicker">Private visual radio</span>
          <h2 title={title}>{title}</h2>
          <p>
            <span title={artist}>{artist}</span>
            <span aria-hidden="true"> / </span>
            <em title={album}>{album}</em>
          </p>

          <div className="mineradio-stage-progress">
            <time>{formatTime(progress)}</time>
            <div className="mineradio-stage-progress-rail">
              <span aria-hidden="true"><i /></span>
              <input
                aria-label="Position"
                type="range"
                min="0"
                max={Math.max(0, duration || 0)}
                step="0.01"
                value={Math.min(progress, duration || progress || 0)}
                disabled={!canSeek}
                onChange={(event) => onSeek?.(Number(event.target.value))}
              />
            </div>
            <time>{formatTime(duration || 0)}</time>
          </div>

          <div className="mineradio-stage-controls">
            <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
            <button type="button" className="mineradio-stage-play" aria-label={playing ? "Pause" : "Play"} disabled={!onToggle} onClick={onToggle}>
              {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
            </button>
            <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
            <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>
              {playModeIcon}
            </button>
          </div>
        </div>
      </div>

      {immersiveStage ? (
        <div className="mineradio-stage-immersive">
          <div className="mineradio-stage-lyrics" aria-live="polite">
            <span>Lyrics stage</span>
            <strong>{activeLyricText || title}</strong>
          </div>
          <div className="mineradio-stage-shelf" aria-label="3D playlist shelf">
            {shelfItems.length ? (
              shelfItems.map((playlist, index) => (
                <button
                  key={playlist.id}
                  type="button"
                  style={{ "--shelf-index": index } as CSSProperties}
                  onClick={() => onOpenPlaylist?.(playlist)}
                >
                  <span>{playlist.name}</span>
                  <small>{playlist.song_count} tracks</small>
                </button>
              ))
            ) : (
              <span className="mineradio-stage-empty-shelf">No playlists</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function useMineradioStageScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: {
    playing: boolean;
    immersiveStage: boolean;
    playlistSignature: string;
    playlists: Playlist[];
  },
) {
  const { playing, immersiveStage, playlistSignature, playlists } = options;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 0, 8);

    const particleGeometry = makeParticleGeometry(620);
    const particleMaterial = new THREE.PointsMaterial({
      color: 0x9cffdf,
      size: 0.024,
      transparent: true,
      opacity: playing ? 0.72 : 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const shelf = new THREE.Group();
    shelf.visible = immersiveStage;
    shelf.position.set(2.35, -0.05, -0.35);
    shelf.rotation.set(-0.04, -0.48, 0.02);
    playlists.forEach((playlist, index) => {
      const card = makeShelfCard(playlist, index);
      card.position.set(0, (index - 2) * -0.44, index * -0.26);
      card.rotation.y = index * 0.035;
      shelf.add(card);
    });
    scene.add(shelf);

    const resize = () => {
      const parent = canvas.parentElement;
      const width = Math.max(1, parent?.clientWidth || canvas.clientWidth || 1);
      const height = Math.max(1, parent?.clientHeight || canvas.clientHeight || 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    resize();

    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame += 0.01;
      particles.rotation.z += playing ? 0.0016 : 0.0007;
      particles.rotation.y = Math.sin(frame * 0.72) * 0.035;
      shelf.visible = immersiveStage;
      shelf.position.y = Math.sin(frame * 1.2) * (playing ? 0.035 : 0.018);
      shelf.children.forEach((child, index) => {
        child.position.x = Math.sin(frame * 1.6 + index) * 0.035;
        child.rotation.z = Math.sin(frame + index) * 0.01;
      });
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      renderer.dispose();
    };
  }, [canvasRef, immersiveStage, playing, playlistSignature, playlists]);
}

function makeParticleGeometry(count: number) {
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const lane = index / count;
    const angle = lane * Math.PI * 18;
    const radius = 0.6 + Math.pow(lane, 0.55) * 3.9;
    positions[index * 3] = Math.cos(angle) * radius + seeded(index, 2.4) * 0.32;
    positions[index * 3 + 1] = Math.sin(angle * 0.74) * radius * 0.42 + seeded(index, 5.2) * 0.24;
    positions[index * 3 + 2] = -2.8 + seeded(index, 9.1) * 3.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function makeShelfCard(playlist: Playlist, index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 700;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const accent = shelfAccent(playlist.cover_theme, index);
    const bg = ctx.createLinearGradient(0, 0, 512, 700);
    bg.addColorStop(0, "#15191f");
    bg.addColorStop(0.52, accent.bg);
    bg.addColorStop(1, "#050608");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 700);
    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = 8;
    ctx.strokeRect(24, 24, 464, 652);
    ctx.fillStyle = accent.dot;
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    ctx.arc(386, 170, 92, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#f7fbff";
    ctx.font = "800 54px Inter, system-ui, sans-serif";
    wrapCanvasText(ctx, playlist.name || "Playlist", 56, 410, 390, 64, 3);
    ctx.fillStyle = "rgba(247,251,255,.68)";
    ctx.font = "700 28px Inter, system-ui, sans-serif";
    ctx.fillText(`${playlist.song_count || 0} tracks`, 56, 604);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 1.58), material);
  return mesh;
}

function shelfAccent(theme: string, index: number) {
  const presets = [
    { bg: "#183a42", dot: "#9cffdf" },
    { bg: "#33233f", dot: "#fff0b8" },
    { bg: "#24395a", dot: "#8fe9ff" },
    { bg: "#3d291d", dot: "#f4d28a" },
  ];
  const hash = Array.from(theme || "").reduce((sum, char) => sum + char.charCodeAt(0), index);
  return presets[Math.abs(hash) % presets.length];
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let lineCount = 0;
  for (const word of words.length ? words : [text]) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineCount * lineHeight);
      line = word;
      lineCount += 1;
      if (lineCount >= maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line && lineCount < maxLines) ctx.fillText(line, x, y + lineCount * lineHeight);
}

function seeded(index: number, salt: number) {
  return Math.sin((index + 1) * 127.1 + salt * 311.7) * 0.5;
}

function initials(artist?: string, title?: string) {
  const value = [artist?.trim()[0], title?.trim()[0]]
    .filter(Boolean)
    .join("")
    .toUpperCase();
  return value.slice(0, 2) || "L";
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
