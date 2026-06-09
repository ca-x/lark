import { useCallback, useEffect, useRef, useState, type MouseEventHandler, type PointerEventHandler } from "react";

const SCRATCH_CYCLE_SECONDS = 1.8;
const SCRATCH_START_SLOP_PX = 6;
const SCRATCH_MAX_STEP_DEGREES = 54;

type DiscScratchSeekOptions = {
  duration: number;
  progress: number;
  onSeek?: (seconds: number) => void;
  disabled?: boolean;
  scratchCycleSeconds?: number;
};

type ScratchState = {
  pointerId: number;
  started: boolean;
  startX: number;
  startY: number;
  lastAngle: number;
  position: number;
};

export function useDiscScratchSeek({
  duration,
  progress,
  onSeek,
  disabled = false,
  scratchCycleSeconds = SCRATCH_CYCLE_SECONDS,
}: DiscScratchSeekOptions) {
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const [scratching, setScratching] = useState(false);
  const stateRef = useRef<ScratchState | null>(null);
  const suppressClickRef = useRef(false);
  const durationRef = useRef(duration);
  const progressRef = useRef(progress);

  useEffect(() => {
    durationRef.current = duration;
    progressRef.current = progress;
  }, [duration, progress]);

  const canScratch = !disabled && Boolean(onSeek) && duration > 0;
  const displayProgress = previewProgress ?? progress;
  const displayPct = duration > 0 ? Math.min(1, Math.max(0, displayProgress / duration)) : 0;

  const finishScratch = useCallback((commit: boolean) => {
    const state = stateRef.current;
    if (!state) return;
    if (state.started) {
      suppressClickRef.current = true;
      if (commit) onSeek?.(Math.max(0, Math.min(durationRef.current, state.position)));
    }
    stateRef.current = null;
    setScratching(false);
    setPreviewProgress(null);
  }, [onSeek]);

  const handlePointerDown: PointerEventHandler<HTMLElement> = useCallback((event) => {
    if (!canScratch) return;
    if (event.button !== 0) return;

    const angle = angleFromPointer(event.currentTarget, event.clientX, event.clientY);
    stateRef.current = {
      pointerId: event.pointerId,
      started: false,
      startX: event.clientX,
      startY: event.clientY,
      lastAngle: angle,
      position: Math.max(0, Math.min(durationRef.current, progressRef.current)),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [canScratch]);

  const handlePointerMove: PointerEventHandler<HTMLElement> = useCallback((event) => {
    const state = stateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;

    const moved = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
    if (!state.started) {
      if (moved <= SCRATCH_START_SLOP_PX) return;
      state.started = true;
      setScratching(true);
      setPreviewProgress(state.position);
    }

    const nextAngle = angleFromPointer(event.currentTarget, event.clientX, event.clientY);
    const deltaAngle = clamp(normalizeAngleDelta(nextAngle - state.lastAngle), -SCRATCH_MAX_STEP_DEGREES, SCRATCH_MAX_STEP_DEGREES);
    state.lastAngle = nextAngle;
    if (deltaAngle !== 0) {
      state.position = clamp(state.position + (deltaAngle / 360) * scratchCycleSeconds, 0, durationRef.current);
      setPreviewProgress(state.position);
    }
    event.preventDefault();
  }, [scratchCycleSeconds]);

  const handlePointerUp: PointerEventHandler<HTMLElement> = useCallback((event) => {
    const state = stateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    finishScratch(true);
  }, [finishScratch]);

  const handlePointerCancel: PointerEventHandler<HTMLElement> = useCallback((event) => {
    const state = stateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    finishScratch(false);
  }, [finishScratch]);

  const handleClickCapture: MouseEventHandler<HTMLElement> = useCallback((event) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    progress: displayProgress,
    pct: displayPct,
    scratching,
    scratchProps: {
      "data-scratch-enabled": canScratch ? "true" : "false",
      "data-scratching": scratching ? "true" : "false",
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onClickCapture: handleClickCapture,
    },
  } as const;
}

function angleFromPointer(element: HTMLElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.atan2(clientY - centerY, clientX - centerX) * 180 / Math.PI;
}

function normalizeAngleDelta(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
