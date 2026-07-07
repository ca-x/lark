import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import type { PlayerThemePlayMode } from "./types";
import { PaperShaderLayer } from "./PaperShaderLayer";
import { useCoverFallback } from "./useCoverFallback";

type WalkmanPlayerProps = {
  cover?: string;
  playing: boolean;
  progress?: number;
  duration?: number;
  decorative?: boolean;
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

type WalkmanAction = "rew" | "play" | "ff" | "stop" | "eject" | "knob" | "cassette" | "door";
type WalkmanButtonAction = Extract<WalkmanAction, "rew" | "play" | "ff" | "stop" | "eject">;
type WalkmanIconAction = WalkmanButtonAction | "pause";

type WalkmanFrameState = {
  playing: boolean;
  progress: number;
  duration: number;
  title: string;
  artist: string;
  album: string;
  playMode: PlayerThemePlayMode;
};

type WalkmanRotationOffset = {
  x: number;
  y: number;
};

type WalkmanSceneHandle = {
  dispose: () => void;
};

const WALKMAN_COLORS = {
  alu: 0xc7cbd2,
  aluDark: 0x8f939b,
  graphite: 0x1a1b1f,
  cavity: 0x0b0b0d,
  cap: 0x24262b,
  amber: 0xff9e3d,
  ivory: 0xece7db,
  ink: 0x25201b,
  icon: 0xe9e5dc,
};

export function WalkmanPlayer({
  cover,
  playing,
  progress = 0,
  duration = 0,
  decorative = false,
  title = "Lark",
  artist = "Sonora",
  album = "Now Playing",
  playMode = "sequence",
  playModeLabel = "Play mode",
  onToggle,
  onPrevious,
  onNext,
  onCyclePlayMode,
  onSeek,
}: WalkmanPlayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<WalkmanSceneHandle | null>(null);
  const stateRef = useRef<WalkmanFrameState>({
    playing,
    progress,
    duration,
    title,
    artist,
    album,
    playMode,
  });
  const handlersRef = useRef({
    onToggle,
    onPrevious,
    onNext,
    onCyclePlayMode,
  });
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const canSeek = Boolean(duration && onSeek);
  const coverState = useCoverFallback(cover);
  const displayTitle = title?.trim() || "Lark";
  const displayArtist = artist?.trim() || "Unknown artist";
  const displayAlbum = album?.trim() || "Now Playing";
  const playModeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;
  const vuBars = useMemo(() => Array.from({ length: 18 }, (_, index) => index), []);
  const playerStyle = {
    "--walkman-progress": `${(pct * 100).toFixed(2)}%`,
    ...(coverState.coverImage ? { "--walkman-cover-image": coverState.coverImage } : {}),
  } as CSSProperties;

  useEffect(() => {
    stateRef.current = {
      playing,
      progress,
      duration,
      title: displayTitle,
      artist: displayArtist,
      album: displayAlbum,
      playMode,
    };
    handlersRef.current = {
      onToggle,
      onPrevious,
      onNext,
      onCyclePlayMode,
    };
  });

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const handle = createWalkmanScene(
      root,
      canvas,
      () => stateRef.current,
      (action) => {
        const handlers = handlersRef.current;
        if (action === "play") handlers.onToggle?.();
        else if (action === "rew") handlers.onPrevious?.();
        else if (action === "ff") handlers.onNext?.();
        else if (action === "stop" && stateRef.current.playing) handlers.onToggle?.();
      },
    );
    sceneRef.current = handle;
    return () => {
      handle.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={decorative ? "walkman-player decorative" : "walkman-player"}
      data-playing={playing ? "true" : "false"}
      style={playerStyle}
    >
      {coverState.displayUrl ? (
        <img className="walkman-cover-probe" src={coverState.displayUrl} alt="" loading="eager" decoding="async" onError={coverState.onCoverError} />
      ) : null}
      <PaperShaderLayer variant="walkman" playing={playing} cover={coverState.displayUrl} />
      <span className="walkman-grid" aria-hidden="true" />
      <section className="walkman-scene" aria-label="Walkman 3D player">
        <canvas ref={canvasRef} className="walkman-canvas" aria-hidden="true" />
        <span className="walkman-webgl-fallback" aria-hidden="true">
          <span className="walkman-fallback-shell">
            <span className="walkman-fallback-display" />
            <span className="walkman-fallback-window" />
            <span className="walkman-fallback-controls" />
          </span>
        </span>
      </section>
      <aside className="walkman-console" aria-label="Walkman controls">
        <div className="walkman-status">
          <span className="walkman-status-led" aria-hidden="true" />
          <span>{playing ? "PLAYING" : "READY"}</span>
          <em>{playMode === "shuffle" ? "SHUFFLE" : playMode === "repeat-one" ? "REPEAT 1" : "SEQUENCE"}</em>
        </div>
        <div className="walkman-cover" data-has-cover={coverState.hasCover ? "true" : "false"} aria-hidden="true">
          {coverState.displayUrl ? <img src={coverState.displayUrl} alt="" loading="eager" decoding="async" onError={coverState.onCoverError} /> : null}
          <span />
        </div>
        <div className="walkman-track">
          <span>WALKMAN TPS-2026</span>
          <h2 title={displayTitle}>{displayTitle}</h2>
          <p>
            <span title={displayArtist}>{displayArtist}</span>
            <em title={displayAlbum}>{displayAlbum}</em>
          </p>
        </div>
        <div className="walkman-meter" aria-hidden="true">
          {vuBars.map((index) => (
            <i key={index} style={{ "--walkman-vu-index": index } as CSSProperties} />
          ))}
        </div>
        <div className="walkman-progress-row">
          <span className="walkman-progress-track" aria-hidden="true"><span /></span>
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
          <div className="walkman-time-row">
            <time>{formatWalkmanTime(progress)}</time>
            <time>{formatWalkmanTime(duration || 0)}</time>
          </div>
        </div>
        <div className="walkman-controls">
          <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
          <button
            type="button"
            className="walkman-play"
            aria-label={playing ? "Pause" : "Play"}
            disabled={!onToggle}
            onClick={onToggle}
          >
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>
          <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
          <button
            type="button"
            className={playMode === "sequence" ? "" : "active"}
            aria-label={playModeLabel}
            title={playModeLabel}
            disabled={!onCyclePlayMode}
            onClick={onCyclePlayMode}
          >
            {playModeIcon}
          </button>
        </div>
      </aside>
    </div>
  );
}

function createWalkmanScene(
  root: HTMLDivElement,
  canvas: HTMLCanvasElement,
  getState: () => WalkmanFrameState,
  onAction: (action: WalkmanAction) => void,
): WalkmanSceneHandle {
  let disposed = false;
  let renderer: THREE.WebGLRenderer;
  if (!hasWebGLSupport()) {
    root.dataset.webglUnavailable = "true";
    return { dispose: () => undefined };
  }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    root.dataset.webglUnavailable = "true";
    return { dispose: () => undefined };
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07080b, 16, 32);
  const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 100);
  camera.position.set(5.6, 2.1, 12.7);
  const target = new THREE.Vector3(0, 0.12, 0);
  camera.lookAt(target);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const key = new THREE.DirectionalLight(0xfff2e2, 1.45);
  key.position.set(6, 9, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb7ff, 1.12);
  rim.position.set(-7, 4, -6);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0x343640, 0.72));

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(34, 56),
    new THREE.MeshStandardMaterial({ map: createGroundTexture(), roughness: 0.96, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -4.16;
  ground.receiveShadow = true;
  scene.add(ground);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(34, 56), new THREE.ShadowMaterial({ opacity: 0.42 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -4.15;
  shadow.receiveShadow = true;
  scene.add(shadow);
  const lightBars = new THREE.Group();
  [
    [-13, -15, 9, 1.1],
    [10, -18, 12, 0.85],
    [17, -9, 7, 0.6],
    [-18, -8, 6, 0.45],
  ].forEach(([x, z, height, intensity]) => {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, height, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xffb46a, emissive: 0xff9e3d, emissiveIntensity: intensity, fog: false }),
    );
    bar.position.set(x, height / 2 - 4.15, z);
    lightBars.add(bar);
  });
  scene.add(lightBars);

  const display = new DotDisplay();
  const walkman = new WalkmanModel(display.texture);
  scene.add(walkman.group);
  walkman.closeTape();

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reducedQuery.matches;
  let raf = 0;
  let lastTime = performance.now();
  let activeAction: WalkmanAction | null = null;
  let hoverAction: WalkmanAction | null = null;
  let lastTapeLabel = "";
  let rotationDrag: {
    pointerId: number;
    startX: number;
    startY: number;
    startRotation: WalkmanRotationOffset;
    action: WalkmanAction | null;
    moved: boolean;
  } | null = null;
  const rotationOffset: WalkmanRotationOffset = { x: 0, y: 0 };
  const targetRotationOffset: WalkmanRotationOffset = { x: 0, y: 0 };

  const updateReduced = () => {
    reduced = reducedQuery.matches;
  };
  reducedQuery.addEventListener("change", updateReduced);

  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth || root.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || root.clientHeight || 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  const pickAction = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(walkman.hitTargets, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (isWalkmanAction(object.userData.action)) return object.userData.action;
        object = object.parent;
      }
    }
    return null;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (rotationDrag) {
      const dx = event.clientX - rotationDrag.startX;
      const dy = event.clientY - rotationDrag.startY;
      const next = clampWalkmanRotation({
        x: rotationDrag.startRotation.x + dy * 0.0038,
        y: rotationDrag.startRotation.y + dx * 0.0064,
      });
      targetRotationOffset.x = next.x;
      targetRotationOffset.y = next.y;
      rotationDrag.moved ||= Math.abs(dx) + Math.abs(dy) > 6;
      canvas.style.cursor = "grabbing";
      event.preventDefault();
      return;
    }
    const action = pickAction(event);
    if (action === hoverAction) return;
    hoverAction = action;
    walkman.setHover(action);
    canvas.style.cursor = action ? "pointer" : "";
  };
  const onPointerDown = (event: PointerEvent) => {
    const action = pickAction(event);
    canvas.setPointerCapture(event.pointerId);
    if (action && isButtonAction(action)) {
      activeAction = action;
      walkman.pressVisual(action);
      return;
    }
    activeAction = action;
    hoverAction = null;
    walkman.setHover(null);
    rotationDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRotation: { ...targetRotationOffset },
      action,
      moved: false,
    };
    canvas.style.cursor = "grabbing";
    event.preventDefault();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (rotationDrag?.pointerId === event.pointerId) {
      const drag = rotationDrag;
      rotationDrag = null;
      activeAction = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = "";
      if (drag.moved) return;
      if (drag.action === "door" || drag.action === "cassette") {
        walkman.toggleDoor();
        display.flash(walkman.tapeIn ? "TAPE READY" : "TAPE VIEW");
      }
      return;
    }
    if (!activeAction) return;
    const action = activeAction;
    activeAction = null;
    walkman.releaseVisual(action);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (action === "eject" || action === "door" || action === "cassette") {
      walkman.toggleDoor();
      display.flash(walkman.tapeIn ? "TAPE READY" : "TAPE VIEW");
      return;
    }
    onAction(action);
  };
  const onPointerCancel = (event: PointerEvent) => {
    rotationDrag = null;
    if (activeAction) {
      walkman.releaseVisual(activeAction);
      activeAction = null;
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "";
  };
  const onPointerLeave = () => {
    if (rotationDrag) return;
    hoverAction = null;
    walkman.setHover(null);
    canvas.style.cursor = "";
  };

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);

  const frame = (now: number) => {
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;
    const state = getState();
    const progressRatio = state.duration > 0 ? Math.min(1, Math.max(0, state.progress / state.duration)) : 0;
    const seekDir = activeAction === "ff" ? 1 : activeAction === "rew" ? -1 : 0;
    const vu = makeVu(now / 1000, state.playing);
    const tapeLabel = `${state.title} / ${state.artist}`.trim();
    rotationOffset.x = damp(rotationOffset.x, targetRotationOffset.x, 12, dt);
    rotationOffset.y = damp(rotationOffset.y, targetRotationOffset.y, 12, dt);
    if (tapeLabel !== lastTapeLabel) {
      lastTapeLabel = tapeLabel;
      walkman.setTapeName(tapeLabel || state.album);
    }
    display.update(dt, {
      playing: state.playing,
      seekDir,
      time: state.progress,
      duration: state.duration,
      title: state.title,
      tapeIn: walkman.tapeIn,
      vu,
    });
    walkman.update(dt, {
      playing: state.playing,
      seekDir,
      progress: progressRatio,
      vu,
    }, reduced, rotationOffset);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      reducedQuery.removeEventListener("change", updateReduced);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.style.cursor = "";
      display.dispose();
      disposeObject(scene);
      renderer.dispose();
    },
  };
}

function hasWebGLSupport() {
  const probe = document.createElement("canvas");
  const context = probe.getContext("webgl2") || probe.getContext("webgl");
  return Boolean(context);
}

function createGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(256, 256, 30, 256, 256, 250);
  gradient.addColorStop(0, "#17181f");
  gradient.addColorStop(0.68, "#0e0f14");
  gradient.addColorStop(1, "#08090d");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

class DotDisplay {
  private readonly small = document.createElement("canvas");
  private readonly big = document.createElement("canvas");
  private readonly mid = document.createElement("canvas");
  private readonly sctx: CanvasRenderingContext2D;
  private readonly bctx: CanvasRenderingContext2D;
  private readonly mctx: CanvasRenderingContext2D;
  private readonly dotPattern: CanvasPattern | null;
  readonly texture: THREE.CanvasTexture;
  private scrollX = 0;
  private message: { text: string; until: number } | null = null;
  private acc = 0;
  private time = 0;

  constructor() {
    this.small.width = 192;
    this.small.height = 40;
    this.big.width = this.small.width * 4;
    this.big.height = this.small.height * 4;
    this.mid.width = this.big.width;
    this.mid.height = this.big.height;
    this.sctx = requireCanvasContext(this.small);
    this.bctx = requireCanvasContext(this.big);
    this.mctx = requireCanvasContext(this.mid);
    this.dotPattern = this.createDotPattern();
    this.texture = new THREE.CanvasTexture(this.big);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  flash(text: string, ms = 1000) {
    this.message = { text, until: performance.now() + ms };
  }

  update(dt: number, state: { playing: boolean; seekDir: number; time: number; duration: number; title: string; tapeIn: boolean; vu: number[] }) {
    this.time += dt;
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;

    const context = this.sctx;
    context.clearRect(0, 0, this.small.width, this.small.height);
    context.textBaseline = "top";
    const activeMessage = this.message && performance.now() < this.message.until;

    if (activeMessage) {
      context.fillStyle = "#ffb054";
      context.font = 'bold 13px "SF Mono", Menlo, monospace';
      const text = clipText(context, this.message?.text || "", 180);
      const width = context.measureText(text).width;
      context.fillText(text, Math.round((192 - width) / 2), 13);
    } else if (!state.tapeIn) {
      const blink = Math.floor(this.time * 1.6) % 2 === 0;
      context.fillStyle = blink ? "#ffb054" : "rgba(255,176,84,0.42)";
      context.font = 'bold 12px "SF Mono", Menlo, monospace';
      const text = "TAPE VIEW";
      const width = context.measureText(text).width;
      context.fillText(text, Math.round((192 - width) / 2), 14);
    } else {
      this.drawStateIcon(context, 2, 2, state.playing, state.seekDir);
      context.font = '9px "SF Mono", Menlo, monospace';
      context.fillStyle = "rgba(255,176,84,0.42)";
      const mode = state.seekDir > 0 ? "CUE" : state.seekDir < 0 ? "REW" : "TRK 01/01";
      context.fillText(mode, 16, 2);
      context.fillStyle = "#ffb054";
      const time = formatWalkmanTime(state.time);
      const timeWidth = context.measureText(time).width;
      context.fillText(time, 190 - timeWidth, 2);

      const title = (state.title || "UNTITLED").toUpperCase();
      context.font = 'bold 12px "SF Mono", Menlo, monospace';
      const titleWidth = context.measureText(title).width;
      context.fillStyle = "#ffb054";
      if (titleWidth <= 186) {
        this.scrollX = 0;
        context.fillText(title, 3, 14);
      } else {
        this.scrollX += (state.playing ? 14 : 7) / 30;
        const span = titleWidth + 42;
        const offset = -(this.scrollX % span);
        context.fillText(title, Math.round(offset + 3), 14);
        context.fillText(title, Math.round(offset + 3 + span), 14);
      }

      const blocks = 14;
      const filled = Math.round((state.duration ? state.time / state.duration : 0) * blocks);
      for (let index = 0; index < blocks; index += 1) {
        context.fillStyle = index < filled ? "#ffb054" : "rgba(255,176,84,0.16)";
        context.fillRect(3 + index * 7, 31, 5, 5);
      }
      const startX = 118;
      state.vu.slice(0, 12).forEach((value, index) => {
        const height = Math.max(1, Math.round(value * 9));
        context.fillStyle = index > 8 ? "#ff7a3d" : "#ffb054";
        context.globalAlpha = 0.35 + value * 0.65;
        context.fillRect(startX + index * 6, 37 - height, 4, height);
      });
      context.globalAlpha = 1;
    }

    this.composite();
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }

  private createDotPattern() {
    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = 4;
    patternCanvas.height = 4;
    const patternContext = requireCanvasContext(patternCanvas);
    patternContext.fillStyle = "#fff";
    patternContext.beginPath();
    patternContext.arc(2, 2, 1.68, 0, Math.PI * 2);
    patternContext.fill();
    return this.mctx.createPattern(patternCanvas, "repeat");
  }

  private drawStateIcon(context: CanvasRenderingContext2D, x: number, y: number, playing: boolean, seekDir: number) {
    context.save();
    context.translate(x, y);
    context.fillStyle = "#ffb054";
    context.beginPath();
    if (seekDir > 0) {
      context.moveTo(0, 0);
      context.lineTo(4.5, 3.5);
      context.lineTo(0, 7);
      context.moveTo(5, 0);
      context.lineTo(9.5, 3.5);
      context.lineTo(5, 7);
    } else if (seekDir < 0) {
      context.moveTo(4.5, 0);
      context.lineTo(0, 3.5);
      context.lineTo(4.5, 7);
      context.moveTo(9.5, 0);
      context.lineTo(5, 3.5);
      context.lineTo(9.5, 7);
    } else if (playing) {
      context.moveTo(1, 0);
      context.lineTo(8, 3.5);
      context.lineTo(1, 7);
    } else {
      context.rect(1, 0, 2.6, 7);
      context.rect(5.4, 0, 2.6, 7);
    }
    context.fill();
    context.restore();
  }

  private composite() {
    const width = this.big.width;
    const height = this.big.height;
    this.mctx.clearRect(0, 0, width, height);
    this.mctx.imageSmoothingEnabled = false;
    this.mctx.drawImage(this.small, 0, 0, width, height);
    if (this.dotPattern) {
      this.mctx.globalCompositeOperation = "destination-in";
      this.mctx.fillStyle = this.dotPattern;
      this.mctx.fillRect(0, 0, width, height);
      this.mctx.globalCompositeOperation = "source-over";
    }

    this.bctx.clearRect(0, 0, width, height);
    this.bctx.fillStyle = "#120c06";
    this.bctx.fillRect(0, 0, width, height);
    this.bctx.save();
    this.bctx.filter = "blur(7px)";
    this.bctx.globalAlpha = 0.55;
    this.bctx.drawImage(this.mid, 0, 0);
    this.bctx.restore();
    this.bctx.drawImage(this.mid, 0, 0);
  }
}

class WalkmanModel {
  readonly group = new THREE.Group();
  readonly hitTargets: THREE.Object3D[] = [];
  tapeIn = true;
  private time = 0;
  private hover: WalkmanAction | null = null;
  private readonly buttons: Partial<Record<WalkmanButtonAction, THREE.Group>> = {};
  private reelSpeed = 0;
  private frontZ = 0;
  private backZ = 0;
  private bayY = 0;
  private bayH = 0;
  private bayW = 0;
  private bayBottomY = 0;
  private readonly matAlu = new THREE.MeshStandardMaterial({ color: WALKMAN_COLORS.alu, metalness: 0.92, roughness: 0.32 });
  private readonly matGraphite = new THREE.MeshStandardMaterial({ color: WALKMAN_COLORS.graphite, metalness: 0.55, roughness: 0.42 });
  private readonly matCavity = new THREE.MeshStandardMaterial({ color: WALKMAN_COLORS.cavity, metalness: 0.1, roughness: 0.92, side: THREE.BackSide });
  private readonly matGlass = new THREE.MeshPhysicalMaterial({
    color: 0x2b2d33,
    metalness: 0,
    roughness: 0.05,
    transparent: true,
    opacity: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly matFrame = new THREE.MeshStandardMaterial({ color: WALKMAN_COLORS.aluDark, metalness: 0.9, roughness: 0.3 });
  private readonly matShell = new THREE.MeshStandardMaterial({ color: 0xd6d1c4, metalness: 0.02, roughness: 0.6 });
  private readonly matSpool = new THREE.MeshStandardMaterial({ color: WALKMAN_COLORS.ink, metalness: 0.15, roughness: 0.32 });
  private readonly matHub = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, metalness: 0.1, roughness: 0.4 });
  private readonly matAmber = new THREE.MeshStandardMaterial({
    color: WALKMAN_COLORS.amber,
    emissive: WALKMAN_COLORS.amber,
    emissiveIntensity: 0.55,
    metalness: 0.2,
    roughness: 0.4,
  });
  private door!: THREE.Group;
  private cassette!: THREE.Group;
  private cassetteInPos!: THREE.Vector3;
  private cassetteOutPos!: THREE.Vector3;
  private knobSpin!: THREE.Group;
  private led!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private labelCanvas!: HTMLCanvasElement;
  private labelTexture!: THREE.CanvasTexture;
  private readonly reels: THREE.Group[] = [];
  private playIcon: THREE.Mesh | null = null;
  private pauseIcon: THREE.Mesh | null = null;

  constructor(displayTexture: THREE.Texture) {
    this.buildBody();
    this.buildDisplay(displayTexture);
    this.buildButtons();
    this.buildKnob();
    this.buildCassette();
    this.buildDoor();
    this.buildDetail();
    this.group.scale.setScalar(0.7);
  }

  closeTape() {
    this.tapeIn = true;
    this.door.rotation.x = 0;
    this.cassette.position.copy(this.cassetteInPos);
    this.cassette.rotation.set(0, 0, 0);
  }

  toggleDoor() {
    this.tapeIn = !this.tapeIn;
    if (this.tapeIn) {
      this.door.rotation.x = 0;
      this.cassette.position.copy(this.cassetteInPos);
      this.cassette.rotation.x = 0;
    } else {
      this.door.rotation.x = 1.18;
      this.cassette.position.copy(this.cassetteOutPos);
      this.cassette.rotation.x = -0.16;
    }
  }

  pressVisual(action: WalkmanAction) {
    const button = isButtonAction(action) ? this.buttons[action] : null;
    if (!button) return;
    const pressGroup = button.userData.pressGroup as THREE.Group | undefined;
    if (pressGroup) pressGroup.position.z = -0.13;
  }

  releaseVisual(action: WalkmanAction) {
    const button = isButtonAction(action) ? this.buttons[action] : null;
    if (!button) return;
    const pressGroup = button.userData.pressGroup as THREE.Group | undefined;
    if (pressGroup) pressGroup.position.z = 0;
  }

  setHover(action: WalkmanAction | null) {
    this.hover = action;
  }

  setTapeName(name: string) {
    drawCassetteLabel(this.labelCanvas, name || "LARK MIX");
    this.labelTexture.needsUpdate = true;
  }

  update(dt: number, state: { playing: boolean; seekDir: number; progress: number; vu: number[] }, reduced: boolean, rotationOffset: WalkmanRotationOffset) {
    this.time += dt;
    const idleY = reduced ? 0 : Math.sin(this.time * 0.21) * 0.028;
    const idleX = reduced ? 0 : Math.sin(this.time * 0.3) * 0.011;
    this.group.position.y = reduced ? 0 : Math.sin(this.time * 0.85) * 0.05;
    this.group.rotation.y = rotationOffset.y + idleY;
    this.group.rotation.x = rotationOffset.x + idleX;
    if (!this.tapeIn) {
      this.cassette.position.y = this.cassetteOutPos.y + Math.sin(this.time * 1.25) * 0.06;
      this.cassette.rotation.z = Math.sin(this.time * 0.6) * 0.012;
    }

    const targetSpeed = this.tapeIn ? (state.seekDir !== 0 ? 7.5 * state.seekDir : state.playing ? 1.7 : 0) : 0;
    this.reelSpeed = damp(this.reelSpeed, targetSpeed, 9, dt);
    const radiusMin = 0.42;
    const radiusMax = 1.28;
    for (const reel of this.reels) {
      const side = Number(reel.userData.side || 1);
      const spool = reel.userData.spool as THREE.Mesh | undefined;
      const radius = side < 0 ? lerp(radiusMax, radiusMin, state.progress) : lerp(radiusMin, radiusMax, state.progress);
      spool?.scale.set(radius, radius, 1);
      reel.rotation.z -= (this.reelSpeed / Math.max(0.1, radius)) * dt * 2.2;
    }

    if (this.playIcon && this.pauseIcon) {
      this.playIcon.visible = !state.playing;
      this.pauseIcon.visible = state.playing;
    }
    const ringTarget = state.seekDir !== 0 ? 1.25 : state.playing ? 0.95 : 0.5;
    this.matAmber.emissiveIntensity = damp(this.matAmber.emissiveIntensity, ringTarget, 6, dt);
    const vuAvg = state.vu.length ? (state.vu[0] + state.vu[1] + state.vu[2]) / 3 : 0;
    const ledTarget = this.tapeIn ? (state.playing ? 0.9 + vuAvg * 1.6 : 0.35) : 0.12;
    this.led.material.emissiveIntensity = damp(this.led.material.emissiveIntensity, ledTarget, 8, dt);
    this.knobSpin.rotation.x = 1.4 - (0.58 + vuAvg * 0.28) * 2.8;

    for (const [action, button] of Object.entries(this.buttons) as Array<[WalkmanButtonAction, THREE.Group]>) {
      const material = button.userData.capMat as THREE.MeshStandardMaterial | undefined;
      if (!material) continue;
      material.emissive.setHex(this.hover === action ? 0x23252b : 0x000000);
    }
  }

  private buildBody() {
    const width = 7;
    const height = 11;
    const depth = 2.1;
    const shape = roundedRectShape(width, height, 1.05);
    this.bayW = 6.5;
    this.bayH = 4.35;
    this.bayY = 2.35;
    shape.holes.push(roundedRectPath(this.bayW, this.bayH, 0.4, 0, this.bayY));
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      curveSegments: 28,
      bevelEnabled: true,
      bevelThickness: 0.16,
      bevelSize: 0.15,
      bevelSegments: 5,
    });
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (bounds) {
      const halfDepth = (bounds.max.z - bounds.min.z) / 2;
      geometry.translate(0, 0, -(bounds.min.z + bounds.max.z) / 2);
      this.frontZ = halfDepth;
      this.backZ = -halfDepth;
    }
    const body = new THREE.Mesh(geometry, [this.matGraphite, this.matAlu]);
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    const cavity = new THREE.Mesh(new THREE.BoxGeometry(this.bayW + 0.1, this.bayH + 0.1, 1.5), this.matCavity);
    cavity.position.set(0, this.bayY, this.frontZ - 0.76);
    this.group.add(cavity);
    this.bayBottomY = this.bayY - this.bayH / 2;
  }

  private buildDisplay(texture: THREE.Texture) {
    const width = 5.4;
    const height = 1.12;
    const y = -0.72;
    const back = new THREE.Mesh(
      new RoundedBoxGeometry(width + 0.24, height + 0.24, 0.1, 2, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x08080a, metalness: 0.3, roughness: 0.5 }),
    );
    back.position.set(0, y, this.frontZ + 0.02);
    this.group.add(back);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveMap: texture,
        emissiveIntensity: 1.15,
        roughness: 0.35,
        metalness: 0,
      }),
    );
    screen.position.set(0, y, this.frontZ + 0.105);
    this.group.add(screen);
  }

  private buildButtons() {
    const definitions: Array<{ action: WalkmanButtonAction; x: number; y: number; radius: number; icon: WalkmanIconAction; ring?: boolean }> = [
      { action: "rew", x: -1.85, y: -2.5, radius: 0.6, icon: "rew" },
      { action: "play", x: 0, y: -2.5, radius: 0.72, icon: "play", ring: true },
      { action: "ff", x: 1.85, y: -2.5, radius: 0.6, icon: "ff" },
      { action: "stop", x: -0.9, y: -4.2, radius: 0.42, icon: "stop" },
      { action: "eject", x: 0.9, y: -4.2, radius: 0.42, icon: "eject" },
    ];

    for (const definition of definitions) {
      const group = new THREE.Group();
      group.position.set(definition.x, definition.y, this.frontZ);
      group.userData.action = definition.action;
      const capMaterial = new THREE.MeshStandardMaterial({ color: WALKMAN_COLORS.cap, metalness: 0.62, roughness: 0.4, emissive: 0x000000 });
      const capHeight = 0.3;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(definition.radius, definition.radius + 0.04, capHeight, 48).rotateX(Math.PI / 2), capMaterial);
      cap.position.z = capHeight / 2;
      cap.castShadow = true;
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(definition.radius + 0.06, 0.045, 12, 48),
        definition.ring ? this.matAmber : this.matFrame,
      );
      rim.position.z = 0.06;
      const pressGroup = new THREE.Group();
      pressGroup.add(cap);
      const iconSize = definition.radius * 0.62;
      if (definition.action === "play") {
        const play = iconMesh("play", iconSize, WALKMAN_COLORS.amber);
        const pause = iconMesh("pause", iconSize, WALKMAN_COLORS.amber);
        play.position.z = capHeight + 0.011;
        pause.position.z = capHeight + 0.011;
        pause.visible = false;
        pressGroup.add(play, pause);
        this.playIcon = play;
        this.pauseIcon = pause;
      } else {
        const icon = iconMesh(definition.icon, iconSize, WALKMAN_COLORS.icon);
        icon.position.z = capHeight + 0.011;
        pressGroup.add(icon);
      }
      const hit = new THREE.Mesh(
        new THREE.CircleGeometry(definition.radius + 0.32, 24),
        new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
      );
      hit.position.z = capHeight + 0.02;
      pressGroup.add(hit);
      group.add(rim, pressGroup);
      group.userData.pressGroup = pressGroup;
      group.userData.capMat = capMaterial;
      this.group.add(group);
      this.buttons[definition.action] = group;
      this.hitTargets.push(group);
    }
  }

  private buildKnob() {
    const group = new THREE.Group();
    group.position.set(3.66, 2.35, 0);
    group.userData.action = "knob";
    const spin = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.55, 40).rotateZ(Math.PI / 2), this.matFrame);
    barrel.castShadow = true;
    spin.add(barrel);
    for (let index = 0; index < 22; index += 1) {
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.07), this.matGraphite);
      const angle = (index / 22) * Math.PI * 2;
      ridge.position.set(0, Math.cos(angle) * 0.5, Math.sin(angle) * 0.5);
      ridge.rotation.x = -angle;
      spin.add(ridge);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 10, 36).rotateY(Math.PI / 2), this.matAmber);
    ring.position.x = 0.285;
    spin.add(ring);
    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, 0.7, 16).rotateZ(Math.PI / 2),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    group.add(spin, hit);
    this.knobSpin = spin;
    this.group.add(group);
    this.hitTargets.push(group);
    const label = textPlane("VOL", 0.7, 0.3, { size: 0.2, color: "#63666e" });
    label.position.set(3.665, 1.55, 0);
    label.rotation.y = Math.PI / 2;
    this.group.add(label);
  }

  private buildCassette() {
    const group = new THREE.Group();
    const width = 6;
    const height = 3.85;
    const depth = 0.82;
    const shape = roundedRectShape(width, height, 0.14);
    shape.holes.push(roundedRectPath(3.5, 1.55, 0.18, 0, -0.32));
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      curveSegments: 16,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 3,
    });
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    let shellFrontZ = depth / 2;
    if (bounds) {
      geometry.translate(0, 0, -(bounds.min.z + bounds.max.z) / 2);
      shellFrontZ = (bounds.max.z - bounds.min.z) / 2;
    }
    const shell = new THREE.Mesh(geometry, this.matShell);
    shell.castShadow = true;
    group.add(shell);
    const backplate = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.3, height - 0.3), new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.9 }));
    backplate.position.z = -shellFrontZ + 0.06;
    group.add(backplate);
    for (const side of [-1, 1]) {
      const reel = new THREE.Group();
      reel.position.set(side * 1.13, -0.32, 0);
      const spool = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.34, 48).rotateX(Math.PI / 2), this.matSpool);
      const hub = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.075, 10, 28), this.matHub);
      hub.position.z = 0.2;
      for (let index = 0; index < 6; index += 1) {
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.1), this.matHub);
        const angle = (index / 6) * Math.PI * 2;
        tooth.position.set(Math.cos(angle) * 0.22, Math.sin(angle) * 0.22, 0.2);
        tooth.rotation.z = angle;
        hub.add(tooth);
      }
      reel.add(spool, hub);
      reel.userData.spool = spool;
      reel.userData.side = side;
      group.add(reel);
      this.reels.push(reel);
    }
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 1.55),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.04,
        metalness: 0,
        transparent: true,
        opacity: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      }),
    );
    glass.position.set(0, -0.32, shellFrontZ - 0.02);
    glass.renderOrder = 9;
    group.add(glass);

    this.labelCanvas = document.createElement("canvas");
    this.labelCanvas.width = 1024;
    this.labelCanvas.height = 240;
    drawCassetteLabel(this.labelCanvas, "LARK MIX");
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    this.labelTexture.anisotropy = 8;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 1.29),
      new THREE.MeshStandardMaterial({ map: this.labelTexture, roughness: 0.9, metalness: 0 }),
    );
    label.position.set(0, 1.05, shellFrontZ + 0.012);
    group.add(label);

    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 8, 20), this.matShell);
      ring.position.set(side * 2.2, -1.45, shellFrontZ - 0.01);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
      hole.position.set(side * 2.2, -1.45, shellFrontZ - 0.005);
      group.add(ring, hole);
    }
    group.userData.action = "cassette";
    this.cassette = group;
    this.cassetteInPos = new THREE.Vector3(0, this.bayY, this.frontZ - 0.62);
    this.cassetteOutPos = new THREE.Vector3(0, this.bayY + 0.62, this.frontZ + 2.35);
    group.position.copy(this.cassetteInPos);
    this.group.add(group);
    this.hitTargets.push(group);
  }

  private buildDoor() {
    const pivot = new THREE.Group();
    pivot.position.set(0, this.bayBottomY - 0.02, this.frontZ + 0.03);
    pivot.userData.action = "door";
    const width = 6.78;
    const height = 4.55;
    const frameShape = roundedRectShape(width, height, 0.42);
    frameShape.holes.push(roundedRectPath(width - 0.42, height - 0.42, 0.3));
    const frameGeometry = new THREE.ExtrudeGeometry(frameShape, {
      depth: 0.09,
      curveSegments: 20,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.035,
      bevelSegments: 2,
    });
    const frame = new THREE.Mesh(frameGeometry, this.matFrame);
    frame.castShadow = true;
    frame.position.y = height / 2;
    const glass = new THREE.Mesh(new RoundedBoxGeometry(width - 0.38, height - 0.38, 0.09, 3, 0.12), this.matGlass);
    glass.position.set(0, height / 2, 0.065);
    glass.renderOrder = 10;
    const tab = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.14, 0.2, 2, 0.05), this.matFrame);
    tab.position.set(0, height - 0.08, 0.12);
    pivot.add(frame, glass, tab);
    this.door = pivot;
    this.group.add(pivot);
    this.hitTargets.push(pivot);
  }

  private buildDetail() {
    this.led = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.09, 16),
      new THREE.MeshStandardMaterial({ color: WALKMAN_COLORS.amber, emissive: WALKMAN_COLORS.amber, emissiveIntensity: 0.3 }),
    );
    this.led.position.set(2.7, 5.66, 0);
    this.group.add(this.led);
    const jackRing = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 10, 24).rotateX(Math.PI / 2), this.matFrame);
    jackRing.position.set(-2.55, 5.66, 0);
    const jackHole = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    jackHole.position.set(-2.55, 5.665, 0);
    const jackLabel = textPlane("PHONES", 1.2, 0.26, { size: 0.16, color: "#5c6068" });
    jackLabel.position.set(-1.55, 5.665, 0);
    jackLabel.rotation.x = -Math.PI / 2;
    this.group.add(jackRing, jackHole, jackLabel);
    const brand = textPlane("W - 2 6  /  T A P E  D E C K", 3.4, 0.34, { size: 0.19, color: "#8a8d95", weight: 600 });
    brand.position.set(0, -5.06, this.frontZ + 0.012);
    this.group.add(brand);
    const sub = textPlane("PERSONAL STEREO / EST. 2026", 2.6, 0.22, { size: 0.125, color: "#53565e" });
    sub.position.set(0, -1.52, this.frontZ + 0.012);
    this.group.add(sub);
    const back = textPlane("WALKMAN TPS-2026", 3.2, 0.4, { size: 0.2, color: "#5f636b", weight: 600 });
    back.position.set(0, 0.6, this.backZ - 0.012);
    back.rotation.y = Math.PI;
    this.group.add(back);
  }
}

function roundedRectShape(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.absarc(x + width - radius, y + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(x + width, y + height - radius);
  shape.absarc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(x + radius, y + height);
  shape.absarc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + radius);
  shape.absarc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function roundedRectPath(width: number, height: number, radius: number, centerX = 0, centerY = 0) {
  const path = new THREE.Path();
  const x = centerX - width / 2;
  const y = centerY - height / 2;
  path.moveTo(x + radius, y);
  path.lineTo(x + width - radius, y);
  path.absarc(x + width - radius, y + radius, radius, -Math.PI / 2, 0, false);
  path.lineTo(x + width, y + height - radius);
  path.absarc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2, false);
  path.lineTo(x + radius, y + height);
  path.absarc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI, false);
  path.lineTo(x, y + radius);
  path.absarc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5, false);
  return path;
}

function iconMesh(kind: WalkmanIconAction, size: number, color: number) {
  const shapes: THREE.Shape[] = [];
  const triangle = (offset = 0, direction = 1) => {
    const shape = new THREE.Shape();
    shape.moveTo(offset - 0.5 * size * direction, -0.58 * size);
    shape.lineTo(offset - 0.5 * size * direction, 0.58 * size);
    shape.lineTo(offset + 0.62 * size * direction, 0);
    shape.closePath();
    return shape;
  };
  const rect = (centerX: number, centerY: number, width: number, height: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(centerX - width / 2, centerY - height / 2);
    shape.lineTo(centerX + width / 2, centerY - height / 2);
    shape.lineTo(centerX + width / 2, centerY + height / 2);
    shape.lineTo(centerX - width / 2, centerY + height / 2);
    shape.closePath();
    return shape;
  };
  if (kind === "play") shapes.push(triangle(0.06 * size, 1));
  else if (kind === "pause") {
    shapes.push(rect(-0.3 * size, 0, 0.32 * size, 1.1 * size));
    shapes.push(rect(0.3 * size, 0, 0.32 * size, 1.1 * size));
  } else if (kind === "stop") shapes.push(rect(0, 0, 0.95 * size, 0.95 * size));
  else if (kind === "ff") {
    shapes.push(triangle(-0.42 * size, 1));
    shapes.push(triangle(0.52 * size, 1));
  } else if (kind === "rew") {
    shapes.push(triangle(0.42 * size, -1));
    shapes.push(triangle(-0.52 * size, -1));
  } else if (kind === "eject") {
    const triangleShape = new THREE.Shape();
    triangleShape.moveTo(-0.55 * size, 0.02 * size);
    triangleShape.lineTo(0.55 * size, 0.02 * size);
    triangleShape.lineTo(0, 0.75 * size);
    triangleShape.closePath();
    shapes.push(triangleShape, rect(0, -0.38 * size, 1.1 * size, 0.24 * size));
  }
  return new THREE.Mesh(new THREE.ShapeGeometry(shapes), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
}

function textPlane(text: string, width: number, height: number, options: { size?: number; color?: string; weight?: number } = {}) {
  const scale = 96;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = requireCanvasContext(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = options.color || "#70747d";
  context.font = `${options.weight || 500} ${Math.round((options.size || 0.3) * scale)}px "Space Grotesk", "Helvetica Neue", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 1 }),
  );
}

function drawCassetteLabel(canvas: HTMLCanvasElement, name: string) {
  const context = requireCanvasContext(canvas);
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f4f0e6";
  context.fillRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#ff9e3d");
  gradient.addColorStop(1, "#ff7a3d");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height * 0.3);
  context.fillStyle = "#141313";
  context.font = `700 ${height * 0.17}px "Space Grotesk", "Helvetica Neue", sans-serif`;
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillText("SIDE A", width * 0.035, height * 0.155);
  context.textAlign = "right";
  context.font = `500 ${height * 0.13}px "Space Grotesk", sans-serif`;
  context.fillText("STEREO / CrO2 / 90", width * 0.965, height * 0.16);
  context.textAlign = "left";
  context.fillStyle = "#232019";
  context.font = `600 ${height * 0.3}px "Space Grotesk", "Helvetica Neue", sans-serif`;
  context.fillText(clipText(context, name, width * 0.9), width * 0.045, height * 0.56);
  context.strokeStyle = "rgba(35,32,25,0.35)";
  context.lineWidth = Math.max(1, height * 0.012);
  context.beginPath();
  context.moveTo(width * 0.04, height * 0.78);
  context.lineTo(width * 0.96, height * 0.78);
  context.stroke();
  context.fillStyle = "rgba(35,32,25,0.55)";
  context.font = `500 ${height * 0.115}px "SF Mono", Menlo, monospace`;
  context.fillText("W-26 / POSITION / NORMAL BIAS", width * 0.045, height * 0.885);
}

function clipText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && context.measureText(`${clipped}...`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped.trim()}...`;
}

function makeVu(time: number, playing: boolean) {
  return Array.from({ length: 18 }, (_, index) => {
    if (!playing) return 0.08 + (index % 4) * 0.018;
    const a = Math.sin(time * (2.8 + index * 0.09) + index * 0.72);
    const b = Math.sin(time * (5.1 + index * 0.05) + index * 1.37);
    return Math.max(0.08, Math.min(1, 0.34 + a * 0.28 + b * 0.18 + ((index + 2) % 6) * 0.035));
  });
}

function requireCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context unavailable");
  return context;
}

function isWalkmanAction(value: unknown): value is WalkmanAction {
  return value === "rew" || value === "play" || value === "ff" || value === "stop" || value === "eject" || value === "knob" || value === "cassette" || value === "door";
}

function isButtonAction(value: WalkmanAction): value is WalkmanButtonAction {
  return value === "rew" || value === "play" || value === "ff" || value === "stop" || value === "eject";
}

function clampWalkmanRotation(offset: WalkmanRotationOffset): WalkmanRotationOffset {
  return {
    x: Math.min(0.34, Math.max(-0.34, offset.x)),
    y: Math.min(0.82, Math.max(-0.82, offset.y)),
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function damp(current: number, target: number, lambda: number, dt: number) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function formatWalkmanTime(value: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function disposeObject(root: THREE.Object3D) {
  const disposedMaterials = new Set<THREE.Material>();
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
      mesh.geometry.dispose();
      disposedGeometries.add(mesh.geometry);
    }
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => disposeMaterial(item, disposedMaterials));
    } else if (material) {
      disposeMaterial(material, disposedMaterials);
    }
  });
}

function disposeMaterial(material: THREE.Material, disposedMaterials: Set<THREE.Material>) {
  if (disposedMaterials.has(material)) return;
  disposedMaterials.add(material);
  const withTextures = material as THREE.Material & Record<string, unknown>;
  Object.values(withTextures).forEach((value) => {
    if (value instanceof THREE.Texture) value.dispose();
  });
  material.dispose();
}
