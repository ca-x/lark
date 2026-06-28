import type { CSSProperties, KeyboardEvent, RefObject, WheelEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [stageEntered, setStageEntered] = useState(false);
  const [selectedShelfIndex, setSelectedShelfIndex] = useState(0);
  const displayTitle = title?.trim() || "Lark";
  const displayArtist = artist?.trim() || "Unknown artist";
  const displayAlbum = album?.trim() || "Now Playing";
  const liveLyric = activeLyricText?.trim() || displayTitle;
  const shelfItems = useMemo(() => playlists.slice(0, 6), [playlists]);
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

  useEffect(() => {
    if (selectedShelfIndex >= shelfItems.length) setSelectedShelfIndex(0);
  }, [selectedShelfIndex, shelfItems.length]);

  const enterStage = () => {
    setStageEntered(true);
  };

  const handleSplashKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    enterStage();
  };

  const moveShelfSelection = (direction: number) => {
    if (shelfItems.length < 2) return;
    setSelectedShelfIndex((current) => (current + direction + shelfItems.length) % shelfItems.length);
  };

  const handleShelfWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (shelfItems.length < 2) return;
    event.preventDefault();
    moveShelfSelection(event.deltaY > 0 ? 1 : -1);
  };

  const handleShelfKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveShelfSelection(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveShelfSelection(-1);
    }
  };

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
      data-entered={stageEntered ? "true" : "false"}
      style={stageStyle}
    >
      <canvas ref={canvasRef} className="mineradio-stage-canvas" aria-hidden="true" />
      <span className="mineradio-stage-vignette" aria-hidden="true" />
      <span className="mineradio-stage-scanline" aria-hidden="true" />
      <span className="mineradio-stage-noise" aria-hidden="true" />
      <span className="mineradio-stage-curtain mineradio-stage-curtain-left" aria-hidden="true" />
      <span className="mineradio-stage-curtain mineradio-stage-curtain-right" aria-hidden="true" />

      <button
        type="button"
        className="mineradio-stage-splash"
        aria-label="点击进入 Lark radio"
        aria-hidden={stageEntered ? "true" : undefined}
        tabIndex={stageEntered ? -1 : 0}
        onClick={enterStage}
        onKeyDown={handleSplashKeyDown}
      >
        <span className="mineradio-stage-splash-word" aria-hidden="true">
          <span className="mineradio-stage-splash-mine">Lark</span>
          <span className="mineradio-stage-splash-radio">radio</span>
        </span>
        <span className="mineradio-stage-splash-line" aria-hidden="true" />
        <span className="mineradio-stage-splash-sub">Private visual radio</span>
        <span className="mineradio-stage-splash-enter">点击进入</span>
      </button>

      <div className="mineradio-stage-title">
        <span className="mineradio-stage-kicker">Private visual radio</span>
        <h2 data-title={displayTitle} title={displayTitle}>{displayTitle}</h2>
        <p>
          <span title={displayArtist}>{displayArtist}</span>
          <span aria-hidden="true"> / </span>
          <em title={displayAlbum}>{displayAlbum}</em>
        </p>
      </div>

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
          <div className="mineradio-stage-status" aria-hidden="true">
            <i />
            <span>{playing ? "On air" : "Standby"}</span>
          </div>

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
            <span>Live lyric</span>
            <strong>{liveLyric}</strong>
          </div>
          <div
            className="mineradio-stage-shelf"
            aria-label="3D playlist shelf"
            tabIndex={shelfItems.length ? 0 : undefined}
            onWheel={handleShelfWheel}
            onKeyDown={handleShelfKeyDown}
          >
            {shelfItems.length ? (
              shelfItems.map((playlist, index) => (
                <button
                  key={playlist.id}
                  type="button"
                  data-selected={index === selectedShelfIndex ? "true" : "false"}
                  style={{ "--shelf-index": index } as CSSProperties}
                  onFocus={() => setSelectedShelfIndex(index)}
                  onMouseEnter={() => setSelectedShelfIndex(index)}
                  onClick={() => onOpenPlaylist?.(playlist)}
                >
                  <span>{playlist.name}</span>
                  <small>{playlist.song_count} tracks</small>
                </button>
              ))
            ) : (
              <span className="mineradio-stage-empty-shelf" aria-hidden="true">
                {[0, 1, 2, 3].map((index) => (
                  <i key={index} style={{ "--shelf-index": index } as CSSProperties} />
                ))}
              </span>
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

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 90);
    camera.position.set(0, 0, 8.6);

    const aura = new THREE.Mesh(
      new THREE.CircleGeometry(2.55, 96),
      new THREE.MeshBasicMaterial({
        color: 0xfff0b8,
        transparent: true,
        opacity: playing ? 0.16 : 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    aura.position.set(-1.7, -0.08, -2.7);
    aura.scale.set(1.55, 0.66, 1);
    scene.add(aura);

    const beamGroup = new THREE.Group();
    const cyanBeams = new THREE.LineSegments(
      makeLightBeamGeometry(56, -1),
      new THREE.LineBasicMaterial({
        color: 0x9cffdf,
        transparent: true,
        opacity: immersiveStage ? 0.2 : 0.13,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const goldBeams = new THREE.LineSegments(
      makeLightBeamGeometry(34, 1),
      new THREE.LineBasicMaterial({
        color: 0xfff0b8,
        transparent: true,
        opacity: immersiveStage ? 0.13 : 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    beamGroup.add(cyanBeams, goldBeams);
    scene.add(beamGroup);

    const particleGeometry = makeParticleGeometry(960);
    const particleMaterial = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.026,
      transparent: true,
      opacity: playing ? 0.78 : 0.52,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const shelf = new THREE.Group();
    shelf.visible = immersiveStage;
    shelf.position.set(2.85, -0.2, -0.72);
    shelf.rotation.set(-0.06, -0.58, 0.025);
    if (playlists.length) {
      playlists.forEach((playlist, index) => {
        const card = makeShelfCard(playlist, index);
        card.position.set(0, (index - 2.5) * -0.38, index * -0.24);
        card.rotation.y = index * 0.035;
        shelf.add(card);
      });
    } else {
      for (let index = 0; index < 5; index += 1) {
        const card = makeGhostShelfCard(index);
        card.position.set(0, (index - 2) * -0.36, index * -0.26);
        card.rotation.y = index * 0.035;
        shelf.add(card);
      }
    }
    scene.add(shelf);

    const resize = () => {
      const parent = canvas.parentElement;
      const width = Math.max(1, parent?.clientWidth || canvas.clientWidth || 1);
      const height = Math.max(1, parent?.clientHeight || canvas.clientHeight || 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    resize();

    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame += 0.01;
      particles.rotation.z += playing ? 0.0019 : 0.0008;
      particles.rotation.y = Math.sin(frame * 0.72) * 0.045;
      aura.scale.x = 1.55 + Math.sin(frame * 1.7) * (playing ? 0.045 : 0.018);
      aura.material.opacity = playing ? 0.14 + Math.sin(frame * 1.4) * 0.025 : 0.1;
      beamGroup.rotation.z = Math.sin(frame * 0.28) * 0.015;
      shelf.visible = immersiveStage;
      shelf.position.y = -0.2 + Math.sin(frame * 1.2) * (playing ? 0.035 : 0.018);
      shelf.children.forEach((child, index) => {
        child.position.x = Math.sin(frame * 1.6 + index) * 0.04;
        child.rotation.z = Math.sin(frame + index) * 0.01;
      });
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    if (reduceMotion) renderer.render(scene, camera);
    else tick();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach(disposeMaterial);
        else if (material) disposeMaterial(material);
      });
      renderer.dispose();
    };
  }, [canvasRef, immersiveStage, playing, playlistSignature, playlists]);
}

function makeParticleGeometry(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const cyan = new THREE.Color(0x9cffdf);
  const blue = new THREE.Color(0x8fe9ff);
  const gold = new THREE.Color(0xfff0b8);
  for (let index = 0; index < count; index += 1) {
    const lane = index / count;
    const angle = lane * Math.PI * 34;
    const radius = 0.52 + Math.pow(lane, 0.58) * 4.55;
    positions[index * 3] = Math.cos(angle) * radius + seeded(index, 2.4) * 0.42;
    positions[index * 3 + 1] = Math.sin(angle * 0.78) * radius * 0.36 + seeded(index, 5.2) * 0.28;
    positions[index * 3 + 2] = -3.5 + seeded(index, 9.1) * 4.4;

    const color = index % 11 === 0 ? gold : index % 4 === 0 ? blue : cyan;
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function makeLightBeamGeometry(count: number, direction: -1 | 1) {
  const positions = new Float32Array(count * 2 * 3);
  for (let index = 0; index < count; index += 1) {
    const lane = count <= 1 ? 0 : index / (count - 1);
    const base = index * 6;
    const startX = -1.35 + seeded(index, 3.1) * 0.8;
    const startY = -0.1 + seeded(index, 4.7) * 0.44;
    const endX = direction * (1.1 + lane * 4.8 + seeded(index, 8.3) * 0.7);
    const endY = 2.95 - lane * 2.4 + seeded(index, 6.4) * 0.68;
    positions[base] = startX;
    positions[base + 1] = startY;
    positions[base + 2] = -3.2 + seeded(index, 2.2) * 0.7;
    positions[base + 3] = endX;
    positions[base + 4] = endY;
    positions[base + 5] = -5.1 + seeded(index, 7.1) * 1.2;
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
    bg.addColorStop(0, "#f4fbff");
    bg.addColorStop(0.06, "#20262e");
    bg.addColorStop(0.52, accent.bg);
    bg.addColorStop(1, "#050608");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 700);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.fillRect(0, 0, 512, 74);
    ctx.strokeStyle = "rgba(255,255,255,.24)";
    ctx.lineWidth = 7;
    ctx.strokeRect(22, 22, 468, 656);
    ctx.fillStyle = accent.dot;
    ctx.globalAlpha = 0.86;
    ctx.beginPath();
    ctx.arc(382, 182, 104, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.26)";
    ctx.lineWidth = 2;
    for (let line = 0; line < 7; line += 1) {
      const y = 108 + line * 23;
      ctx.beginPath();
      ctx.moveTo(52, y);
      ctx.lineTo(312 + line * 8, y - 20);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#f7fbff";
    ctx.font = "900 52px Inter, system-ui, sans-serif";
    wrapCanvasText(ctx, playlist.name || "Playlist", 54, 392, 396, 62, 3);
    ctx.fillStyle = "rgba(247,251,255,.68)";
    ctx.font = "800 26px Inter, system-ui, sans-serif";
    ctx.fillText(`${playlist.song_count || 0} tracks`, 54, 604);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 1.58), material);
  return mesh;
}

function makeGhostShelfCard(index: number) {
  const material = new THREE.MeshBasicMaterial({
    color: index % 2 ? 0xfff0b8 : 0x9cffdf,
    transparent: true,
    opacity: 0.075,
    side: THREE.DoubleSide,
    wireframe: true,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(1.16, 1.58, 2, 3), material);
}

function disposeMaterial(material: THREE.Material) {
  const mapped = material as THREE.Material & { map?: THREE.Texture | null };
  mapped.map?.dispose();
  material.dispose();
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
