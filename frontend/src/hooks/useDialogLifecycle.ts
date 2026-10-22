import { useEffect, useRef } from "react";

export function useDialogLifecycle<T extends HTMLElement>(onClose: () => void, enabled = true) {
  const dialogRef = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!enabled) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const isAvailable = (node: HTMLElement) => !node.hasAttribute("disabled") && node.tabIndex !== -1 && node.getClientRects().length > 0 && !node.closest("[inert]");
    const isTopDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter((node) => node.getClientRects().length > 0 && !node.closest("[inert]")).at(-1) === dialog;
    const focusFirst = () => {
      if (!isTopDialog()) return;
      const preferred = dialog?.querySelector<HTMLElement>("[data-autofocus], [autofocus]");
      const target = preferred && isAvailable(preferred) ? preferred : Array.from(dialog?.querySelectorAll<HTMLElement>(focusSelector) ?? []).find(isAvailable);
      (target ?? dialog)?.focus({ preventScroll: true });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTopDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusSelector)).filter(isAvailable);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const frame = window.requestAnimationFrame(focusFirst);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected && !previouslyFocused.closest("[inert]")) previouslyFocused.focus({ preventScroll: true });
    };
  }, [enabled]);
  return dialogRef;
}
