import { useEffect, useRef, useState } from "react";

/** Avoid running decorative animation in hidden pages, shelves or previews. */
export function useArtworkActivity(disabled = false) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (disabled) return;
    let intersecting = true;
    const update = () => setVisible(intersecting && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      intersecting = Boolean(entry?.isIntersecting);
      update();
    });
    if (ref.current) observer?.observe(ref.current);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [disabled]);
  return { ref, visible: visible && !disabled };
}
