import { useEffect, useEffectEvent } from "react";

export function useDesktopShortcuts({ enabled, onSearch, onTogglePlayback }: {
  enabled: boolean;
  onSearch: () => void;
  onTogglePlayback: () => void;
}) {
  const search = useEffectEvent(onSearch);
  const toggle = useEffectEvent(onTogglePlayback);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"], [role="menu"]')) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        search();
        return;
      }
      if (event.code !== "Space" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="slider"], [role="tab"]')) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
