import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ToasterSnapshot, ToasterVisualMode } from "../../features/toaster/contracts";

export type ToasterVisualizerHandle = {
  draw: (snapshot: ToasterSnapshot, active: boolean, now: number) => void;
};

const level = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.min(1, value || 0)) : 0;
const palette = { signal: "#a8d9b9", warm: "#ddbc86", quiet: "#27382e", guide: "#1d2a23" };

function spectrum(context: CanvasRenderingContext2D, width: number, height: number, data: ToasterSnapshot, active: boolean, reduced: boolean) {
  const count = Math.min(48, Math.max(24, data.bands.length));
  const inset = Math.max(22, width * 0.065);
  const pitch = (width - inset * 2) / count;
  const baseline = height * 0.78;
  context.strokeStyle = palette.guide;
  context.lineWidth = 1;
  for (const fraction of [0.24, 0.5, 0.78]) {
    context.beginPath();
    context.moveTo(inset, height * fraction);
    context.lineTo(width - inset, height * fraction);
    context.stroke();
  }
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * data.bands.length / count);
    const end = Math.max(start + 1, Math.floor((index + 1) * data.bands.length / count));
    let value = 0;
    for (let bin = start; bin < end; bin++) value += level(data.bands[bin]);
    value = active ? value / (end - start) : 0;
    const barHeight = height * (reduced ? 0.33 : 0.56) * value;
    const x = inset + index * pitch;
    context.fillStyle = palette.quiet;
    context.fillRect(x, baseline + 7, Math.max(1, pitch - 3), 2);
    if (barHeight < 0.5) continue;
    context.globalAlpha = 0.6 + value * 0.4;
    context.fillStyle = index < count * 0.67 ? palette.signal : palette.warm;
    context.fillRect(x, baseline - barHeight, Math.max(1, pitch - 3), barHeight);
  }
  context.globalAlpha = 1;
}

function orb(context: CanvasRenderingContext2D, width: number, height: number, data: ToasterSnapshot, active: boolean, reduced: boolean) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.26;
  const energy = active ? level(data.energy) : 0;
  const beat = active && !reduced ? level(data.beat) : 0;
  context.lineWidth = 1;
  for (const scale of [0.72, 1, 1.43]) {
    context.strokeStyle = palette.guide;
    context.beginPath();
    context.arc(centerX, centerY, radius * scale, 0, Math.PI * 2);
    context.stroke();
  }
  context.beginPath();
  for (let index = 0; index <= 192; index++) {
    const angle = index / 192 * Math.PI * 2 - Math.PI / 2;
    const bandIndex = Math.floor((index % 192) / 192 * data.bands.length);
    const band = active && !reduced ? level(data.bands[bandIndex]) : 0;
    const distance = radius * (1 + band * 0.48 + beat * 0.13);
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance;
    if (!index) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.strokeStyle = active && energy > 0.002 ? palette.signal : palette.quiet;
  context.fillStyle = `rgba(168, 217, 185, ${energy * 0.075})`;
  context.fill();
  context.lineWidth = 1.5;
  context.stroke();
  for (let index = 0; index < 24; index++) {
    const angle = index / 24 * Math.PI * 2 - Math.PI / 2;
    const value = active ? level(data.bands[Math.floor(index / 24 * data.bands.length)]) : 0;
    const distance = radius * (1.43 + (reduced ? 0 : value * 0.16));
    context.fillStyle = value > 0.04 ? palette.warm : palette.quiet;
    context.beginPath();
    context.arc(centerX + Math.cos(angle) * distance, centerY + Math.sin(angle) * distance, value > 0.04 ? 1.6 : 1, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = `rgba(168, 217, 185, ${0.08 + energy * 0.32})`;
  context.beginPath();
  context.arc(centerX, centerY, radius * 0.38, 0, Math.PI * 2);
  context.fill();
}

function dominoes(context: CanvasRenderingContext2D, width: number, height: number, data: ToasterSnapshot, active: boolean, reduced: boolean) {
  const patterns = Object.values(data.patterns).filter(pattern => pattern.length).slice(0, 5);
  const rows = patterns.length || 4;
  const inset = Math.max(18, width * 0.055);
  const rowPitch = Math.min(56, height * 0.72 / rows);
  const top = (height - rowPitch * rows) / 2;
  for (let row = 0; row < rows; row++) {
    const pattern = patterns[row];
    const count = Math.min(32, pattern?.length || 16);
    const pitch = (width - inset * 2) / count;
    const tileWidth = Math.max(3, Math.min(16, pitch * 0.63));
    const tileHeight = Math.min(rowPitch * 0.65, tileWidth * 2.1);
    for (let index = 0; index < count; index++) {
      const hit = Boolean(pattern?.[index]);
      const current = active && level(data.energy) > 0.002 && data.step !== null && index === data.step % count && hit;
      context.save();
      context.translate(inset + (index + 0.5) * pitch, top + (row + 0.5) * rowPitch);
      if (current && !reduced) context.rotate(-level(data.beat) * 0.42 - level(data.energy) * 0.18);
      context.fillStyle = current ? palette.warm : hit ? palette.quiet : "#121d17";
      context.strokeStyle = current ? palette.warm : hit ? "#45604e" : palette.guide;
      context.lineWidth = 1;
      context.fillRect(-tileWidth / 2, -tileHeight / 2, tileWidth, tileHeight);
      context.strokeRect(-tileWidth / 2, -tileHeight / 2, tileWidth, tileHeight);
      if (hit && tileWidth >= 7) {
        context.strokeStyle = current ? "#5d4d32" : "#45604e";
        context.beginPath();
        context.moveTo(-tileWidth * 0.3, 0);
        context.lineTo(tileWidth * 0.3, 0);
        context.stroke();
        context.fillStyle = current ? "#3c3425" : palette.signal;
        for (const direction of [-1, 1]) {
          context.beginPath();
          context.arc(0, direction * tileHeight * 0.24, 1, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.restore();
    }
  }
}

const renderers = { spectrum, orb, dominoes };

const ToasterVisualizer = forwardRef<ToasterVisualizerHandle, {
  mode: ToasterVisualMode;
  reducedMotion: boolean;
  label: string;
  unavailableLabel: string;
}>(function ToasterVisualizer({ mode, reducedMotion, label, unavailableLabel }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, ratio: 1 });
  const latestRef = useRef<{ snapshot: ToasterSnapshot; active: boolean; now: number } | null>(null);
  const lastPaintRef = useRef(0);
  const failedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  const paint = useCallback((snapshot: ToasterSnapshot, active: boolean, now: number, force = false) => {
    latestRef.current = { snapshot, active, now };
    const context = contextRef.current;
    const { width, height, ratio } = sizeRef.current;
    if (!context || !width || !height || failedRef.current) return;
    if (!force && active && now - lastPaintRef.current < (reducedMotion ? 400 : 1000 / 30)) return;
    lastPaintRef.current = now;
    try {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      renderers[mode](context, width, height, snapshot, active, reducedMotion);
    } catch {
      failedRef.current = true;
      setFailed(true);
    }
  }, [mode, reducedMotion]);

  useImperativeHandle(ref, () => ({ draw: paint }), [paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    contextRef.current = canvas.getContext("2d");
    if (!contextRef.current) {
      failedRef.current = true;
      setFailed(true);
      return;
    }
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { width, height, ratio };
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const latest = latestRef.current;
      if (latest) paint(latest.snapshot, latest.active, latest.now, true);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      contextRef.current = null;
    };
  }, [paint]);

  return (
    <div className="toaster-visual" data-mode={mode}>
      <canvas ref={canvasRef} role="img" aria-label={label} />
      {failed ? <p className="toaster-visual-fallback" role="status">{unavailableLabel}</p> : null}
    </div>
  );
});

export default ToasterVisualizer;
