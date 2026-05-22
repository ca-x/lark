import { useEffect, useRef, type RefObject } from "react";

const SCROLL_KEY_PREFIX = "lark.scroll.";

function scrollKey(view: string) {
  return `${SCROLL_KEY_PREFIX}${view}`;
}

export function useScrollRestore(
  containerRef: RefObject<HTMLElement | null>,
  view: string,
) {
  const restored = useRef(false);

  // Save scroll position before unmount / view change
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      try {
        sessionStorage.setItem(scrollKey(view), String(el.scrollTop));
      } catch {
        // sessionStorage may be full or unavailable
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [containerRef, view]);

  // Restore scroll position on mount / view change
  useEffect(() => {
    if (restored.current) return;
    const el = containerRef.current;
    if (!el) return;

    try {
      const saved = sessionStorage.getItem(scrollKey(view));
      if (saved !== null) {
        const top = Number(saved);
        if (Number.isFinite(top) && top > 0) {
          // Use requestAnimationFrame so the DOM has laid out
          requestAnimationFrame(() => {
            el.scrollTop = top;
            restored.current = true;
          });
          return;
        }
      }
    } catch {
      // ignore
    }

    restored.current = true;
  }, [containerRef, view]);

  // Reset restored flag when view changes
  useEffect(() => {
    restored.current = false;
  }, [view]);
}
