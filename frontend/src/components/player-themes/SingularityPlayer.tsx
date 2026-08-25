import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";
import * as THREE from "three";

import type { PlayerThemePlayMode } from "./types";

type SingularityPlayerProps = {
  cover?: string;
  playing: boolean;
  progress?: number;
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
  playMode?: PlayerThemePlayMode;
  playModeLabel?: string;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
};

type FieldMode = {
  name: string;
  topology: string;
  color: string;
  mass: string;
  velocity: string;
  compression: number;
  turbulence: number;
};

const FIELD_MODES: FieldMode[] = [
  { name: "Stable Singularity", topology: "NOMINAL", color: "#65e9ff", mass: "4.2M SOL", velocity: "0.45c", compression: 1, turbulence: 0.08 },
  { name: "Accretion Turbulence", topology: "FLUCTUATING", color: "#ffb14a", mass: "8.7M SOL", velocity: "0.78c", compression: 1.1, turbulence: 0.65 },
  { name: "Relativistic Collapse", topology: "CRITICAL", color: "#ff5478", mass: "12.1M SOL", velocity: "0.99c", compression: 0.58, turbulence: 0.22 },
];

export function SingularityPlayer({
  playing,
  progress = 0,
  duration = 0,
  title = "Lark",
  artist = "Unknown artist",
  album = "Now Playing",
  playMode = "sequence",
  playModeLabel = "Play mode",
  onToggle,
  onPrevious,
  onNext,
  onCyclePlayMode,
  onSeek,
}: SingularityPlayerProps) {
  const [fieldIndex, setFieldIndex] = useState(0);
  const field = FIELD_MODES[fieldIndex];
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const style = {
    "--singularity-accent": field.color,
    "--singularity-progress": `${(pct * 100).toFixed(2)}%`,
  } as CSSProperties;
  const playModeIcon = playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div className="singularity-player" data-playing={playing ? "true" : "false"} data-field={fieldIndex} style={style}>
      <SingularityCanvas playing={playing} turbulence={field.turbulence} compression={field.compression} />
      <div className="singularity-vignette" aria-hidden="true" />
      <div className="singularity-overlay">
        <header className="singularity-header">
          <span className="singularity-eyebrow">LARK / DEEP SPACE AUDIO</span>
          <h2>{field.name}</h2>
          <span className="singularity-status"><i aria-hidden="true" /> TOPOLOGY: {field.topology}</span>
        </header>

        <div className="singularity-now-playing">
          <span className="singularity-kicker">NOW TRANSMITTING</span>
          <strong title={title}>{title}</strong>
          <span title={`${artist} · ${album}`}>{artist} <em aria-hidden="true">/</em> {album}</span>
        </div>

        <div className="singularity-hud">
          <div className="singularity-metrics" aria-label="Singularity telemetry">
            <span>MASS_INDEX <b>{field.mass}</b></span>
            <span>LENSING <b>SCHWARZSCHILD</b></span>
          </div>
          <button type="button" className="singularity-field-button" onClick={() => setFieldIndex((value) => (value + 1) % FIELD_MODES.length)} aria-label="Change singularity field">
            SHIFT FIELD <span aria-hidden="true">↗</span>
          </button>
          <div className="singularity-metrics singularity-metrics-right">
            <span>RELATIVITY <b>{field.velocity}</b></span>
            <span>RADIATION <b>DETECTION ON</b></span>
          </div>
        </div>

        <div className="singularity-controls">
          <div className="singularity-progress-row">
            <span className="singularity-time">{formatTime(progress)}</span>
            <input aria-label="Position" type="range" min="0" max={Math.max(0, duration || 0)} step="0.01" value={Math.min(progress, duration || progress || 0)} disabled={!duration || !onSeek} onChange={(event) => onSeek?.(Number(event.target.value))} />
            <span className="singularity-time">{formatTime(duration)}</span>
          </div>
          <div className="singularity-transport">
            <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
            <button type="button" className="singularity-play" aria-label={playing ? "Pause" : "Play"} disabled={!onToggle} onClick={onToggle}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
            <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
            <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>{playModeIcon}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "00:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function SingularityCanvas({ playing, turbulence, compression }: { playing: boolean; turbulence: number; compression: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneStateRef = useRef({ playing, turbulence, compression });

  useEffect(() => {
    sceneStateRef.current = { playing, turbulence, compression };
  }, [playing, turbulence, compression]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const host = canvas.parentElement;
    if (!host) return;
    let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = (event: MediaQueryListEvent) => { reducedMotion = event.matches; };
    motionQuery.addEventListener("change", onMotionChange);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", "Animated accretion disk visualization");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 200);
    camera.position.set(0, 27, 34);
    camera.lookAt(0, 0, 0);
    const world = new THREE.Group();
    world.rotation.x = -0.14;
    scene.add(world);

    const core = new THREE.Mesh(new THREE.SphereGeometry(4.3, 48, 48), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    world.add(core);
    const photonRing = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.24, 10, 160), new THREE.MeshBasicMaterial({ color: 0xff812e, transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending }));
    photonRing.rotation.x = Math.PI / 2;
    world.add(photonRing);
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(11.5, 0.055, 6, 180), new THREE.MeshBasicMaterial({ color: 0x28c7ff, transparent: true, opacity: 0.48, blending: THREE.AdditiveBlending }));
    outerRing.rotation.x = Math.PI / 2;
    world.add(outerRing);

    const count = 2600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const radius = 5.8 + Math.pow(Math.random(), 1.25) * 27;
      const angle = Math.random() * Math.PI * 2;
      const spread = (Math.random() - 0.5) * (0.24 + 3 / radius);
      const offset = index * 3;
      positions[offset] = Math.cos(angle) * radius;
      positions[offset + 1] = spread;
      positions[offset + 2] = Math.sin(angle) * radius;
      const heat = 1 - Math.min(1, (radius - 5.8) / 27);
      colors[offset] = 0.12 + heat * 0.88;
      colors[offset + 1] = 0.3 + heat * 0.44;
      colors[offset + 2] = 0.95 - heat * 0.82;
      sizes[index] = 0.45 + Math.random() * (1.2 + heat * 1.5);
    }
    const diskGeometry = new THREE.BufferGeometry();
    diskGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    diskGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    diskGeometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    const diskMaterial = new THREE.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    const disk = new THREE.Points(diskGeometry, diskMaterial);
    disk.rotation.x = Math.PI / 2;
    world.add(disk);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width < 620 ? 39 : 34;
      camera.position.y = width < 620 ? 30 : 27;
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const clock = new THREE.Clock();
    let frame = 0;
    const render = () => {
      const time = clock.getElapsedTime();
      if (!reducedMotion) {
        const { playing: isPlaying, turbulence: fieldTurbulence } = sceneStateRef.current;
        const speed = isPlaying ? 0.17 + fieldTurbulence * 0.38 : 0.035;
        disk.rotation.z += speed * 0.012;
        photonRing.rotation.z += speed * 0.02;
        outerRing.rotation.z -= speed * 0.007;
        world.rotation.y = Math.sin(time * 0.18) * 0.07;
      }
      const { playing: isPlaying, compression: fieldCompression } = sceneStateRef.current;
      const pulse = reducedMotion ? 1 : 1 + Math.sin(time * (isPlaying ? 1.8 : 0.45)) * (isPlaying ? 0.035 : 0.012);
      core.scale.setScalar(pulse);
      disk.scale.set(fieldCompression, 1, fieldCompression);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      diskGeometry.dispose();
      diskMaterial.dispose();
      core.geometry.dispose();
      (core.material as THREE.Material).dispose();
      photonRing.geometry.dispose();
      (photonRing.material as THREE.Material).dispose();
      outerRing.geometry.dispose();
      (outerRing.material as THREE.Material).dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="singularity-canvas" role="img" aria-label="Animated accretion disk visualization" />;
}
