import { clampEqGain } from './equalizer';

// A gain overview, not a synthesized frequency response: every control point
// is exactly the corresponding fader's value, with no summed peak overshoot.
export function eqCurvePath(bands: number[], width = 560, height = 80) {
  if (!bands.length) return `M0,${height / 2} L${width},${height / 2}`;
  const y = (gain: number) => height / 2 - clampEqGain(gain) / 12 * (height / 2 - 8);
  let path = `M0,${y(bands[0]).toFixed(2)}`;
  for (let i = 1; i < bands.length; i++) {
    const x0 = (i - 1) / (bands.length - 1) * width;
    const x1 = i / (bands.length - 1) * width;
    const midpoint = (x0 + x1) / 2;
    path += ` C${midpoint.toFixed(2)},${y(bands[i - 1]).toFixed(2)} ${midpoint.toFixed(2)},${y(bands[i]).toFixed(2)} ${x1.toFixed(2)},${y(bands[i]).toFixed(2)}`;
  }
  return path;
}
