export type PlayerSwipe = "previous" | "next" | "expand" | "collapse" | null;

// A gesture needs both intent (distance) and a dominant axis. Short diagonal
// taps, long holds and system edge gestures must not accidentally change music.
export function resolvePlayerSwipe(dx: number, dy: number, elapsedMs: number): PlayerSwipe {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  const elapsed = Math.max(16, elapsedMs);
  if (x > y * 1.4 && x >= 40 && (x >= 80 || x / elapsed >= 0.35)) return dx > 0 ? "previous" : "next";
  if (y > x * 1.4 && y >= 40 && (y >= 96 || y / elapsed >= 0.35)) return dy > 0 ? "collapse" : "expand";
  return null;
}
