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

const SPLASH_PARTICLES = Array.from({ length: 54 }, (_, index) => index);
const SPLASH_STREAKS = Array.from({ length: 16 }, (_, index) => index);
const SPLASH_SHARDS = Array.from({ length: 24 }, (_, index) => index);
const LYRIC_RIVER_PARTICLES = Array.from({ length: 22 }, (_, index) => index);

type LightBeamMotion = {
  attribute: THREE.BufferAttribute;
  positions: Float32Array;
  basePositions: Float32Array;
  direction: -1 | 1;
  phaseOffset: number;
  amplitude: number;
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
    selectedShelfIndex,
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

function useMineradioStageScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: {
    playing: boolean;
    immersiveStage: boolean;
    playlistSignature: string;
    playlists: Playlist[];
    selectedShelfIndex: number;
  },
) {
  const { playing, immersiveStage, playlistSignature, playlists, selectedShelfIndex } = options;
  const selectedShelfIndexRef = useRef(selectedShelfIndex);

  useEffect(() => {
    selectedShelfIndexRef.current = selectedShelfIndex;
  }, [selectedShelfIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    canvas.removeAttribute("data-webgl-unavailable");
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    } catch (error) {
      canvas.setAttribute("data-webgl-unavailable", "true");
      console.warn("Mineradio Stage WebGL unavailable; using DOM motion layers only.", error);
      return;
    }
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

    const particleGeometry = makeParticleGeometry(960);
    const particlePositionAttribute = particleGeometry.getAttribute("position") as THREE.BufferAttribute;
    const particlePositions = particlePositionAttribute.array as Float32Array;
    const particleBasePositions = particlePositions.slice();
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

    const clock = new THREE.Clock();
    let visualEnergy = playing ? 0.72 : 0.28;
    let beatPulse = 0;
    let raf = 0;
    const tick = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      const energyTarget = playing ? 0.74 + Math.sin(elapsed * 1.18) * 0.08 + Math.sin(elapsed * 2.74) * 0.035 : 0.26;
      visualEnergy += (energyTarget - visualEnergy) * (energyTarget > visualEnergy ? 0.09 : 0.045);
      const beatTarget = playing ? Math.pow(Math.max(0, Math.sin(elapsed * 2.45) * 0.72 + Math.sin(elapsed * 5.1) * 0.28), 4) : 0;
      beatPulse += (beatTarget - beatPulse) * (beatTarget > beatPulse ? 0.34 : 0.08);

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

      particles.rotation.z += (playing ? 0.12 : 0.046) * delta;
      particles.rotation.y = Math.sin(elapsed * 0.72) * (0.06 + visualEnergy * 0.025);
      particles.rotation.x = Math.cos(elapsed * 0.52) * (0.018 + visualEnergy * 0.02);
      particleMaterial.opacity = playing ? 0.66 + visualEnergy * 0.22 + beatPulse * 0.08 : 0.44;
      particleMaterial.size = 0.024 + visualEnergy * 0.008 + beatPulse * 0.008;

      aura.scale.x = 1.52 + Math.sin(elapsed * 1.08) * (0.04 + visualEnergy * 0.035) + beatPulse * 0.08;
      aura.scale.y = 0.64 + Math.cos(elapsed * 0.88) * 0.022 + beatPulse * 0.034;
      aura.material.opacity = playing ? 0.10 + visualEnergy * 0.08 + beatPulse * 0.05 : 0.09;
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
      camera.position.x = Math.sin(elapsed * 0.22) * (immersiveStage ? 0.11 : 0.06);
      camera.position.y = Math.cos(elapsed * 0.18) * 0.045 + beatPulse * 0.015;
      camera.lookAt(0, 0, 0);
      shelf.visible = immersiveStage;
      shelf.position.y = -0.2 + Math.sin(elapsed * 1.2) * (playing ? 0.05 : 0.022);
      shelf.position.z = -0.72 + Math.cos(elapsed * 0.8) * 0.035;
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
