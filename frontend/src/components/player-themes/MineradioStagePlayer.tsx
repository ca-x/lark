import type { AnimationEvent, CSSProperties, KeyboardEvent, RefObject, WheelEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";
import * as THREE from "three";

import type { Playlist } from "../../types";
import type { PlayerThemePlayMode } from "./types";
import { PaperShaderLayer } from "./PaperShaderLayer";
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
  audioElement?: HTMLAudioElement | null;
  playlists?: Playlist[];
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
  onOpenPlaylist?: (playlist: Playlist) => void;
};

const SPLASH_PARTICLES = Array.from({ length: 54 }, (_, index) => index);
const SPLASH_STREAKS = Array.from({ length: 16 }, (_, index) => index);
const SPLASH_SHARDS = Array.from({ length: 24 }, (_, index) => index);
const LYRIC_RIVER_PARTICLES = Array.from({ length: 22 }, (_, index) => index);
const STAGE_SMOKE_PLUMES = Array.from({ length: 7 }, (_, index) => index);
const STAGE_SPECTRUM_BARS = Array.from({ length: 24 }, (_, index) => index);
const COVER_DOM_PARTICLES = Array.from({ length: 220 }, (_, index) => index);

type LightBeamMotion = {
  attribute: THREE.BufferAttribute;
  positions: Float32Array;
  basePositions: Float32Array;
  direction: -1 | 1;
  phaseOffset: number;
  amplitude: number;
};

type CoverParticlePayload = {
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture;
  edgeTexture: THREE.Texture;
  coverCanvas: HTMLCanvasElement;
  hasCover: boolean;
  marker: "sampled" | "fallback";
};

type CoverRipple = {
  x: number;
  y: number;
  age: number;
  strength: number;
};

const COVER_PLANE_SIZE = 3.36;
const COVER_RIPPLE_COUNT = 12;
const COVER_EDGE_TEXTURE_SIZE = 256;
const COVER_RIPPLE_REGIONS = Array.from({ length: 9 }, (_, index) => {
  const x = index % 3;
  const y = Math.floor(index / 3);
  return {
    x: (x / 2 - 0.5) * COVER_PLANE_SIZE * 0.74,
    y: (0.5 - y / 2) * COVER_PLANE_SIZE * 0.74,
  };
});

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
  audioElement = null,
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const splashCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const coverDragMovedRef = useRef(false);
  const [stageEntered, setStageEntered] = useState(false);
  const [splashReady, setSplashReady] = useState(false);
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

  useMineradioStageScene(rootRef, canvasRef, {
    playing,
    immersiveStage,
    coverUrl: coverState.displayUrl,
    audioElement,
    playlistSignature,
    playlists: shelfItems,
    selectedShelfIndex,
    coverDragMovedRef,
  });
  useMineradioSplashShader(splashCanvasRef, !stageEntered);

  useEffect(() => {
    if (selectedShelfIndex >= shelfItems.length) setSelectedShelfIndex(0);
  }, [selectedShelfIndex, shelfItems.length]);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motionQuery.matches) setSplashReady(true);
    const handleMotionChange = (event: MediaQueryListEvent) => {
      if (event.matches) setSplashReady(true);
    };
    motionQuery.addEventListener("change", handleMotionChange);
    return () => motionQuery.removeEventListener("change", handleMotionChange);
  }, []);

  const enterStage = () => {
    setStageEntered(true);
  };

  const handleSplashKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    enterStage();
  };

  const handleSplashWordmarkEnd = (event: AnimationEvent<HTMLSpanElement>) => {
    if (event.animationName === "mineradio-stage-splash-radio") setSplashReady(true);
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
      ref={rootRef}
      className="mineradio-stage-player"
      data-playing={playing ? "true" : "false"}
      data-immersive={immersiveStage ? "true" : "false"}
      data-entered={stageEntered ? "true" : "false"}
      data-splash-ready={splashReady ? "true" : "false"}
      data-has-shelf={shelfItems.length ? "true" : "false"}
      data-cover-renderer="webgl-primary"
      style={stageStyle}
    >
      <span className="mineradio-stage-backdrop" aria-hidden="true" />
      <PaperShaderLayer variant="mineradio" playing={playing} cover={coverState.displayUrl} />
      <canvas ref={canvasRef} className="mineradio-stage-canvas" aria-hidden="true" />
      <span className="mineradio-stage-depth-grid" aria-hidden="true" />
      <span className="mineradio-stage-light-slit" aria-hidden="true"><i /><i /></span>
      <span className="mineradio-stage-smoke" aria-hidden="true">
        {STAGE_SMOKE_PLUMES.map((index) => (
          <i
            key={index}
            style={{
              "--smoke-index": index,
              "--smoke-x": `${10 + index * 13 + Math.round(seeded(index, 11.4) * 8)}%`,
              "--smoke-y": `${22 + (index % 4) * 16 + Math.round(seeded(index, 12.8) * 8)}%`,
              "--smoke-scale": (0.8 + (index % 4) * 0.18).toFixed(2),
              "--smoke-delay": `${index * -1.1}s`,
            } as CSSProperties}
          />
        ))}
      </span>
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
        <canvas ref={splashCanvasRef} className="mineradio-stage-splash-canvas" aria-hidden="true" />
        <span className="mineradio-stage-splash-particles" aria-hidden="true">
          {SPLASH_PARTICLES.map((index) => (
            <i
              key={index}
              style={{
                "--particle-index": index,
                "--particle-x": `${Math.round(6 + (seeded(index, 1.7) + 0.5) * 88)}%`,
                "--particle-y": `${Math.round(8 + (seeded(index, 2.9) + 0.5) * 78)}%`,
                "--particle-delay": `${(index % 13) * -0.41}s`,
                "--particle-duration": `${4.8 + (index % 7) * 0.42}s`,
                "--particle-scale": (0.72 + (index % 5) * 0.12).toFixed(2),
              } as CSSProperties}
            />
          ))}
        </span>
        <span className="mineradio-stage-splash-streaks" aria-hidden="true">
          {SPLASH_STREAKS.map((index) => (
            <i
              key={index}
              style={{
                "--streak-index": index,
                "--streak-y": `${Math.round(18 + (index / Math.max(1, SPLASH_STREAKS.length - 1)) * 62)}%`,
                "--streak-delay": `${(index % 8) * -0.36}s`,
                "--streak-duration": `${3.6 + (index % 5) * 0.38}s`,
                "--streak-length": `${120 + (index % 6) * 26}px`,
                "--streak-angle": `${-10 + (index % 5) * 5}deg`,
              } as CSSProperties}
            />
          ))}
        </span>
        <span className="mineradio-stage-splash-shards" aria-hidden="true">
          {SPLASH_SHARDS.map((index) => (
            <i
              key={index}
              style={{
                "--shard-index": index,
                "--shard-x": `${Math.round(18 + (seeded(index, 7.3) + 0.5) * 64)}%`,
                "--shard-y": `${Math.round(42 + (seeded(index, 8.8) + 0.5) * 18)}%`,
                "--shard-delay": `${(index % 10) * -0.18}s`,
                "--shard-width": `${28 + (index % 7) * 13}px`,
              } as CSSProperties}
            />
          ))}
        </span>
        <span className="mineradio-stage-splash-word" aria-hidden="true">
          <span className="mineradio-stage-splash-mine">Lark</span>
          <span className="mineradio-stage-splash-radio" onAnimationEnd={handleSplashWordmarkEnd}>radio</span>
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
          onClick={(event) => {
            if (coverDragMovedRef.current) {
              event.preventDefault();
              coverDragMovedRef.current = false;
              return;
            }
            onToggle?.();
          }}
        >
          <span className="mineradio-stage-art-glow" aria-hidden="true" />
          <span className="mineradio-stage-disc" aria-hidden="true" />
          <span className="mineradio-stage-cover-cloud" data-cover-dom-particles="fallback-orbit" aria-hidden="true">
            {COVER_DOM_PARTICLES.map((index) => {
              const ratio = COVER_DOM_PARTICLES.length <= 1 ? 0 : index / (COVER_DOM_PARTICLES.length - 1);
              const angle = index * 137.508 + seeded(index, 4.2) * 28;
              const radius = 12 + Math.pow(ratio, 0.72) * 45 + seededUnit(index, 8.6) * 9;
              const x = 50 + Math.cos((angle * Math.PI) / 180) * radius;
              const y = 50 + Math.sin((angle * Math.PI) / 180) * radius * 0.82;
              return (
                <i
                  key={index}
                  style={{
                    "--cloud-x": `${x.toFixed(2)}%`,
                    "--cloud-y": `${y.toFixed(2)}%`,
                    "--cloud-z": `${(-38 + seededUnit(index, 3.7) * 76).toFixed(1)}px`,
                    "--cloud-size": `${(1.35 + seededUnit(index, 5.4) * 2.35).toFixed(2)}px`,
                    "--cloud-alpha": (0.22 + Math.pow(ratio, 0.48) * 0.6 + seededUnit(index, 6.9) * 0.18).toFixed(2),
                    "--cloud-delay": `${(index % 37) * -0.12}s`,
                    "--cloud-duration": `${5.6 + (index % 11) * 0.34}s`,
                    "--cloud-drift-x": `${(seeded(index, 9.1) * 18).toFixed(1)}px`,
                    "--cloud-drift-y": `${(seeded(index, 10.4) * 14).toFixed(1)}px`,
                    "--cloud-scale": (0.76 + seededUnit(index, 12.2) * 0.74).toFixed(2),
                  } as CSSProperties}
                />
              );
            })}
          </span>
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
          <div className="mineradio-stage-spectrum" aria-hidden="true">
            {STAGE_SPECTRUM_BARS.map((index) => (
              <i
                key={index}
                style={{
                  "--spectrum-index": index,
                  "--spectrum-height": `${24 + ((index * 17) % 58)}%`,
                  "--spectrum-delay": `${index * -0.055}s`,
                } as CSSProperties}
              />
            ))}
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
            <span className="mineradio-stage-lyric-river" aria-hidden="true">
              {LYRIC_RIVER_PARTICLES.map((index) => (
                <i
                  key={index}
                  style={{
                    "--river-index": index,
                    "--river-x": `${Math.round((index / Math.max(1, LYRIC_RIVER_PARTICLES.length - 1)) * 100)}%`,
                    "--river-lane": index % 5,
                    "--river-delay": `${(index % 11) * -0.34}s`,
                  } as CSSProperties}
                />
              ))}
            </span>
            <strong key={liveLyric} data-lyric-text={liveLyric}>
              <span className="mineradio-stage-lyric-glow" aria-hidden="true">{liveLyric}</span>
              <span className="mineradio-stage-lyric-text">{liveLyric}</span>
            </strong>
          </div>
          {shelfItems.length ? (
            <div
              className="mineradio-stage-shelf"
              data-shelf-hit-layer="webgl"
              aria-label="3D playlist shelf"
              tabIndex={0}
              onWheel={handleShelfWheel}
              onKeyDown={handleShelfKeyDown}
            >
              {shelfItems.map((playlist, index) => {
                const delta = index - selectedShelfIndex;
                const absDelta = Math.abs(delta);
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    data-motion-card="true"
                    data-selected={index === selectedShelfIndex ? "true" : "false"}
                    style={{
                      "--shelf-index": index,
                      "--shelf-delta": delta,
                      "--shelf-abs-delta": absDelta,
                      "--shelf-parity": index % 2 === 0 ? 1 : -1,
                    } as CSSProperties}
                    onFocus={() => setSelectedShelfIndex(index)}
                    onMouseEnter={() => setSelectedShelfIndex(index)}
                    onClick={() => onOpenPlaylist?.(playlist)}
                  >
                    <span>{playlist.name}</span>
                    <small>{playlist.song_count} tracks</small>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function useMineradioSplashShader(canvasRef: RefObject<HTMLCanvasElement | null>, active: boolean) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      canvas.setAttribute("data-mineradio-splash-shader", "reduced-motion");
      return;
    }

    const gl = (canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    }) || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) {
      canvas.setAttribute("data-mineradio-splash-shader", "unavailable");
      return;
    }

    const program = makeSplashShaderProgram(gl);
    if (!program) {
      canvas.setAttribute("data-mineradio-splash-shader", "compile-failed");
      return;
    }
    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      canvas.setAttribute("data-mineradio-splash-shader", "buffer-failed");
      return;
    }

    const uniforms = {
      position: gl.getAttribLocation(program, "aPosition"),
      resolution: gl.getUniformLocation(program, "uResolution"),
      time: gl.getUniformLocation(program, "uTime"),
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    const resize = () => {
      const parent = canvas.parentElement;
      const width = Math.max(1, parent?.clientWidth || canvas.clientWidth || 1);
      const height = Math.max(1, parent?.clientHeight || canvas.clientHeight || 1);
      const ratio = Math.min(1.6, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    resize();

    let raf = 0;
    const startedAt = performance.now();
    const draw = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(uniforms.position);
      gl.vertexAttribPointer(uniforms.position, 2, gl.FLOAT, false, 0, 0);
      if (uniforms.resolution) gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      if (uniforms.time) gl.uniform1f(uniforms.time, elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(draw);
    };
    canvas.setAttribute("data-mineradio-splash-shader", "original-loop");
    draw();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [canvasRef, active]);
}

function useMineradioStageScene(
  rootRef: RefObject<HTMLDivElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: {
    playing: boolean;
    immersiveStage: boolean;
    coverUrl: string;
    audioElement: HTMLAudioElement | null;
    playlistSignature: string;
    playlists: Playlist[];
    selectedShelfIndex: number;
    coverDragMovedRef: { current: boolean };
  },
) {
  const { playing, immersiveStage, coverUrl, audioElement, playlistSignature, playlists, selectedShelfIndex, coverDragMovedRef } = options;
  const playingRef = useRef(playing);
  const selectedShelfIndexRef = useRef(selectedShelfIndex);
  const previousCoverCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    selectedShelfIndexRef.current = selectedShelfIndex;
  }, [selectedShelfIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rootElement = canvas.parentElement;
    canvas.removeAttribute("data-webgl-unavailable");
    rootElement?.removeAttribute("data-webgl-unavailable");
    const contextAttributes: WebGLContextAttributes = {
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    };
    const context = canvas.getContext("webgl2", contextAttributes) || canvas.getContext("webgl", contextAttributes);
    if (!context) {
      canvas.setAttribute("data-webgl-unavailable", "true");
      rootElement?.setAttribute("data-webgl-unavailable", "true");
      console.warn("Mineradio Stage WebGL unavailable; using DOM motion layers only.");
      return;
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, context, ...contextAttributes });
    } catch (error) {
      canvas.setAttribute("data-webgl-unavailable", "true");
      rootElement?.setAttribute("data-webgl-unavailable", "true");
      console.warn("Mineradio Stage WebGL unavailable; using DOM motion layers only.", error);
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 90);
    camera.position.set(0, 0, 8.6);

    const pointerTarget = new THREE.Vector2(0, 0);
    const pointerParallax = new THREE.Vector2(0, 0);
    const gestureRotation = new THREE.Vector2(0, 0);
    const particleSpin = new THREE.Vector2(0, 0);
    const dragState = {
      active: false,
      pointerId: -1,
      lastX: 0,
      lastY: 0,
      lastAt: 0,
      total: 0,
    };
    let dragBurstPulse = 0;
    let dragScatterPulse = 0;
    const clampParticleSpinVelocity = (value: number) => Math.max(-6.2, Math.min(6.2, Number.isFinite(value) ? value : 0));
    const applyParticleSpinDrag = (dx: number, dy: number, dt: number) => {
      const rx = dy * 0.0032;
      const ry = dx * 0.0034;
      gestureRotation.x += rx;
      gestureRotation.y += ry;
      if (dt > 0) {
        particleSpin.x = clampParticleSpinVelocity((rx / dt) * 0.46);
        particleSpin.y = clampParticleSpinVelocity((ry / dt) * 0.46);
      }
    };
    const rebaseGestureRotation = () => {
      const limit = Math.PI * 10;
      if (Math.abs(gestureRotation.x) > limit) gestureRotation.x -= Math.round(gestureRotation.x / (Math.PI * 2)) * Math.PI * 2;
      if (Math.abs(gestureRotation.y) > limit) gestureRotation.y -= Math.round(gestureRotation.y / (Math.PI * 2)) * Math.PI * 2;
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointerTarget.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointerTarget.y = -(((event.clientY - rect.top) / rect.height - 0.5) * 2);
      if (!dragState.active || event.pointerId !== dragState.pointerId) return;
      const now = performance.now();
      const dt = Math.max(1 / 120, Math.min(0.08, (now - dragState.lastAt) / 1000 || 1 / 60));
      const dx = event.clientX - dragState.lastX;
      const dy = event.clientY - dragState.lastY;
      dragState.total += Math.hypot(dx, dy);
      if (dragState.total > 6) coverDragMovedRef.current = true;
      applyParticleSpinDrag(dx, dy, dt);
      rebaseGestureRotation();
      dragState.lastX = event.clientX;
      dragState.lastY = event.clientY;
      dragState.lastAt = now;
      dragBurstPulse = Math.max(dragBurstPulse, 0.16);
      dragScatterPulse = Math.max(dragScatterPulse, 0.028);
      rootElement?.style.setProperty("--mineradio-cover-drag", Math.min(1, dragState.total / 120).toFixed(3));
    };
    const onPointerLeave = () => {
      pointerTarget.set(0, 0);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (reduceMotion || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".mineradio-stage-art")) return;
      dragState.active = true;
      dragState.pointerId = event.pointerId;
      dragState.lastX = event.clientX;
      dragState.lastY = event.clientY;
      dragState.lastAt = performance.now();
      dragState.total = 0;
      coverDragMovedRef.current = false;
      rootElement?.setPointerCapture?.(event.pointerId);
      rootElement?.setAttribute("data-cover-gesture", "dragging");
      canvas.setAttribute("data-cover-gesture", "drag-inertia");
    };
    const endPointerDrag = (event: PointerEvent) => {
      if (!dragState.active || event.pointerId !== dragState.pointerId) return;
      dragState.active = false;
      dragState.pointerId = -1;
      rootElement?.releasePointerCapture?.(event.pointerId);
      rootElement?.setAttribute("data-cover-gesture", "inertia");
      window.setTimeout(() => {
        if (!dragState.active) {
          rootElement?.removeAttribute("data-cover-gesture");
          rootElement?.style.removeProperty("--mineradio-cover-drag");
        }
      }, 460);
    };
    rootElement?.addEventListener("pointerdown", onPointerDown);
    rootElement?.addEventListener("pointermove", onPointerMove, { passive: true });
    rootElement?.addEventListener("pointerleave", onPointerLeave, { passive: true });
    rootElement?.addEventListener("pointerup", endPointerDrag);
    rootElement?.addEventListener("pointercancel", endPointerDrag);

    const aura = new THREE.Mesh(
      new THREE.CircleGeometry(2.55, 96),
      new THREE.MeshBasicMaterial({
        color: 0xfff0b8,
        transparent: true,
        opacity: playingRef.current ? 0.16 : 0.1,
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
    const cyanBeamSweep = new THREE.LineSegments(
      makeLightBeamGeometry(16, -1),
      new THREE.LineBasicMaterial({
        color: 0x9cffdf,
        transparent: true,
        opacity: 0.045,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const goldBeamSweep = new THREE.LineSegments(
      makeLightBeamGeometry(12, 1),
      new THREE.LineBasicMaterial({
        color: 0xfff0b8,
        transparent: true,
        opacity: 0.035,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    beamGroup.add(cyanBeams, goldBeams, cyanBeamSweep, goldBeamSweep);
    scene.add(beamGroup);
    const cyanBeamMotion = makeLightBeamMotion(cyanBeams, -1, 0.2, 1);
    const goldBeamMotion = makeLightBeamMotion(goldBeams, 1, 1.8, 0.78);
    const cyanSweepMotion = makeLightBeamMotion(cyanBeamSweep, -1, 3.1, 1.42);
    const goldSweepMotion = makeLightBeamMotion(goldBeamSweep, 1, 4.4, 1.2);

    const particleGeometry = makeParticleGeometry(reduceMotion ? 520 : 1800);
    const particlePositionAttribute = particleGeometry.getAttribute("position") as THREE.BufferAttribute;
    const particlePositions = particlePositionAttribute.array as Float32Array;
    const particleBasePositions = particlePositions.slice();
    const particleMaterial = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.024,
      transparent: true,
      opacity: playingRef.current ? 0.78 : 0.52,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const coverParticleTargetCount = chooseCoverParticleTargetCount(reduceMotion);
    let coverTexture: THREE.Texture = makeFallbackCoverTexture();
    let prevCoverTexture: THREE.Texture = makeTextureFromCoverCanvas(previousCoverCanvasRef.current || makeFallbackCoverCanvas());
    let edgeTexture: THREE.Texture = makeFallbackCoverEdgeTexture();
    const dotTexture = makeDotTexture();
    let coverParticleGeometry = makeFallbackCoverParticleGeometry(coverParticleTargetCount);
    const coverRippleUniforms = Array.from({ length: COVER_RIPPLE_COUNT }, () => new THREE.Vector4(0, 0, -10, 0));
    const coverUniforms = makeCoverParticleUniforms(coverTexture, prevCoverTexture, edgeTexture, dotTexture, coverRippleUniforms, false);
    const coverBloomUniforms = makeCoverParticleUniforms(coverTexture, prevCoverTexture, edgeTexture, dotTexture, coverRippleUniforms, true);
    const coverParticleMaterial = makeCoverParticleShaderMaterial(coverUniforms, false);
    const coverParticles = new THREE.Points(coverParticleGeometry, coverParticleMaterial);
    coverParticles.position.set(-1.7, -0.12, -0.9);
    coverParticles.rotation.set(-0.03, 0.14, -0.02);
    scene.add(coverParticles);

    const coverBloomMaterial = makeCoverParticleShaderMaterial(coverBloomUniforms, true);
    const coverBloomParticles = new THREE.Points(coverParticleGeometry, coverBloomMaterial);
    coverBloomParticles.position.copy(coverParticles.position);
    coverBloomParticles.rotation.copy(coverParticles.rotation);
    coverBloomParticles.scale.set(1.045, 1.045, 1.045);
    scene.add(coverBloomParticles);

    const coverHalo = new THREE.Mesh(
      new THREE.RingGeometry(1.55, 1.76, 96),
      new THREE.MeshBasicMaterial({
        color: 0x9cffdf,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    coverHalo.position.copy(coverParticles.position);
    coverHalo.position.z -= 0.12;
    scene.add(coverHalo);

    let coverColorMixRaf = 0;
    const startCoverColorMix = (durationMs: number) => {
      cancelAnimationFrame(coverColorMixRaf);
      const startedAt = performance.now();
      const duration = Math.max(1, durationMs);
      coverUniforms.uColorMixT.value = 0;
      coverBloomUniforms.uColorMixT.value = 0;
      const step = (now: number) => {
        const raw = Math.min(1, (now - startedAt) / duration);
        const eased = raw * raw * (3 - raw * 2);
        coverUniforms.uColorMixT.value = eased;
        coverBloomUniforms.uColorMixT.value = eased;
        if (raw < 1) coverColorMixRaf = requestAnimationFrame(step);
        else coverColorMixRaf = 0;
      };
      coverColorMixRaf = requestAnimationFrame(step);
    };
    const setCoverParticlePayload = (payload: CoverParticlePayload) => {
      if (coverParticleGeometry !== payload.geometry) coverParticleGeometry.dispose();
      if (coverTexture !== payload.texture) coverTexture.dispose();
      if (edgeTexture !== payload.edgeTexture) edgeTexture.dispose();
      const nextPrevCoverTexture = makeTextureFromCoverCanvas(previousCoverCanvasRef.current || makeFallbackCoverCanvas());
      prevCoverTexture.dispose();
      prevCoverTexture = nextPrevCoverTexture;
      coverParticleGeometry = payload.geometry;
      coverTexture = payload.texture;
      edgeTexture = payload.edgeTexture;
      previousCoverCanvasRef.current = cloneCoverCanvas(payload.coverCanvas);
      coverUniforms.uPrevCoverTex.value = prevCoverTexture;
      coverBloomUniforms.uPrevCoverTex.value = prevCoverTexture;
      coverUniforms.uCoverTex.value = coverTexture;
      coverBloomUniforms.uCoverTex.value = coverTexture;
      coverUniforms.uEdgeTex.value = edgeTexture;
      coverBloomUniforms.uEdgeTex.value = edgeTexture;
      coverUniforms.uHasCover.value = payload.hasCover ? 1 : 0;
      coverBloomUniforms.uHasCover.value = payload.hasCover ? 1 : 0;
      coverUniforms.uHasDepth.value = payload.hasCover ? 1 : 0.45;
      coverBloomUniforms.uHasDepth.value = payload.hasCover ? 1 : 0.45;
      coverUniforms.uBurst.value = Math.max(coverUniforms.uBurst.value, payload.hasCover ? 0.36 : 0.18);
      coverBloomUniforms.uBurst.value = Math.max(coverBloomUniforms.uBurst.value, payload.hasCover ? 0.36 : 0.18);
      coverParticles.geometry = coverParticleGeometry;
      coverBloomParticles.geometry = coverParticleGeometry;
      canvas.setAttribute("data-cover-particles", payload.marker);
      canvas.setAttribute("data-cover-shader", payload.hasCover ? "texture-uniform" : "fallback-uniform");
      canvas.setAttribute("data-cover-depth", payload.hasCover ? "edge-texture" : "fallback-depth");
      canvas.setAttribute("data-cover-crossfade", "prev-cover-texture");
      canvas.setAttribute("data-cover-grid", String(coverParticleGeometry.userData.coverGrid || ""));
      startCoverColorMix(payload.hasCover ? 820 : 360);
    };

    let coverLoadCancelled = false;
    void loadCoverParticlePayload(coverUrl, coverParticleTargetCount).then((payload) => {
      if (coverLoadCancelled) {
        payload.geometry.dispose();
        payload.texture.dispose();
        payload.edgeTexture.dispose();
        return;
      }
      setCoverParticlePayload(payload);
    });

    const shelf = new THREE.Group();
    shelf.visible = immersiveStage;
    shelf.position.set(3.28, -0.2, -0.72);
    shelf.rotation.set(-0.06, -0.58, 0.025);
    shelf.scale.setScalar(0.88);
    playlists.forEach((playlist, index) => {
      const card = makeShelfCard(playlist, index);
      const baseY = (index - 2.5) * -0.38;
      const baseZ = index * -0.24;
      card.position.set(0, baseY, baseZ);
      card.rotation.y = index * 0.035;
      card.userData.baseX = 0;
      card.userData.baseY = baseY;
      card.userData.baseZ = baseZ;
      card.userData.phase = index * 0.71 + seeded(index, 4.4);
      card.userData.slot = index;
      shelf.add(card);
    });
    scene.add(shelf);
    const shelfExtras = makeShelfExtras(dotTexture);
    shelfExtras.connector.position.set(2.08, -2.1, -0.34);
    shelfExtras.floor.position.set(2.14, -2.58, -0.22);
    scene.add(shelfExtras.connector, shelfExtras.floor);
    canvas.setAttribute("data-shelf-extras", "connector-floor");

    const resize = () => {
      const parent = canvas.parentElement;
      const width = Math.max(1, parent?.clientWidth || canvas.clientWidth || 1);
      const height = Math.max(1, parent?.clientHeight || canvas.clientHeight || 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      coverUniforms.uPixel.value = renderer.getPixelRatio();
      coverBloomUniforms.uPixel.value = renderer.getPixelRatio();
      shelfExtras.uniforms.uPixel.value = renderer.getPixelRatio();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    resize();

    let previousFrameAt = performance.now();
    let elapsed = 0;
    let visualEnergy = playingRef.current ? 0.72 : 0.28;
    let beatPulse = 0;
    let bass = 0;
    let vocal = 0;
    let mid = 0;
    let treble = 0;
    let bassPeak = 0.032;
    let vocalPeak = 0.026;
    let midPeak = 0.024;
    let treblePeak = 0.018;
    let energyPeak = 0.032;
    let previousEnergy = 0;
    let lyricSun = 0;
    let cameraPunch = 0;
    let burstPulse = 0;
    let scatterPulse = 0;
    let rippleCursor = 0;
    let lastBeatAt = -10;
    const coverRipples: CoverRipple[] = Array.from({ length: COVER_RIPPLE_COUNT }, () => ({ x: 0, y: 0, age: -10, strength: 0 }));
    let spectrumPaintAt = 0;
    let analyserState = makeAudioAnalyser(audioElement);
    const spectrumBars = () => rootRef.current?.querySelectorAll<HTMLElement>(".mineradio-stage-spectrum i") || [];
    const syncAudioReactiveMarker = () => {
      const marker = analyserState.analyser ? "true" : "fallback";
      canvas.setAttribute("data-audio-reactive", marker);
      if (rootRef.current) rootRef.current.dataset.audioReactive = marker;
    };
    syncAudioReactiveMarker();
    let analyserRetryAt = 0;
    let raf = 0;
    const sampleAudioMetrics = (elapsed: number, delta: number) => {
      const isPlaying = playingRef.current;
      if (!analyserState.analyser && audioElement && isPlaying && !audioElement.paused && elapsed - analyserRetryAt > 0.45) {
        analyserRetryAt = elapsed;
        analyserState.dispose();
        analyserState = makeAudioAnalyser(audioElement);
        syncAudioReactiveMarker();
      }
      if (analyserState.context?.state === "suspended" && isPlaying) void analyserState.context.resume().catch(() => undefined);
      if (analyserState.analyser && analyserState.frequencyData && analyserState.timeDomainData && audioElement && isPlaying && !audioElement.paused) {
        analyserState.analyser.getByteFrequencyData(analyserState.frequencyData);
        analyserState.analyser.getByteTimeDomainData(analyserState.timeDomainData);
        const freq = analyserState.frequencyData;
        const sampleRate = analyserState.context?.sampleRate || 44100;
        const fftSize = analyserState.analyser.fftSize;
        const rawBass = averageFrequencyBand(freq, sampleRate, fftSize, 60, 150);
        const rawVocal = averageFrequencyBand(freq, sampleRate, fftSize, 200, 3000);
        const rawMid = averageFrequencyBand(freq, sampleRate, fftSize, 3000, 6000);
        const rawTreble = averageFrequencyBand(freq, sampleRate, fftSize, 6000, sampleRate / 2);
        let rms = 0;
        for (let index = 0; index < analyserState.timeDomainData.length; index += 1) {
          const value = (analyserState.timeDomainData[index] - 128) / 128;
          rms += value * value;
        }
        rms = Math.sqrt(rms / analyserState.timeDomainData.length);
        bassPeak = Math.max(bassPeak * 0.994, rawBass, 0.032);
        vocalPeak = Math.max(vocalPeak * 0.993, rawVocal, 0.026);
        midPeak = Math.max(midPeak * 0.993, rawMid, 0.024);
        treblePeak = Math.max(treblePeak * 0.992, rawTreble, 0.018);
        energyPeak = Math.max(energyPeak * 0.995, rms, 0.032);
        const nextBass = Math.min(1, Math.pow(rawBass / Math.max(0.04, bassPeak * 0.66), 0.76));
        const nextVocal = Math.min(1, Math.pow(rawVocal / Math.max(0.03, vocalPeak * 0.7), 0.84));
        const nextMid = Math.min(1, Math.pow(rawMid / Math.max(0.03, midPeak * 0.7), 0.86));
        const nextTreble = Math.min(1, Math.pow(rawTreble / Math.max(0.022, treblePeak * 0.74), 0.9));
        const nextEnergy = Math.min(1, Math.pow(rms / Math.max(0.034, energyPeak * 0.68), 0.82));
        const bassOnset = Math.max(0, nextBass - bass);
        const energyOnset = Math.max(0, nextEnergy - previousEnergy);
        const onset = Math.max(bassOnset, energyOnset);
        previousEnergy += (nextEnergy - previousEnergy) * 0.14;
        const beatHit = elapsed - lastBeatAt > 0.16 && nextBass > 0.34 && bassOnset > 0.065 && energyOnset > 0.012;
        if (beatHit) {
          lastBeatAt = elapsed;
          const impact = Math.min(1, bassOnset * 2.9 + energyOnset * 1.15 + nextBass * 0.22);
          beatPulse = Math.max(beatPulse, Math.min(0.92, 0.22 + impact * 0.72));
          cameraPunch = Math.max(cameraPunch, 0.16 + impact * 0.48);
          burstPulse = Math.max(burstPulse, 0.34 + impact * 0.42);
          scatterPulse = Math.max(scatterPulse, 0.025 + impact * 0.06);
          rippleCursor = triggerCoverRegionRipples(coverRipples, rippleCursor, elapsed, impact, 2 + (impact > 0.56 ? 1 : 0));
        } else {
          beatPulse = Math.max(beatPulse * Math.pow(0.34, delta), Math.min(0.42, onset * 1.08));
        }
        bass += (nextBass - bass) * (nextBass > bass ? 0.28 : 0.07);
        vocal += (nextVocal - vocal) * (nextVocal > vocal ? 0.16 : 0.052);
        mid += (nextMid - mid) * (nextMid > mid ? 0.2 : 0.06);
        treble += (nextTreble - treble) * (nextTreble > treble ? 0.18 : 0.055);
        visualEnergy += (Math.min(1, nextEnergy * 0.74 + bass * 0.14 + vocal * 0.06 + mid * 0.08) - visualEnergy) * 0.13;
      } else {
        const fallbackEnergy = isPlaying ? 0.58 + Math.sin(elapsed * 1.18) * 0.08 + Math.sin(elapsed * 2.74) * 0.035 : 0.22;
        const fallbackBeat = isPlaying ? Math.pow(Math.max(0, Math.sin(elapsed * 2.45) * 0.72 + Math.sin(elapsed * 5.1) * 0.28), 4) : 0;
        if (fallbackBeat > 0.62 && elapsed - lastBeatAt > 0.42) {
          lastBeatAt = elapsed;
          cameraPunch = Math.max(cameraPunch, 0.24);
          burstPulse = Math.max(burstPulse, 0.36);
          scatterPulse = Math.max(scatterPulse, 0.045);
          rippleCursor = triggerCoverRegionRipples(coverRipples, rippleCursor, elapsed, fallbackBeat, 2);
        }
        beatPulse += (fallbackBeat - beatPulse) * (fallbackBeat > beatPulse ? 0.34 : 0.08);
        bass += ((isPlaying ? fallbackBeat * 0.52 + 0.16 : 0) - bass) * 0.08;
        vocal += ((isPlaying ? 0.18 + Math.max(0, Math.sin(elapsed * 1.34 + 0.2)) * 0.16 : 0) - vocal) * 0.06;
        mid += ((isPlaying ? 0.22 + Math.max(0, Math.sin(elapsed * 1.7 + 0.5)) * 0.18 : 0) - mid) * 0.07;
        treble += ((isPlaying ? 0.16 + Math.max(0, Math.sin(elapsed * 2.6 + 1.8)) * 0.16 : 0) - treble) * 0.065;
        visualEnergy += (fallbackEnergy - visualEnergy) * (fallbackEnergy > visualEnergy ? 0.09 : 0.045);
      }
      if (elapsed - spectrumPaintAt > 0.055) {
        spectrumPaintAt = elapsed;
        spectrumBars().forEach((bar, index, bars) => {
          const ratio = bars.length <= 1 ? 0 : index / (bars.length - 1);
          const wave = 0.26 + Math.sin(elapsed * (1.4 + ratio * 1.8) + index * 0.72) * 0.12;
          const level = Math.max(0.08, Math.min(1.24, wave + bass * (1 - ratio) * 0.62 + mid * (1 - Math.abs(ratio - 0.48) * 1.7) * 0.48 + treble * ratio * 0.44 + beatPulse * 0.52));
          bar.style.setProperty("--spectrum-level", level.toFixed(3));
        });
      }
      rootRef.current?.style.setProperty("--mineradio-audio-energy", visualEnergy.toFixed(3));
      rootRef.current?.style.setProperty("--mineradio-audio-bass", bass.toFixed(3));
      rootRef.current?.style.setProperty("--mineradio-audio-mid", mid.toFixed(3));
      rootRef.current?.style.setProperty("--mineradio-audio-treble", treble.toFixed(3));
      rootRef.current?.style.setProperty("--mineradio-audio-beat", beatPulse.toFixed(3));
      const lyricSunRaw = Math.max(0, Math.min(1, visualEnergy * 0.22 + vocal * 0.2 + mid * 0.3 + treble * 0.22 + beatPulse * 0.14 - 0.08));
      lyricSun += (lyricSunRaw - lyricSun) * (lyricSunRaw > lyricSun ? 0.075 : 0.03);
      rootRef.current?.style.setProperty("--mineradio-lyric-solar", lyricSun.toFixed(3));
      rootRef.current?.style.setProperty("--mineradio-lyric-glow", Math.min(1, lyricSun * 0.72 + beatPulse * 0.28).toFixed(3));
    };
    const tick = (frameAt = performance.now()) => {
      const delta = Math.min(Math.max((frameAt - previousFrameAt) / 1000, 0), 0.05);
      previousFrameAt = frameAt;
      elapsed += delta;
      sampleAudioMetrics(elapsed, delta);
      const isPlaying = playingRef.current;

      for (let index = 0; index < particlePositions.length / 3; index += 1) {
        const offset = index * 3;
        const phase = index * 0.071;
        const lane = (index % 37) / 37;
        const drift = 0.025 + visualEnergy * 0.055 + beatPulse * 0.05;
        particlePositions[offset] = particleBasePositions[offset] + Math.sin(elapsed * (0.42 + lane * 0.26) + phase) * drift;
        particlePositions[offset + 1] = particleBasePositions[offset + 1] + Math.cos(elapsed * (0.34 + lane * 0.18) + phase * 1.7) * drift * 0.72;
        particlePositions[offset + 2] = particleBasePositions[offset + 2] + Math.sin(elapsed * 0.26 + phase * 2.1) * (0.035 + beatPulse * 0.06);
      }
      particlePositionAttribute.needsUpdate = true;

      particles.rotation.z += (isPlaying ? 0.12 : 0.046) * delta;
      particles.rotation.y = Math.sin(elapsed * 0.72) * (0.06 + visualEnergy * 0.025);
      particles.rotation.x = Math.cos(elapsed * 0.52) * (0.018 + visualEnergy * 0.02);
      particleMaterial.opacity = isPlaying ? 0.66 + visualEnergy * 0.22 + beatPulse * 0.08 : 0.44;
      particleMaterial.size = 0.022 + visualEnergy * 0.008 + beatPulse * 0.008;

      if (Math.abs(particleSpin.x) > 0.0001 || Math.abs(particleSpin.y) > 0.0001) {
        gestureRotation.x += particleSpin.x * delta;
        gestureRotation.y += particleSpin.y * delta;
        rebaseGestureRotation();
      }
      particleSpin.x *= Math.pow(0.9, delta * 60);
      particleSpin.y *= Math.pow(0.9, delta * 60);
      if (Math.abs(particleSpin.x) < 0.01) particleSpin.x = 0;
      if (Math.abs(particleSpin.y) < 0.01) particleSpin.y = 0;
      burstPulse = Math.max(burstPulse, dragBurstPulse);
      scatterPulse = Math.max(scatterPulse, dragScatterPulse);
      dragBurstPulse *= Math.pow(0.42, delta * 60);
      dragScatterPulse *= Math.pow(0.46, delta * 60);

      cameraPunch *= Math.pow(0.18, delta);
      burstPulse *= Math.pow(0.22, delta);
      scatterPulse *= Math.pow(0.28, delta);
      const activeRippleCount = tickCoverRippleUniforms(coverRipples, coverRippleUniforms, delta);
      coverUniforms.uRippleCount.value = activeRippleCount;
      coverBloomUniforms.uRippleCount.value = activeRippleCount;

      pointerParallax.x += (pointerTarget.x - pointerParallax.x) * 0.05;
      pointerParallax.y += (pointerTarget.y - pointerParallax.y) * 0.05;
      coverParticles.rotation.y = gestureRotation.y + 0.14 + pointerParallax.x * 0.18 + Math.sin(elapsed * 0.34) * (0.035 + mid * 0.03) + beatPulse * 0.035;
      coverParticles.rotation.x = gestureRotation.x - 0.03 - pointerParallax.y * 0.12 + Math.cos(elapsed * 0.28) * (0.018 + treble * 0.026);
      rootRef.current?.style.setProperty("--mineradio-cover-spin-x", gestureRotation.x.toFixed(4));
      rootRef.current?.style.setProperty("--mineradio-cover-spin-y", gestureRotation.y.toFixed(4));
      coverParticles.rotation.z += delta * (0.022 + bass * 0.05 + beatPulse * 0.06);
      coverParticles.scale.setScalar(1 + bass * 0.035 + beatPulse * 0.05);
      syncCoverParticleUniforms(coverUniforms, elapsed, {
        bass,
        vocal,
        mid,
        treble,
        beat: beatPulse,
        energy: visualEnergy,
        burst: burstPulse,
        scatter: scatterPulse,
        alpha: coverUrl ? Math.min(0.98, 0.64 + visualEnergy * 0.22 + beatPulse * 0.1) : 0.54,
        pointScale: 1 + bass * 0.16 + beatPulse * 0.18,
        bloomStrength: 0,
      });
      coverBloomParticles.rotation.copy(coverParticles.rotation);
      coverBloomParticles.scale.setScalar(1.045 + bass * 0.055 + beatPulse * 0.09);
      syncCoverParticleUniforms(coverBloomUniforms, elapsed, {
        bass,
        vocal,
        mid,
        treble,
        beat: beatPulse,
        energy: visualEnergy,
        burst: burstPulse,
        scatter: scatterPulse,
        alpha: coverUrl ? Math.min(0.42, 0.13 + bass * 0.12 + treble * 0.08 + beatPulse * 0.13) : 0.16,
        pointScale: 1.82 + bass * 0.32 + beatPulse * 0.38,
        bloomStrength: Math.min(0.72, 0.24 + bass * 0.24 + treble * 0.18 + beatPulse * 0.22),
      });
      coverHalo.rotation.z -= delta * (0.04 + bass * 0.04);
      coverHalo.scale.setScalar(1 + bass * 0.09 + beatPulse * 0.16);
      coverHalo.material.opacity = Math.min(0.24, 0.055 + visualEnergy * 0.07 + beatPulse * 0.08);

      aura.scale.x = 1.52 + Math.sin(elapsed * 1.08) * (0.04 + visualEnergy * 0.035) + beatPulse * 0.08;
      aura.scale.y = 0.64 + Math.cos(elapsed * 0.88) * 0.022 + beatPulse * 0.034;
      aura.material.opacity = isPlaying ? 0.10 + visualEnergy * 0.08 + beatPulse * 0.05 : 0.09;
      const beamSweepPulse = (0.5 + Math.sin(elapsed * 0.82) * 0.5) * (0.55 + visualEnergy * 0.45) + beatPulse * 0.35;
      animateLightBeamGeometry(cyanBeamMotion, elapsed, visualEnergy, beatPulse);
      animateLightBeamGeometry(goldBeamMotion, elapsed, visualEnergy, beatPulse);
      animateLightBeamGeometry(cyanSweepMotion, elapsed + 0.72, visualEnergy, beatPulse);
      animateLightBeamGeometry(goldSweepMotion, elapsed + 1.44, visualEnergy, beatPulse);
      beamGroup.rotation.z = Math.sin(elapsed * 0.24) * 0.03 + Math.sin(elapsed * 0.58) * 0.008;
      beamGroup.scale.x = 1 + Math.sin(elapsed * 0.36) * 0.018 + beatPulse * 0.012;
      beamGroup.scale.y = 1 + Math.cos(elapsed * 0.42) * 0.014 + beatPulse * 0.008;
      cyanBeams.material.opacity = immersiveStage ? 0.16 + visualEnergy * 0.10 + beatPulse * 0.06 : 0.12;
      goldBeams.material.opacity = immersiveStage ? 0.10 + visualEnergy * 0.07 + beatPulse * 0.05 : 0.07;
      cyanBeamSweep.material.opacity = immersiveStage ? 0.025 + beamSweepPulse * 0.085 : 0.018 + beamSweepPulse * 0.045;
      goldBeamSweep.material.opacity = immersiveStage ? 0.02 + beamSweepPulse * 0.065 : 0.014 + beamSweepPulse * 0.034;
      cyanBeamSweep.rotation.z = -0.018 + Math.sin(elapsed * 0.68) * 0.038;
      goldBeamSweep.rotation.z = 0.016 + Math.sin(elapsed * 0.62 + 1.7) * 0.032;
      camera.position.x = Math.sin(elapsed * 0.22) * (immersiveStage ? 0.11 : 0.06) + pointerParallax.x * 0.035 + Math.sin(elapsed * 4.1) * cameraPunch * 0.012;
      camera.position.y = Math.cos(elapsed * 0.18) * 0.045 + beatPulse * 0.015 + pointerParallax.y * 0.022 + Math.cos(elapsed * 3.7) * cameraPunch * 0.01;
      camera.position.z = 8.6 - cameraPunch * (immersiveStage ? 0.34 : 0.22) - beatPulse * 0.035;
      camera.lookAt(0, 0, 0);
      shelf.visible = immersiveStage;
      shelf.position.y = -0.2 + Math.sin(elapsed * 1.2) * (isPlaying ? 0.05 : 0.022);
      shelf.position.z = -0.72 + Math.cos(elapsed * 0.8) * 0.035;
      shelfExtras.connector.visible = immersiveStage && playlists.length > 0;
      shelfExtras.floor.visible = shelfExtras.connector.visible;
      shelfExtras.uniforms.uTime.value = elapsed;
      shelfExtras.uniforms.uBass.value = bass;
      shelfExtras.uniforms.uBeat.value = beatPulse;
      shelfExtras.connector.position.x = 2.08 + pointerParallax.x * 0.14;
      shelfExtras.connector.position.y = -2.1 + Math.sin(elapsed * 0.3) * 0.035 + pointerParallax.y * 0.045;
      shelfExtras.connector.rotation.y = -0.16 + pointerParallax.x * 0.035;
      shelfExtras.connector.rotation.x = pointerParallax.y * -0.018;
      shelfExtras.floor.position.x = 2.14 + pointerParallax.x * 0.1;
      shelfExtras.floor.material.opacity = immersiveStage ? Math.min(0.58, 0.34 + visualEnergy * 0.12 + beatPulse * 0.08) : 0;
      shelf.children.forEach((child, index) => {
        const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
        const phase = Number(mesh.userData.phase || index);
        const slot = Number(mesh.userData.slot || index);
        const selectedDelta = slot - selectedShelfIndexRef.current;
        const selectedLift = Math.max(0, 1 - Math.abs(selectedDelta));
        const depthFade = Math.max(0.38, 1 - Math.abs(selectedDelta) * 0.13);
        const baseX = Number(mesh.userData.baseX || 0);
        const baseY = Number(mesh.userData.baseY || 0);
        const baseZ = Number(mesh.userData.baseZ || 0);
        mesh.position.x = baseX - selectedLift * 0.16 + Math.sin(elapsed * 1.45 + phase) * (0.035 + selectedLift * 0.022);
        mesh.position.y = baseY + selectedLift * 0.11 + Math.sin(elapsed * 0.92 + phase) * (0.042 + visualEnergy * 0.018);
        mesh.position.z = baseZ + selectedLift * 0.26 + Math.cos(elapsed * 0.78 + phase) * 0.045;
        mesh.rotation.y = -0.05 + selectedDelta * 0.035 + Math.sin(elapsed * 0.5 + phase) * 0.018;
        mesh.rotation.x = -selectedDelta * 0.014 + Math.cos(elapsed * 0.44 + phase) * 0.01;
        mesh.rotation.z = Math.sin(elapsed * 0.72 + phase) * 0.012;
        mesh.scale.setScalar(1 + selectedLift * 0.075 + beatPulse * 0.026);
        mesh.material.opacity = Math.min(1, (0.62 + depthFade * 0.34 + selectedLift * 0.16 + beatPulse * 0.035) * (immersiveStage ? 1 : 0));
      });
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    if (reduceMotion) renderer.render(scene, camera);
    else tick();

    return () => {
      coverLoadCancelled = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(coverColorMixRaf);
      observer.disconnect();
      rootElement?.removeEventListener("pointerdown", onPointerDown);
      rootElement?.removeEventListener("pointermove", onPointerMove);
      rootElement?.removeEventListener("pointerleave", onPointerLeave);
      rootElement?.removeEventListener("pointerup", endPointerDrag);
      rootElement?.removeEventListener("pointercancel", endPointerDrag);
      analyserState.dispose();
      coverTexture.dispose();
      prevCoverTexture.dispose();
      edgeTexture.dispose();
      dotTexture.dispose();
      if (rootRef.current) delete rootRef.current.dataset.audioReactive;
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach(disposeMaterial);
        else if (material) disposeMaterial(material);
      });
      renderer.dispose();
    };
  }, [rootRef, canvasRef, immersiveStage, coverUrl, audioElement, playlistSignature, playlists, coverDragMovedRef]);
}

type MineradioAnalyserState = {
  context: AudioContext | null;
  analyser: AnalyserNode | null;
  frequencyData: Uint8Array<ArrayBuffer> | null;
  timeDomainData: Uint8Array<ArrayBuffer> | null;
  dispose: () => void;
};

function makeAudioAnalyser(audioElement: HTMLAudioElement | null): MineradioAnalyserState {
  if (!audioElement) return emptyAudioAnalyser();
  const capturable = audioElement as HTMLAudioElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const stream = capturable.captureStream?.() || capturable.mozCaptureStream?.();
  if (!stream || stream.getAudioTracks().length === 0) return emptyAudioAnalyser();
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return emptyAudioAnalyser();
  try {
    const context = new AudioContextCtor();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.74;
    source.connect(analyser);
    return {
      context,
      analyser,
      frequencyData: new Uint8Array(analyser.frequencyBinCount),
      timeDomainData: new Uint8Array(analyser.fftSize),
      dispose: () => {
        try {
          source.disconnect();
        } catch {
          // The node may already be disconnected during rapid theme switches.
        }
        void context.close().catch(() => undefined);
      },
    };
  } catch {
    return emptyAudioAnalyser();
  }
}

function emptyAudioAnalyser(): MineradioAnalyserState {
  return {
    context: null,
    analyser: null,
    frequencyData: null,
    timeDomainData: null,
    dispose: () => undefined,
  };
}

function averageFrequencyBand(data: Uint8Array<ArrayBuffer>, sampleRate: number, fftSize: number, startHz: number, endHz: number) {
  const binHz = sampleRate / fftSize;
  const start = Math.max(1, Math.floor(startHz / binHz));
  const end = Math.min(data.length, Math.max(start + 1, Math.ceil(endHz / binHz)));
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += data[index] / 255;
  return sum / Math.max(1, end - start);
}

function makeFallbackCoverParticleGeometry(count: number) {
  const grid = coverParticleGridForCount(count);
  const pointCount = grid * grid;
  const positions = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);
  const uvs = new Float32Array(pointCount * 2);
  const randoms = new Float32Array(pointCount);
  const lums = new Float32Array(pointCount);
  const edges = new Float32Array(pointCount);
  const depths = new Float32Array(pointCount);
  const alphas = new Float32Array(pointCount);
  const cyan = new THREE.Color(0x9cffdf);
  const blue = new THREE.Color(0x8fe9ff);
  const gold = new THREE.Color(0xfff0b8);
  for (let index = 0; index < pointCount; index += 1) {
    const gx = index % grid;
    const gy = Math.floor(index / grid);
    const u = (gx + 0.5) / grid;
    const v = (gy + 0.5) / grid;
    const x = (u - 0.5) * COVER_PLANE_SIZE;
    const y = (0.5 - v) * COVER_PLANE_SIZE;
    const dist = Math.min(1, Math.hypot(x, y) / (COVER_PLANE_SIZE * 0.58));
    const ring = Math.exp(-((dist - 0.62) ** 2) / 0.04);
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = seeded(index, 6.6) * 0.18 + ring * 0.12;
    uvs[index * 2] = u;
    uvs[index * 2 + 1] = v;
    randoms[index] = seededUnit(index, 10.2);
    lums[index] = 0.32 + ring * 0.32;
    edges[index] = ring;
    depths[index] = 0.48 + seeded(index, 7.4) * 0.28;
    alphas[index] = 0.34 + ring * 0.5;
    const color = index % 9 === 0 ? gold : index % 5 === 0 ? blue : cyan;
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  return makeCoverParticleGeometryFromAttributes({ positions, colors, uvs, randoms, lums, edges, depths, alphas, grid });
}

async function loadCoverParticlePayload(url: string, targetCount: number): Promise<CoverParticlePayload> {
  if (!url) return makeFallbackCoverParticlePayload(targetCount);
  const image = await loadImage(url).catch(() => null);
  if (!image) return makeFallbackCoverParticlePayload(targetCount);
  return makeCoverParticlePayloadFromImage(image, targetCount);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function makeFallbackCoverParticlePayload(targetCount: number): CoverParticlePayload {
  const coverCanvas = makeFallbackCoverCanvas();
  return {
    geometry: makeFallbackCoverParticleGeometry(targetCount),
    texture: makeTextureFromCoverCanvas(coverCanvas),
    edgeTexture: makeCoverEdgeDepthTexture(coverCanvas),
    coverCanvas,
    hasCover: false,
    marker: "fallback",
  };
}

function makeCoverParticlePayloadFromImage(image: HTMLImageElement, targetCount: number): CoverParticlePayload {
  const grid = coverParticleGridForCount(targetCount);
  const size = Math.max(192, Math.min(384, grid * 3));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return makeFallbackCoverParticlePayload(targetCount);
  try {
    context.clearRect(0, 0, size, size);
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const crop = Math.min(imageWidth, imageHeight);
    context.drawImage(image, (imageWidth - crop) / 2, (imageHeight - crop) / 2, crop, crop, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    const pointCount = grid * grid;
    const positions = new Float32Array(pointCount * 3);
    const colors = new Float32Array(pointCount * 3);
    const uvs = new Float32Array(pointCount * 2);
    const randoms = new Float32Array(pointCount);
    const lums = new Float32Array(pointCount);
    const edges = new Float32Array(pointCount);
    const depths = new Float32Array(pointCount);
    const alphas = new Float32Array(pointCount);
    for (let index = 0; index < pointCount; index += 1) {
      const gx = index % grid;
      const gy = Math.floor(index / grid);
      const u = (gx + 0.5) / grid;
      const v = (gy + 0.5) / grid;
      const x = Math.min(size - 1, Math.max(0, Math.round(u * (size - 1))));
      const y = Math.min(size - 1, Math.max(0, Math.round(v * (size - 1))));
      const pixel = sampleCoverPixel(pixels, size, x, y);
      const left = sampleCoverPixel(pixels, size, Math.max(0, x - 1), y).lum;
      const right = sampleCoverPixel(pixels, size, Math.min(size - 1, x + 1), y).lum;
      const up = sampleCoverPixel(pixels, size, x, Math.max(0, y - 1)).lum;
      const down = sampleCoverPixel(pixels, size, x, Math.min(size - 1, y + 1)).lum;
      const edge = Math.min(1, Math.abs(right - left) * 1.9 + Math.abs(down - up) * 1.9 + pixel.saturation * 0.12);
      const alpha = Math.max(0.14, pixel.alpha);
      const planeX = (u - 0.5) * COVER_PLANE_SIZE;
      const planeY = (0.5 - v) * COVER_PLANE_SIZE;
      positions[index * 3] = planeX;
      positions[index * 3 + 1] = planeY;
      positions[index * 3 + 2] = (pixel.lum - 0.45) * 0.32 + edge * 0.16 + seeded(index, 7.7) * 0.04;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
      randoms[index] = seededUnit(index, 10.2);
      lums[index] = pixel.lum;
      edges[index] = edge;
      depths[index] = Math.max(0, Math.min(1, 0.36 + pixel.lum * 0.42 + edge * 0.22));
      alphas[index] = alpha * Math.max(0.22, 0.36 + pixel.lum * 0.5 + edge * 0.44);
      const color = new THREE.Color(pixel.red, pixel.green, pixel.blue).lerp(new THREE.Color(0xf7fbff), edge * 0.1);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    const texture = makeTextureFromCoverCanvas(canvas);
    const edgeTexture = makeCoverEdgeDepthTexture(canvas);
    return {
      geometry: makeCoverParticleGeometryFromAttributes({ positions, colors, uvs, randoms, lums, edges, depths, alphas, grid }),
      texture,
      edgeTexture,
      coverCanvas: canvas,
      hasCover: true,
      marker: "sampled",
    };
  } catch {
    return makeFallbackCoverParticlePayload(targetCount);
  }
}

function makeCoverParticleGeometryFromAttributes(attributes: {
  positions: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  randoms: Float32Array;
  lums: Float32Array;
  edges: Float32Array;
  depths: Float32Array;
  alphas: Float32Array;
  grid: number;
}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(attributes.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(attributes.colors, 3));
  geometry.setAttribute("aUv", new THREE.BufferAttribute(attributes.uvs, 2));
  geometry.setAttribute("aRand", new THREE.BufferAttribute(attributes.randoms, 1));
  geometry.setAttribute("aLum", new THREE.BufferAttribute(attributes.lums, 1));
  geometry.setAttribute("aEdge", new THREE.BufferAttribute(attributes.edges, 1));
  geometry.setAttribute("aDepth", new THREE.BufferAttribute(attributes.depths, 1));
  geometry.setAttribute("aAlpha", new THREE.BufferAttribute(attributes.alphas, 1));
  geometry.userData.coverGrid = attributes.grid;
  return geometry;
}

function coverParticleGridForCount(targetCount: number) {
  const grid = Math.max(32, Math.min(128, Math.round(Math.sqrt(targetCount))));
  return grid % 2 ? grid : grid + 1;
}

function sampleCoverPixel(pixels: Uint8ClampedArray, size: number, x: number, y: number) {
  const offset = (y * size + x) * 4;
  const red = pixels[offset] / 255;
  const green = pixels[offset + 1] / 255;
  const blue = pixels[offset + 2] / 255;
  const alpha = pixels[offset + 3] / 255;
  const lum = red * 0.299 + green * 0.587 + blue * 0.114;
  const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
  return { red, green, blue, alpha, lum, saturation };
}

function makeDotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 31);
    gradient.addColorStop(0, "rgba(255,255,255,0.98)");
    gradient.addColorStop(0.38, "rgba(255,255,255,0.78)");
    gradient.addColorStop(0.72, "rgba(255,255,255,0.22)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function chooseCoverParticleTargetCount(reduceMotion: boolean) {
  if (reduceMotion) return 45 * 45;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const memory = nav.deviceMemory || 4;
  const width = window.innerWidth || 1024;
  if (width >= 1280 && memory >= 4) return 118 * 118;
  if (width >= 960 && memory >= 3) return 105 * 105;
  if (width >= 720) return 89 * 89;
  return 65 * 65;
}

function makeFallbackCoverCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 96, 96);
    gradient.addColorStop(0, "#102127");
    gradient.addColorStop(0.46, "#17294a");
    gradient.addColorStop(1, "#3b2d1c");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 96, 96);
    context.fillStyle = "rgba(156,255,223,.18)";
    context.beginPath();
    context.arc(48, 48, 28, 0, Math.PI * 2);
    context.fill();
  }
  return canvas;
}

function cloneCoverCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, source.width || 1);
  canvas.height = Math.max(1, source.height || 1);
  const context = canvas.getContext("2d");
  if (context) context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function makeTextureFromCoverCanvas(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function makeFallbackCoverTexture() {
  return makeTextureFromCoverCanvas(makeFallbackCoverCanvas());
}

function makeFallbackCoverEdgeTexture() {
  return makeCoverEdgeDepthTexture(makeFallbackCoverCanvas());
}

function makeCoverEdgeDepthTexture(sourceCanvas: HTMLCanvasElement) {
  const size = COVER_EDGE_TEXTURE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return makeTextureFromCoverCanvas(makeFallbackCoverCanvas());
  context.drawImage(sourceCanvas, 0, 0, size, size);
  const source = context.getImageData(0, 0, size, size);
  const total = size * size;
  const luminance = new Float32Array(total);
  const horizontal = new Float32Array(total);
  const blurred = new Float32Array(total);
  const edges = new Float32Array(total);
  const depth = new Float32Array(total);
  const foreground = new Float32Array(total);
  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    luminance[index] = (source.data[offset] * 0.299 + source.data[offset + 1] * 0.587 + source.data[offset + 2] * 0.114) / 255;
  }
  blurScalarField(luminance, horizontal, size, 5, true);
  blurScalarField(horizontal, blurred, size, 5, false);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const north = (y - 1) * size;
      const midRow = y * size;
      const south = (y + 1) * size;
      const gx =
        -blurred[north + x - 1] -
        blurred[midRow + x - 1] * 2 -
        blurred[south + x - 1] +
        blurred[north + x + 1] +
        blurred[midRow + x + 1] * 2 +
        blurred[south + x + 1];
      const gy =
        -blurred[north + x - 1] -
        blurred[north + x] * 2 -
        blurred[north + x + 1] +
        blurred[south + x - 1] +
        blurred[south + x] * 2 +
        blurred[south + x + 1];
      edges[midRow + x] = Math.min(1, Math.hypot(gx, gy) * 1.72);
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const nx = x / (size - 1) - 0.5;
      const ny = y / (size - 1) - 0.5;
      const center = Math.max(0, 1 - Math.hypot(nx, ny) * 1.52);
      const localDepth = Math.min(1, blurred[index] * 0.48 + center * 0.44 + edges[index] * 0.22);
      depth[index] = localDepth;
      foreground[index] = Math.min(1, localDepth * 0.62 + edges[index] * 0.56);
    }
  }
  const output = context.createImageData(size, size);
  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    output.data[offset] = Math.round(depth[index] * 255);
    output.data[offset + 1] = Math.round(edges[index] * 255);
    output.data[offset + 2] = Math.round(foreground[index] * 255);
    output.data[offset + 3] = Math.round(luminance[index] * 255);
  }
  context.putImageData(output, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function blurScalarField(source: Float32Array, target: Float32Array, size: number, radius: number, horizontal: boolean) {
  const span = radius * 2 + 1;
  for (let outer = 0; outer < size; outer += 1) {
    let sum = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const coord = Math.max(0, Math.min(size - 1, offset));
      sum += horizontal ? source[outer * size + coord] : source[coord * size + outer];
    }
    for (let inner = 0; inner < size; inner += 1) {
      if (horizontal) target[outer * size + inner] = sum / span;
      else target[inner * size + outer] = sum / span;
      const enter = Math.min(size - 1, inner + radius + 1);
      const leave = Math.max(0, inner - radius);
      sum += horizontal ? source[outer * size + enter] - source[outer * size + leave] : source[enter * size + outer] - source[leave * size + outer];
    }
  }
}

function makeCoverParticleUniforms(
  coverTexture: THREE.Texture,
  prevCoverTexture: THREE.Texture,
  edgeTexture: THREE.Texture,
  dotTexture: THREE.Texture,
  ripples: THREE.Vector4[],
  bloomLayer: boolean,
) {
  return {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uVocal: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uBeat: { value: 0 },
    uEnergy: { value: 0 },
    uBurst: { value: 0 },
    uScatter: { value: 0 },
    uDepth: { value: 1.0 },
    uPointScale: { value: 1.0 },
    uPixel: { value: 1.0 },
    uAlpha: { value: 0.72 },
    uBloomLayer: { value: bloomLayer ? 1 : 0 },
    uBloomStrength: { value: bloomLayer ? 0.34 : 0 },
    uHasCover: { value: 0 },
    uHasDepth: { value: 0 },
    uEdgeEnabled: { value: 1 },
    uColorMixT: { value: 1 },
    uColorBoost: { value: 1.08 },
    uCoverTex: { value: coverTexture },
    uPrevCoverTex: { value: prevCoverTexture },
    uEdgeTex: { value: edgeTexture },
    uDotTex: { value: dotTexture },
    uRipples: { value: ripples },
    uRippleCount: { value: 0 },
  };
}

function syncCoverParticleUniforms(
  uniforms: ReturnType<typeof makeCoverParticleUniforms>,
  elapsed: number,
  values: {
    bass: number;
    vocal: number;
    mid: number;
    treble: number;
    beat: number;
    energy: number;
    burst: number;
    scatter: number;
    alpha: number;
    pointScale: number;
    bloomStrength: number;
  },
) {
  uniforms.uTime.value = elapsed;
  uniforms.uBass.value = values.bass;
  uniforms.uVocal.value = values.vocal;
  uniforms.uMid.value = values.mid;
  uniforms.uTreble.value = values.treble;
  uniforms.uBeat.value = values.beat;
  uniforms.uEnergy.value = values.energy;
  uniforms.uBurst.value = values.burst;
  uniforms.uScatter.value = values.scatter;
  uniforms.uAlpha.value = values.alpha;
  uniforms.uPointScale.value = values.pointScale;
  uniforms.uBloomStrength.value = values.bloomStrength;
  uniforms.uDepth.value = 1.06 + values.bass * 0.18 + values.beat * 0.12;
  uniforms.uColorBoost.value = 1.04 + values.energy * 0.12 + values.beat * 0.06;
}

function triggerCoverRegionRipples(ripples: CoverRipple[], cursor: number, elapsed: number, strength: number, count: number) {
  const used = new Set<number>();
  let nextCursor = cursor;
  const hitCount = Math.max(1, Math.min(3, count));
  const seedBase = Math.floor(elapsed * 31) + Math.floor(strength * 97);
  for (let hit = 0; hit < hitCount; hit += 1) {
    let regionIndex = Math.floor(seededUnit(seedBase + hit * 17, 9.3) * COVER_RIPPLE_REGIONS.length) % COVER_RIPPLE_REGIONS.length;
    for (let tries = 0; used.has(regionIndex) && tries < COVER_RIPPLE_REGIONS.length; tries += 1) {
      regionIndex = (regionIndex + 1) % COVER_RIPPLE_REGIONS.length;
    }
    used.add(regionIndex);
    const region = COVER_RIPPLE_REGIONS[regionIndex];
    const jitterX = seeded(seedBase + hit * 23, 12.7) * 0.52;
    const jitterY = seeded(seedBase + hit * 29, 14.1) * 0.52;
    ripples[nextCursor] = {
      x: region.x + jitterX,
      y: region.y + jitterY,
      age: 0,
      strength: Math.max(0.34, Math.min(1.55, 0.62 + strength * 0.92 + hit * 0.06)),
    };
    nextCursor = (nextCursor + 1) % COVER_RIPPLE_COUNT;
  }
  return nextCursor;
}

function tickCoverRippleUniforms(ripples: CoverRipple[], uniforms: THREE.Vector4[], delta: number) {
  let active = 0;
  for (let index = 0; index < ripples.length; index += 1) {
    const ripple = ripples[index];
    if (ripple.age >= 0) ripple.age += delta;
    if (ripple.age > 1.85) {
      ripple.age = -10;
      ripple.strength = 0;
    }
    if (ripple.strength > 0.004 && ripple.age >= 0) active += 1;
    uniforms[index].set(ripple.x, ripple.y, ripple.age, ripple.strength);
  }
  return active > 0 ? uniforms.length : 0;
}

function makeCoverParticleShaderMaterial(uniforms: ReturnType<typeof makeCoverParticleUniforms>, bloomLayer: boolean) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: coverParticleVertexShader,
    fragmentShader: coverParticleFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: !bloomLayer,
    blending: bloomLayer ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

const coverParticleVertexShader = `
precision highp float;
uniform float uTime;
uniform float uBass;
uniform float uVocal;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform float uEnergy;
uniform float uBurst;
uniform float uScatter;
uniform float uDepth;
uniform float uPointScale;
uniform float uPixel;
uniform float uBloomLayer;
uniform float uHasCover;
uniform float uHasDepth;
uniform float uEdgeEnabled;
uniform float uColorMixT;
uniform float uColorBoost;
uniform vec4 uRipples[${COVER_RIPPLE_COUNT}];
uniform int uRippleCount;
uniform sampler2D uCoverTex;
uniform sampler2D uPrevCoverTex;
uniform sampler2D uEdgeTex;
attribute vec2 aUv;
attribute float aRand;
attribute float aLum;
attribute float aEdge;
attribute float aDepth;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
varying float vGlow;
varying float vLum;
varying float vEdge;
varying float vSourceLum;

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

float waveNoise(vec2 p, float seed) {
  float a = sin(p.x * 2.3 + p.y * 1.7 + seed);
  float b = cos(p.x * 4.1 - p.y * 2.9 + seed * 1.37);
  float c = sin((p.x + p.y) * 6.2 + seed * 0.71);
  return (a * 0.52 + b * 0.34 + c * 0.14);
}

float rippleAt(vec2 p, out float glow) {
  float sum = 0.0;
  glow = 0.0;
  for (int i = 0; i < ${COVER_RIPPLE_COUNT}; i++) {
    if (i >= uRippleCount) break;
    vec4 ripple = uRipples[i];
    float age = ripple.z;
    float strength = ripple.w;
    if (age < 0.0 || strength <= 0.001) continue;
    float life = clamp(age / 1.85, 0.0, 1.0);
    float dist = distance(p, ripple.xy);
    float waveRadius = age * (0.72 + strength * 0.55);
    float ring = exp(-pow((dist - waveRadius) / (0.13 + age * 0.08), 2.0));
    float bulge = exp(-dist * dist / (0.18 + age * 0.32));
    float fade = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.68, 1.0, life));
    float local = (ring * 0.85 + bulge * 0.42) * fade * strength;
    sum += local;
    glow = max(glow, ring * fade * strength);
  }
  return sum;
}

void main() {
  vec3 pos = position;
  vec2 centered = position.xy / ${COVER_PLANE_SIZE.toFixed(2)};
  float radial = length(centered);
  float t = uTime;
  float randPhase = aRand * 6.2831853;
  vec2 safeUv = clamp(aUv, vec2(0.002), vec2(0.998));
  vec3 nextCoverColor = texture2D(uCoverTex, safeUv).rgb;
  vec3 prevCoverColor = texture2D(uPrevCoverTex, safeUv).rgb;
  vec3 coverColor = mix(prevCoverColor, nextCoverColor, clamp(uColorMixT, 0.0, 1.0));
  vec4 edgeMap = texture2D(uEdgeTex, safeUv);
  float depthVal = mix(aDepth, edgeMap.r, uHasDepth);
  float edgeVal = max(aEdge * 0.45, edgeMap.g * uEdgeEnabled);
  float foreground = mix(aAlpha, edgeMap.b, uHasDepth);
  float sourceLum = mix(aLum, edgeMap.a, uHasDepth);
  vec3 fallbackColor = mix(vec3(0.47, 0.96, 0.88), vec3(1.0, 0.86, 0.56), smoothstep(0.12, 0.92, aUv.y));
  fallbackColor = mix(fallbackColor, vec3(0.58, 0.86, 1.0), hash11(aRand * 19.0) * 0.32);
  vec3 edgeLitCover = mix(coverColor, coverColor + vec3(0.18), edgeVal * 0.46);
  vColor = mix(fallbackColor, edgeLitCover, uHasCover);
  vColor = pow(max(vColor, vec3(0.0)), vec3(1.0 / max(0.42, uColorBoost)));

  float rippleGlow = 0.0;
  float ripple = rippleAt(position.xy, rippleGlow);
  float bodyWave = waveNoise(position.xy * (1.04 + depthVal * 0.62), t * 0.74 + randPhase);
  float trebleFizz = waveNoise(position.xy * 4.6, t * 2.8 + randPhase * 1.7);
  vec2 outward = normalize(position.xy + vec2(cos(randPhase), sin(randPhase)) * 0.04);
  float bassPush = (uBass * 0.25 + uBeat * 0.30) * (0.40 + sourceLum * 0.46 + edgeVal * 0.58);
  float vocalBreath = sin(t * (0.72 + aRand * 0.18) + centered.y * 3.2) * uVocal * 0.035;
  pos.xy += outward * (bassPush + uBurst * (0.16 + aRand * 0.19));
  pos.xy += vec2(bodyWave, waveNoise(position.yx * 1.2, t * 0.62 + randPhase)) * uMid * (0.052 + edgeVal * 0.036);
  pos.xy += vec2(cos(randPhase), sin(randPhase)) * (uScatter * (0.38 + uTreble * 0.9) + trebleFizz * uTreble * 0.024);
  pos.xy *= 1.0 + uEnergy * 0.018 + uBeat * 0.022;
  pos.z += (depthVal - 0.5) * uDepth * 1.08 * uHasCover;
  pos.z += edgeVal * (0.16 + uBeat * 0.12) * uHasCover;
  pos.z += bodyWave * uMid * 0.23 + trebleFizz * uTreble * 0.12 + uBass * (0.075 - radial * 0.045);
  pos.z += ripple * (0.68 + uBeat * 0.22) + vocalBreath;
  pos.z += (hash11(aRand * 41.0) - 0.5) * uBurst * 0.58;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float depthSize = 32.0 / max(0.85, -mvPosition.z);
  float glow = edgeVal * 0.86 + rippleGlow * 1.12 + uBeat * 0.38 + uBurst * 0.54 + uTreble * 0.22;
  float bloomMul = mix(1.0, 2.75 + glow * 0.74, uBloomLayer);
  gl_PointSize = clamp(depthSize * uPixel * uPointScale * bloomMul * (0.88 + sourceLum * 0.48 + edgeVal * 0.58 + rippleGlow * 0.24), 0.9, mix(6.8, 16.5, uBloomLayer));
  gl_Position = projectionMatrix * mvPosition;
  vLum = sourceLum;
  vEdge = edgeVal;
  vSourceLum = sourceLum;
  vGlow = glow;
  vAlpha = aAlpha * (0.50 + sourceLum * 0.52 + edgeVal * 0.48 + foreground * 0.28 + rippleGlow * 0.46);
}
`;

const coverParticleFragmentShader = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha;
uniform float uBloomLayer;
uniform float uBloomStrength;
uniform float uHasCover;
varying vec3 vColor;
varying float vAlpha;
varying float vGlow;
varying float vLum;
varying float vEdge;
varying float vSourceLum;

void main() {
  vec4 dotTex = texture2D(uDotTex, gl_PointCoord);
  if (dotTex.a < 0.015) discard;
  float dist = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float rim = smoothstep(0.46, 0.96, dist) * (1.0 - smoothstep(0.96, 1.08, dist));
  vec3 color = vColor * (0.74 + vLum * 0.82 + vGlow * 0.72);
  float lightParticle = smoothstep(0.54, 0.86, dot(color, vec3(0.299, 0.587, 0.114)));
  float darkParticle = 1.0 - smoothstep(0.18, 0.46, vSourceLum);
  color = mix(color, color * 0.64, rim * lightParticle * 0.34);
  color = mix(color, color + vec3(0.20), rim * darkParticle * 0.24);
  color = mix(color, color + vec3(0.16, 0.20, 0.16), vEdge * (0.14 + vGlow * 0.12));
  float bloomAlpha = dotTex.a * dotTex.a * uBloomStrength * (0.32 + vGlow * 0.98);
  float mainAlpha = dotTex.a * uAlpha * vAlpha * mix(0.72, 0.9, uHasCover);
  float alpha = mix(mainAlpha, bloomAlpha, uBloomLayer);
  gl_FragColor = vec4(clamp(color, vec3(0.0), vec3(1.55)), alpha);
}
`;

function makeSplashShaderProgram(gl: WebGLRenderingContext) {
  const vertexShader = compileWebglShader(gl, gl.VERTEX_SHADER, mineradioSplashVertexShader);
  const fragmentShader = compileWebglShader(gl, gl.FRAGMENT_SHADER, mineradioSplashFragmentShader);
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("Mineradio splash shader link failed:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function compileWebglShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("Mineradio splash shader compile failed:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const mineradioSplashVertexShader = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const mineradioSplashFragmentShader = `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;

float saturate(float v) { return clamp(v, 0.0, 1.0); }
float ease(float v) { v = saturate(v); return v * v * (3.0 - 2.0 * v); }
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float animatedLoop(vec2 uv, float t, float channel) {
  vec2 q = uv;
  q *= rot(0.28 + sin(t * 0.18) * 0.12);
  q.x += 0.055 * sin(t * 0.30 + channel);
  q.y += 0.040 * cos(t * 0.24 + channel * 1.7);
  float ang = atan(q.y, q.x);
  float angularShift = sin(ang * 3.0 + t * 0.72 + channel * 1.9) * 0.078;
  angularShift += sin(ang * 7.0 - t * 0.54 + channel) * 0.020;
  float neonD = length(q) + angularShift;
  float warpD = length(q * vec2(1.34 + 0.06 * sin(t * 0.25), 0.82 + 0.04 * cos(t * 0.31)));
  warpD += 0.026 * sin(q.x * 4.4 + t * 0.62) + 0.018 * sin(q.y * 5.2 - t * 0.45);
  float diamondD = abs(q.x) * 1.20 + abs(q.y) * 0.84;
  float d = mix(warpD, diamondD, 0.32);
  d = mix(d, neonD, 0.20 + 0.04 * sin(t * 0.18 + channel));
  float pattern = mod((q.x + q.y) * 0.62 + sin(q.x * 5.5 + t) * 0.015 + sin(q.y * 7.0 - t * 0.75) * 0.012, 0.20);
  float acc = 0.0;
  for (int i = 1; i <= 6; i++) {
    float fi = float(i);
    float f = fract(t * 0.152 - channel * 0.018 + 0.011 * fi) * 4.70 - d + pattern;
    acc += 0.00110 * fi * fi / max(abs(f), 0.0065);
  }
  float threadCoord = q.x * 0.92 - q.y * 0.58 + 0.030 * sin(q.x * 5.2 + t * 0.72);
  float threadLines = 0.0065 / max(abs(sin((threadCoord + t * 0.10 + channel * 0.035) * 27.0)), 0.070);
  acc += threadLines * (0.50 + 0.30 * sin(ang * 1.2 + t + channel));
  return min(acc, 1.95);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= uResolution.x / max(uResolution.y, 1.0);
  float t = uTime;
  float intro = ease(t / 0.72);
  float bloomIn = ease((t - 0.10) / 1.10);
  float climax = exp(-pow((t - 3.62) / 0.58, 2.0));
  float preClimax = ease((t - 2.15) / 1.25) * (1.0 - ease((t - 3.86) / 0.72));
  float afterglow = exp(-pow((t - 4.14) / 0.62, 2.0));
  float calm = 1.0 - 0.22 * ease((t - 4.75) / 0.70);
  float settle = 1.0 - 0.34 * ease((t - 5.05) / 0.52);
  vec2 uv = p * (0.98 + 0.05 * sin(t * 0.25));
  uv += vec2(0.0, -0.025);
  vec2 flowAxis = normalize(vec2(0.86, -0.50));
  vec2 crossAxis = vec2(-flowAxis.y, flowAxis.x);
  float lane = dot(p, flowAxis);
  float crossLane = dot(p, crossAxis);
  float syncWave = sin(crossLane * 5.4 + lane * 1.1 - t * 1.85);
  uv += flowAxis * syncWave * 0.055 * climax;
  uv += crossAxis * sin(lane * 7.2 + t * 1.25) * 0.034 * climax;
  uv *= 1.0 + 0.045 * preClimax - 0.020 * climax;
  vec3 ch1 = vec3(1.00, 0.13, 0.31);
  vec3 ch2 = vec3(0.16, 1.00, 0.86);
  vec3 ch3 = vec3(1.00, 0.76, 0.28);
  float a = animatedLoop(uv, t, 0.0);
  float b = animatedLoop(uv * 1.018 + vec2(0.012, -0.008), t + 0.18, 1.0);
  float c = animatedLoop(uv * 0.986 + vec2(-0.010, 0.010), t + 0.35, 2.0);
  vec3 loopCol = ch1 * a + ch2 * b + ch3 * c;
  float tunnel = animatedLoop(uv * 1.42 + vec2(sin(t * 0.2) * 0.08, cos(t * 0.17) * 0.05), t * 1.12 + 1.7, 2.7);
  loopCol += mix(ch2, ch3, 0.35 + 0.25 * sin(t)) * tunnel * (0.30 + 0.24 * preClimax);
  float syncBand = exp(-pow((lane + 0.08 * sin(t * 0.72)) / 0.62, 2.0));
  float phaseThread = pow(0.5 + 0.5 * sin(crossLane * 13.5 + lane * 2.2 - t * 3.1), 8.0);
  float phaseThread2 = pow(0.5 + 0.5 * sin(crossLane * 9.0 - lane * 5.4 + t * 2.4), 10.0);
  vec3 climaxCol = (mix(ch2, ch3, 0.36) * phaseThread + ch1 * phaseThread2 * 0.52) * syncBand * climax;
  float afterBand = exp(-pow((lane - 0.34) / 0.72, 2.0));
  climaxCol += mix(ch1, ch2, vUv.x) * afterBand * afterglow * 0.13;
  float centerBeam = exp(-abs(p.y + 0.005 * sin(t * 3.0)) * 24.0) * (0.14 + 0.52 * exp(-pow((t - 0.74) / 0.34, 2.0)));
  float bladeMask = smoothstep(-1.55, -0.08, p.x) * (1.0 - smoothstep(0.08, 1.55, p.x));
  vec3 blade = mix(ch1, ch2, vUv.x) * centerBeam * bladeMask * (0.40 + 0.28 * climax);
  float flare = exp(-dot(p, p) * 3.6) * exp(-pow((t - 0.88) / 0.40, 2.0));
  vec3 col = vec3(0.002, 0.004, 0.005);
  col += loopCol * (0.56 + 0.46 * bloomIn) * calm * settle;
  col += climaxCol * 0.22;
  float diagonalGlint = exp(-pow(lane * 1.2 + crossLane * 0.10, 2.0) / 0.030) * climax;
  col += blade + vec3(1.0, 0.78, 0.42) * flare * 0.18 + vec3(1.0, 0.86, 0.58) * diagonalGlint * 0.07;
  float scan = 0.92 + 0.08 * sin((vUv.y * uResolution.y + t * 52.0) * 0.72);
  float grain = noise(vUv * uResolution.xy * 0.52 + t * 17.0) - 0.5;
  col *= scan;
  col += grain * 0.018;
  col *= intro;
  col = max(col - vec3(0.010, 0.012, 0.012), 0.0);
  col = vec3(1.0) - exp(-max(col, 0.0) * (0.62 + 0.18 * climax));
  float vignette = smoothstep(1.52, 0.20, length(p * vec2(0.78, 1.04)));
  col *= 0.38 + 0.86 * vignette;
  col += vec3(0.020, 0.010, 0.014) * (1.0 - vignette);
  gl_FragColor = vec4(col, 1.0);
}
`;

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

function makeLightBeamMotion(line: THREE.LineSegments, direction: -1 | 1, phaseOffset: number, amplitude: number): LightBeamMotion {
  const attribute = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  const positions = attribute.array as Float32Array;
  return {
    attribute,
    positions,
    basePositions: positions.slice(),
    direction,
    phaseOffset,
    amplitude,
  };
}

function animateLightBeamGeometry(motion: LightBeamMotion, elapsed: number, visualEnergy: number, beatPulse: number) {
  const segmentCount = motion.positions.length / 6;
  for (let index = 0; index < segmentCount; index += 1) {
    const base = index * 6;
    const lane = segmentCount <= 1 ? 0 : index / (segmentCount - 1);
    const phase = motion.phaseOffset + index * 0.37 + lane * 2.1;
    const sweep = Math.sin(elapsed * (0.5 + lane * 0.08) + lane * Math.PI * 2 + motion.phaseOffset);
    const shimmer = Math.sin(elapsed * (1.08 + lane * 0.16) + phase);
    const amplitude = motion.amplitude * (0.035 + visualEnergy * 0.06 + beatPulse * 0.035) * (0.55 + lane * 0.75);
    const rootDrift = amplitude * 0.18;

    motion.positions[base] = motion.basePositions[base] + Math.sin(elapsed * 0.74 + phase) * rootDrift;
    motion.positions[base + 1] = motion.basePositions[base + 1] + Math.cos(elapsed * 0.62 + phase) * rootDrift * 0.66;
    motion.positions[base + 2] = motion.basePositions[base + 2] + Math.sin(elapsed * 0.38 + phase) * rootDrift * 0.42;
    motion.positions[base + 3] = motion.basePositions[base + 3] + motion.direction * (sweep * amplitude + shimmer * amplitude * 0.28);
    motion.positions[base + 4] = motion.basePositions[base + 4] + Math.cos(elapsed * 0.7 + phase) * amplitude * 0.76 + beatPulse * 0.04;
    motion.positions[base + 5] = motion.basePositions[base + 5] + Math.sin(elapsed * 0.44 + phase) * amplitude * 0.38;
  }
  motion.attribute.needsUpdate = true;
}

function makeShelfExtras(dotTexture: THREE.Texture) {
  const count = 96;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const randoms = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = seeded(index, 13.1) * 6;
    positions[index * 3 + 1] = seeded(index, 14.2) * 1.28 + 0.32;
    positions[index * 3 + 2] = 0.82 + seededUnit(index, 15.3) * 1.7;
    colors[index * 3] = 0.56;
    colors[index * 3 + 1] = index % 5 === 0 ? 0.82 : 0.91;
    colors[index * 3 + 2] = 1;
    randoms[index] = seededUnit(index, 16.4);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aRand", new THREE.BufferAttribute(randoms, 1));
  const uniforms = {
    uTime: { value: 0 },
    uPixel: { value: 1 },
    uBass: { value: 0 },
    uBeat: { value: 0 },
    uDotTex: { value: dotTexture },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
precision highp float;
uniform float uTime;
uniform float uPixel;
uniform float uBass;
uniform float uBeat;
attribute vec3 aColor;
attribute float aRand;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.4 + aRand * 6.0) * (1.05 + uBass * 0.66);
  p.y += sin(uTime * 0.6 + aRand * 4.0) * (0.16 + uBeat * 0.10);
  p.z += cos(uTime * 0.5 + aRand * 5.0) * (0.32 + uBass * 0.22);
  vColor = aColor;
  vAlpha = 0.26 + 0.42 * sin(uTime * 1.5 + aRand * 7.0) + uBeat * 0.16;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp((3.8 + uBass * 2.2 + uBeat * 2.8) * uPixel, 1.2, 8.2);
  gl_Position = projectionMatrix * mv;
}
`,
    fragmentShader: `
precision highp float;
uniform sampler2D uDotTex;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 dotTex = texture2D(uDotTex, gl_PointCoord);
  if (dotTex.a < 0.02) discard;
  gl_FragColor = vec4(vColor * (0.82 + vAlpha * 0.42), dotTex.a * clamp(vAlpha, 0.0, 0.82));
}
`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const connector = new THREE.Points(geometry, material);
  connector.frustumCulled = false;
  connector.renderOrder = 49;
  connector.visible = false;

  const floorCanvas = document.createElement("canvas");
  floorCanvas.width = 256;
  floorCanvas.height = 64;
  const context = floorCanvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, "rgba(255,255,255,0.075)");
    gradient.addColorStop(0.46, "rgba(156,255,223,0.045)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 64);
  }
  const floorTexture = new THREE.CanvasTexture(floorCanvas);
  floorTexture.generateMipmaps = false;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 1.34),
    new THREE.MeshBasicMaterial({ map: floorTexture, transparent: true, depthWrite: false, opacity: 0.42 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = 48;
  floor.visible = false;
  return { connector, floor, uniforms };
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

function seededUnit(index: number, salt: number) {
  return seeded(index, salt) + 0.5;
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
