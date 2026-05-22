import type { CSSProperties } from "react";

interface SkeletonRowProps {
  lines?: number;
  avatar?: boolean;
}

/**
 * Skeleton loading placeholder for song rows and card grids.
 * Shows animated shimmer blocks that match content shape.
 */
export function SkeletonRow({ lines = 2, avatar = true }: SkeletonRowProps) {
  return (
    <div
      className="skeleton-row"
      style={{
        display: "grid",
        gridTemplateColumns: avatar ? "42px minmax(0, 1fr)" : "minmax(0, 1fr)",
        gap: 10,
        alignItems: "center",
        minHeight: 58,
        padding: "8px 12px",
        borderRadius: 14,
        background: "color-mix(in srgb, var(--panel2) 60%, transparent)",
        overflow: "hidden",
        isolation: "isolate",
      }}
    >
      {avatar && (
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            background: "var(--skeleton-shimmer, color-mix(in srgb, var(--accent) 10%, var(--panel)))",
          }}
        />
      )}
      <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
        <div
          style={{
            height: 14,
            width: "72%",
            borderRadius: 7,
            background: "var(--skeleton-shimmer, color-mix(in srgb, var(--accent) 10%, var(--panel)))",
          }}
        />
        {lines > 1 && (
          <div
            style={{
              height: 11,
              width: "45%",
              borderRadius: 6,
              background: "color-mix(in srgb, var(--skeleton-shimmer, color-mix(in srgb, var(--accent) 8%, var(--panel))) 70%, transparent)",
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * A list of skeleton rows for the loading state of song tables.
 */
export function SkeletonSongList({ count = 5 }: { count?: number }) {
  const style = { "--skeleton-shimmer": "color-mix(in srgb, var(--accent) 10%, var(--panel))" } as CSSProperties;
  return (
    <div className="skeleton-song-list" style={{ display: "grid", gap: 7, ...style }}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
