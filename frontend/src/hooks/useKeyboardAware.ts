import { useEffect } from "react";

/**
 * On mobile, when the virtual keyboard opens, the visual viewport shrinks.
 * This hook ensures the active element stays visible by scrolling it into
 * view when the viewport changes.
 */
export function useKeyboardAware(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    if (!window.visualViewport) return;

    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      ) {
        frame = requestAnimationFrame(() => {
          if (!el.isConnected || document.activeElement !== el) return;
          const bounds = el.getBoundingClientRect();
          const top = vp.offsetTop + 12;
          const bottom = vp.offsetTop + vp.height - 12;
          if (bounds.top < top || bounds.bottom > bottom) {
            el.scrollIntoView({ block: "nearest", behavior: "instant" });
          }
        });
      }
    };

    const vp = window.visualViewport;
    vp.addEventListener("resize", onResize);
    vp.addEventListener("scroll", onResize);
    return () => {
      cancelAnimationFrame(frame);
      vp.removeEventListener("resize", onResize);
      vp.removeEventListener("scroll", onResize);
    };
  }, [enabled]);
}
