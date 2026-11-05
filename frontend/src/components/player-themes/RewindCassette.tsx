import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { RewindTheme } from "../../types";
import { cassetteTilt, resolveCassetteGesture } from "./cassetteGesture";
import { useArtworkActivity } from "./useArtworkActivity";
import { createTapeScene, type TapeScene, type TapeSceneState } from "./rewindScene";
import { loadTapeImage, paintTape } from "./rewindTexture";

type Props = {
  variant: RewindTheme;
  mediaKey?: string;
  title?: string;
  artist?: string;
  album?: string;
  cover?: string;
  progress?: number;
  playing?: boolean;
  preview?: boolean;
  flipLabel?: string;
  hint?: string;
  onCoverError?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onQueue?: () => void;
};

export function RewindCassette({ variant, mediaKey, title = "LARK MIXTAPE", artist = "ANALOG COLLECTION", album = "C-60 / STEREO", cover, progress = 0, playing = false, preview = false, flipLabel = "Flip cassette", hint, onCoverError, onPrevious, onNext, onQueue }: Props) {
  const { ref, visible } = useArtworkActivity(preview);
  const [flipped, setFlipped] = useState(false);
  const hintId = useId();
  const tiltRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLButtonElement>(null);
  const scene = useRef<TapeScene | null>(null);
  const sceneState = useRef<TapeSceneState>({ playing: false, progress: 0, flipped: false, tiltX: 0, tiltY: 0 });
  const gesture = useRef<{ pointerId: number; x: number; y: number; started: number; moved: boolean; held: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!preview || !canvas) return;
    const record = { variant, title, artist, album };
    paintTape(canvas, record, undefined, true);
    return cover ? loadTapeImage(cover, image => paintTape(canvas, record, image, true)) : undefined;
  }, [preview, variant, title, artist, album, cover]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (preview || !canvas || !stage) return;
    const handle = createTapeScene(canvas, { variant, title: "LARK", artist: "", album: "PERSONAL RECORDINGS" }, { playing: false, progress: 0, flipped: false, tiltX: 0, tiltY: 0 });
    scene.current = handle;
    stage.dataset.renderer = handle ? "webgl" : "fallback";
    const contextLost = () => { handle?.dispose(); scene.current = null; stage.dataset.renderer = "fallback"; };
    canvas.addEventListener("webglcontextlost", contextLost);
    return () => { canvas.removeEventListener("webglcontextlost", contextLost); handle?.dispose(); scene.current = null; };
  }, [variant, preview]);
  useEffect(() => {
    scene.current?.record({ variant, title, artist, album, cover }, `${variant}:${mediaKey ?? ""}:${title}:${artist}:${album}:${cover ?? ""}`);
  }, [variant, mediaKey, title, artist, album, cover]);
  useEffect(() => { setFlipped(false); }, [mediaKey]);
  useEffect(() => {
    sceneState.current = { ...sceneState.current, playing: playing && visible, progress, flipped };
    scene.current?.update(sceneState.current);
  }, [playing, visible, progress, flipped, variant]);
  const clearHold = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const resetTilt = useCallback(() => {
    tiltRef.current?.style.setProperty("--tape-tilt-x", "0deg");
    tiltRef.current?.style.setProperty("--tape-tilt-y", "0deg");
    tiltRef.current?.removeAttribute("data-dragging");
    sceneState.current = { ...sceneState.current, tiltX: 0, tiltY: 0 };
    scene.current?.update(sceneState.current);
  }, []);
  const cancel = useCallback(() => {
    clearHold();
    gesture.current = null;
    suppressClick.current = true;
    resetTilt();
  }, [clearHold, resetTilt]);
  useEffect(() => { cancel(); }, [mediaKey, cancel]);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    const stop = () => { if (document.hidden) cancel(); };
    const additionalPointer = (event: globalThis.PointerEvent) => { if (!event.isPrimary && gesture.current) cancel(); };
    document.addEventListener("visibilitychange", stop);
    document.addEventListener("pointerdown", additionalPointer, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("visibilitychange", stop);
      document.removeEventListener("pointerdown", additionalPointer, true);
      window.removeEventListener("blur", cancel);
    };
  }, [cancel]);

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || gesture.current) { cancel(); return; }
    if (event.button !== 0) return;
    suppressClick.current = false;
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now(), moved: false, held: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (onQueue) timer.current = setTimeout(() => {
      const current = gesture.current;
      if (!current || current.moved) return;
      current.held = true;
      suppressClick.current = true;
      resetTilt();
      onQueue();
    }, 520);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || current.held) return;
    const deltaX = event.clientX - current.x;
    const deltaY = event.clientY - current.y;
    if (Math.hypot(deltaX, deltaY) > 8) {
      current.moved = true;
      clearHold();
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tilt = cassetteTilt(deltaX, deltaY);
    tiltRef.current?.setAttribute("data-dragging", "true");
    tiltRef.current?.style.setProperty("--tape-tilt-x", `${tilt.x}deg`);
    tiltRef.current?.style.setProperty("--tape-tilt-y", `${tilt.y}deg`);
    sceneState.current = { ...sceneState.current, tiltX: tilt.x, tiltY: tilt.y };
    scene.current?.update(sceneState.current);
  };
  const up = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    clearHold();
    const deltaX = event.clientX - current.x;
    const deltaY = event.clientY - current.y;
    suppressClick.current = current.moved || current.held || Math.hypot(deltaX, deltaY) > 8;
    const action = resolveCassetteGesture(deltaX, deltaY, performance.now() - current.started, current.held);
    gesture.current = null;
    resetTilt();
    if (action === "next") onNext?.();
    if (action === "previous") onPrevious?.();
  };
  const style = { "--tape-left-roll": 1 - Math.min(1, Math.max(0, progress)) * .32, "--tape-right-roll": .68 + Math.min(1, Math.max(0, progress)) * .32 } as CSSProperties;
  const art = <span className="rewind-tape-tilt" ref={tiltRef}>
    <span className="rewind-tape-body" data-flipped={flipped ? "true" : "false"}>
      <span className="rewind-tape-face rewind-tape-front">
        <span className="rewind-tape-screw screw-tl" /><span className="rewind-tape-screw screw-tr" /><span className="rewind-tape-screw screw-bl" /><span className="rewind-tape-screw screw-br" />
        <span className="rewind-tape-label"><span className="rewind-tape-brand">LARK <small>HIGH FIDELITY</small></span><strong>{title}</strong><span>{artist}</span><span className="rewind-tape-stripe" /></span>
        <span className="rewind-tape-window"><span className="rewind-tape-roll roll-left"><i /></span><span className="rewind-tape-bridge" /><span className="rewind-tape-roll roll-right"><i /></span></span>
        <span className="rewind-tape-spec"><b>A</b><span>STEREO / NORMAL POSITION</span><b>60</b></span>
        <span className="rewind-tape-guide"><i /><i /><i /><i /></span>
      </span>
      <span className="rewind-tape-face rewind-tape-back">
        <span className="rewind-tape-cover">{cover ? <img src={cover} alt="" draggable={false} onError={onCoverError} /> : <span>LARK<br />MIXTAPE</span>}</span>
        <span className="rewind-tape-back-label"><small>SIDE B / YOUR COLLECTION</small><strong>{album}</strong><span>{artist}</span></span>
      </span>
    </span>
  </span>;
  return <div ref={ref} className={`rewind-cassette ${variant}${preview ? " rewind-preview" : ""}`} data-motion={playing && visible && !preview ? "running" : "paused"} style={style}>
    {preview ? <span className="rewind-tape-stage" aria-hidden="true"><span className="rewind-tape-tilt"><canvas ref={canvasRef} className="rewind-preview-print" /></span></span> : <>
      <button ref={stageRef} type="button" className="rewind-tape-stage" aria-label={flipLabel} aria-pressed={flipped} aria-describedby={hint ? hintId : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.current) cancel(); }} onContextMenu={(event) => event.preventDefault()} onClick={(event) => {
        if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; }
        if (event.detail === 0) event.currentTarget.setAttribute("data-keyboard", "true");
        else event.currentTarget.removeAttribute("data-keyboard");
        setFlipped((value) => !value);
      }}><canvas ref={canvasRef} className="rewind-model" aria-hidden="true" /><span className="rewind-tape-accessible-art" aria-hidden="true">{art}</span></button>
      {hint ? <p id={hintId} className="rewind-tape-hint">{hint}</p> : null}
    </>}
  </div>;
}
