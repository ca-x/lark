// Matches the perspective on .vc-shelf-track in vinyl-collection.css.
const PERSPECTIVE = 1000;

export function vinylShelfPose(offset: number) {
  return {
    x: offset === 0 ? 0 : Math.sign(offset) * (65 + Math.abs(offset) * 25),
    z: offset === 0 ? 32 : -Math.min(Math.abs(offset), 8) * 14,
    angle: offset === 0 ? 0 : -Math.sign(offset) * 52,
  };
}

function projectedBounds(offsets: number[], size: number) {
  const edges = offsets.flatMap(offset => {
    const { x, z, angle } = vinylShelfPose(offset);
    const radians = angle * Math.PI / 180;
    return [-size / 2, size / 2].map(edge =>
      (x / 100 * size + Math.cos(radians) * edge) * PERSPECTIVE /
      (PERSPECTIVE - z + Math.sin(radians) * edge),
    );
  });
  return { left: Math.min(...edges), right: Math.max(...edges) };
}

/** Center the visible records as a group, including the first/last selection. */
export function vinylShelfLayout(total: number, selected: number, size: number, width: number) {
  if (total <= 0) return { start: 0, end: 0, shift: 0 };
  const index = Math.max(0, Math.min(total - 1, selected));
  let count = Math.min(total, 13);
  while (count > 1) {
    const offsets = Array.from({ length: count }, (_, i) => i - Math.floor(count / 2));
    const bounds = projectedBounds(offsets, size);
    if (bounds.right - bounds.left + 24 <= width) break;
    count = Math.max(1, count - 2);
  }
  const start = Math.max(0, Math.min(total - count, index - Math.floor(count / 2)));
  const end = start + count;
  const bounds = projectedBounds(Array.from({ length: count }, (_, i) => start + i - index), size);
  return { start, end, shift: -(bounds.left + bounds.right) / 2 };
}
