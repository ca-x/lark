import { useEffect, useRef, type RefObject } from "react";

const SCROLL_KEY_PREFIX = "lark.scroll.";

function scrollKey(view: string) {
  return `${SCROLL_KEY_PREFIX}${view}`;
}

export function useScrollRestore(
  containerRef: RefObject<HTMLElement | null>,
  view: string,
  enabled = true,
) {
  const restoredKeyRef = useRef("");

  // Save scroll position before unmount / view change
  useEffect(() => {
    if (!enabled) return;
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
  }, [containerRef, enabled, view]);

  // Restore scroll position on mount / view change
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    const key = scrollKey(view);
    if (restoredKeyRef.current === key) return;

    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null) {
        const top = Number(saved);
        if (Number.isFinite(top) && top > 0) {
          // Use requestAnimationFrame so the DOM has laid out
          requestAnimationFrame(() => {
            el.scrollTop = top;
            restoredKeyRef.current = key;
          });
          return;
        }
      }
    } catch {
      // ignore
    }

    restoredKeyRef.current = key;
  }, [containerRef, enabled, view]);

  // Re-check the current view if the mobile-only behavior is toggled off and on.
  useEffect(() => {
    if (!enabled) restoredKeyRef.current = "";
  }, [enabled]);
}
