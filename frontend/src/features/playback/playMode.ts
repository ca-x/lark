import type { PlayMode } from "../../types/app";

export type QueueBoundaryAction = "continue" | "no-op" | "stop";

export function queueBoundaryAction(
  mode: PlayMode,
  delta: 1 | -1,
  currentIndex: number,
  queueLength: number,
  ended: boolean,
): QueueBoundaryAction {
  if (ended && mode === "single-play") return "stop";
  if (mode !== "order" || queueLength <= 0) return "continue";
  const atBoundary = delta > 0 ? currentIndex >= queueLength - 1 : currentIndex <= 0;
  if (!atBoundary) return "continue";
  return ended ? "stop" : "no-op";
}
