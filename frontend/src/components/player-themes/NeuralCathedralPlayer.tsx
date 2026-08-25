import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { PlayerThemePlayMode } from "./types";

type Props = {
  playing: boolean;
  progress?: number;
  duration?: number;
  title?: string;
  artist?: string;
  playMode?: PlayerThemePlayMode;
  playModeLabel?: string;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
};

export function NeuralCathedralPlayer({
  playing,
  progress = 0,
  duration = 0,
  title = "Lark",
  artist = "Unknown artist",
  playMode = "sequence",
  playModeLabel = "Play mode",
  onToggle,
  onPrevious,
  onNext,
  onCyclePlayMode,
  onSeek,
}: Props) {
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const playModeIcon = playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;
  return (
    <div className="neural-cathedral-player" data-playing={playing ? "true" : "false"} style={{ "--neural-progress": `${(pct * 100).toFixed(2)}%` } as CSSProperties}>
      <NeuralCathedralCanvas playing={playing} />
      <span className="neural-cathedral-overlay" aria-hidden="true" />
      <div className="neural-cathedral-hud neural-cathedral-hud-left" aria-label="Neural Cathedral telemetry">
        <div className="neural-cathedral-hud-head"><strong>NEURAL CATHEDRAL</strong><small>ID: NC-09 // BIOELECTRIC ENGINE</small></div>
        <div><span>MEMBRANE V</span><b>{playing ? "+40.0 mV" : "-70.0 mV"}</b></div>
        <div><span>DENDRITE STATE</span><b className={playing ? "neural-value-active" : ""}>{playing ? "ACTIVE LOAD" : "CALM"}</b></div>
        <div><span>AXON LOAD</span><b className={playing ? "neural-value-active" : ""}>{playing ? "98%" : "02%"}</b></div>
        <div><span>SIGNAL PHASE</span><b className={playing ? "neural-value-active" : ""}>{playing ? "OUTFLOW" : "RESTING"}</b></div>
        <div><span>SYNAPTIC COH</span><b>{playing ? "85%" : "24%"}</b></div>
        <button type="button" className="neural-impulse" onClick={onToggle} disabled={!onToggle}>{playing ? "PAUSE SIGNAL" : "FIRE SIGNAL"}</button>
      </div>
      <div className="neural-cathedral-copy"><span>LIVE SIGNAL</span><strong title={title}>{title}</strong><small title={artist}>{artist}</small></div>
      <div className="neural-cathedral-controls">
        <div className="neural-progress-row"><time>{formatTime(progress)}</time><input aria-label="Position" type="range" min="0" max={Math.max(0, duration || 0)} step="0.01" value={Math.min(progress, duration || progress || 0)} disabled={!duration || !onSeek} onChange={(event) => onSeek?.(Number(event.target.value))} /><time>{formatTime(duration)}</time></div>
        <div className="neural-transport">
          <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
          <button type="button" className="neural-play" aria-label={playing ? "Pause" : "Play"} disabled={!onToggle} onClick={onToggle}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
          <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
          <button type="button" aria-label={playModeLabel} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>{playModeIcon}</button>
        </div>
      </div>
    </div>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "00:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function NeuralCathedralCanvas({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ playing });
  useEffect(() => { stateRef.current.playing = playing; }, [playing]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = (event: MediaQueryListEvent) => { reduceMotion = event.matches; };
    motionQuery.addEventListener("change", onMotionChange);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x010204, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", "Animated neural network signal visualization");
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x010204, 0.014);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 180);
    camera.position.set(30, 20, 40);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.04;
    controls.enablePan = false;
    controls.minDistance = 15;
    controls.maxDistance = 90;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.34;
    controls.target.set(0, 0, 0);

    const network = new THREE.Group();
    scene.add(network);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(4, 4), coreMaterial);
    network.add(core);
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(4.45, 3), new THREE.MeshBasicMaterial({ color: 0x1546b8, wireframe: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }));
    network.add(wire);
    const branches: THREE.Mesh[] = [];
    const endpoints: THREE.Vector3[] = [];
    const branchMaterial = new THREE.MeshBasicMaterial({ color: 0x00d9ff, transparent: true, opacity: 0.52, blending: THREE.AdditiveBlending, depthWrite: false });
    const axonMaterial = new THREE.MeshBasicMaterial({ color: 0xffa300, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let tree = 0; tree < 16; tree += 1) {
      const isAxon = tree < 4;
      const direction = isAxon ? new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 1).normalize() : new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const start = direction.clone().multiplyScalar(3.5);
      const points = [start];
      let cursor = start.clone();
      const tangent = direction.clone();
      const length = isAxon ? 28 + Math.random() * 10 : 11 + Math.random() * 6;
      for (let segment = 0; segment < 12; segment += 1) {
        tangent.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(isAxon ? 0.18 : 0.6)).normalize();
        cursor = cursor.clone().add(tangent.clone().multiplyScalar(length / 12));
        points.push(cursor);
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, isAxon ? 0.24 : 0.16, 5, false), isAxon ? axonMaterial : branchMaterial);
      branches.push(tube);
      network.add(tube);
      endpoints.push(cursor);
    }
    const endpointGeometry = new THREE.BufferGeometry().setFromPoints(endpoints);
    const synapses = new THREE.Points(endpointGeometry, new THREE.PointsMaterial({ color: 0x00eaff, size: 0.38, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(synapses);
    const dustPositions = new Float32Array(900 * 3);
    for (let index = 0; index < dustPositions.length; index += 1) dustPositions[index] = (Math.random() - 0.5) * 130;
    const dust = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x216cff, size: 0.15, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    dust.geometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    scene.add(dust);
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = width < 720 ? 52 : 45;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const clock = new THREE.Clock();
    let frame = 0;
    const render = () => {
      const elapsed = clock.getElapsedTime();
      const isPlaying = stateRef.current.playing;
      if (!reduceMotion) {
        network.rotation.y += (isPlaying ? 0.16 : 0.035) * 0.01;
        network.rotation.x = Math.sin(elapsed * 0.22) * 0.05;
        dust.rotation.y = elapsed * 0.018;
        core.scale.setScalar(1 + (isPlaying ? 0.06 : 0.018) * Math.max(0, Math.sin(elapsed * (isPlaying ? 3.4 : 0.8))));
      }
      coreMaterial.opacity = isPlaying ? 0.86 : 0.58;
      controls.autoRotate = !reduceMotion;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      controls.dispose();
      branches.forEach((branch) => branch.geometry.dispose());
      endpointGeometry.dispose();
      (synapses.material as THREE.Material).dispose();
      core.geometry.dispose(); coreMaterial.dispose();
      wire.geometry.dispose(); (wire.material as THREE.Material).dispose();
      branchMaterial.dispose(); axonMaterial.dispose();
      dust.geometry.dispose(); (dust.material as THREE.Material).dispose();
      renderer.dispose();
    };
  }, []);
  return <canvas ref={canvasRef} className="neural-cathedral-canvas" role="img" aria-label="Animated neural network signal visualization" />;
}
