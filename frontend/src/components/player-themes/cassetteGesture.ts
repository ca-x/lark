export function resolveCassetteGesture(deltaX: number, deltaY: number, elapsed: number, held = false) {
  if (held) return "none";
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);
  if (horizontal >= 52 && horizontal > vertical * 1.5 && elapsed < 900) {
    return deltaX < 0 ? "next" : "previous";
  }
  return "none";
}

export function cassetteTilt(deltaX: number, deltaY: number) {
  return {
    x: Math.max(-18, Math.min(18, -deltaY / 5)),
    y: Math.max(-24, Math.min(24, deltaX / 4)),
  };
}
