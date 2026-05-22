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

    const onResize = () => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      ) {
        // Small delay so the browser finishes its own scroll adjustment
        requestAnimationFrame(() => {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      }
    };

    const vp = window.visualViewport;
    vp.addEventListener("resize", onResize);
    return () => vp.removeEventListener("resize", onResize);
  }, [enabled]);
}
