import { useEffect, useId, useRef } from "react";
import "./ConfirmActionDialog.css";

export function ConfirmActionDialog({ title, message, cancelLabel, confirmLabel, busy, error, onCancel, onConfirm }: {
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="confirm-action-dialog" role="alertdialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h3 id={titleId}>{title}</h3>
    <p id={descriptionId}>{message}</p>
    {error && <p className="confirm-action-error" role="alert">{error}</p>}
    <div className="confirm-action-buttons">
      <button ref={cancel} type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className="confirm-action-destructive" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </dialog>;
}
