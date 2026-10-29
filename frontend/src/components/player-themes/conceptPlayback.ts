export function playbackPosition(progress = 0, duration = 0) {
  const total = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const position = Number.isFinite(progress) ? Math.min(total, Math.max(0, progress)) : 0;
  return { total, position, fraction: total > 0 ? position / total : 0 };
}
