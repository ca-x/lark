import { useEffect, useId, useRef, useState } from "react";
import type { createT } from "../i18n";

export function MygoSignInPrompt({ prompt, t, onCancel }: { prompt: { text?: string; qr?: string }; t: ReturnType<typeof createT>; onCancel: () => void }) {
  const [code, setCode] = useState<{ value: string; image: string } | null>(null);
  const [failed, setFailed] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    cancel.current?.focus();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    let alive = true;
    const value = prompt.qr;
    if (!value) return;
    void import("qrcode-generator").then(({ default: qrcode }) => {
      if (value.length > 4096) throw new Error("QR payload too large");
      qrcode.stringToBytes = (text) => Array.from(new TextEncoder().encode(text));
      const image = qrcode(0, "M");
      image.addData(value);
      image.make();
      if (alive) setCode({ value, image: image.createDataURL(6, 24) });
    }).catch(() => { if (alive) setFailed(value); });
    return () => { alive = false; };
  }, [prompt.qr]);
  return <dialog ref={dialog} className="mygo-signin-prompt" aria-labelledby={title} onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h3 id={title}>{t("mygoSignIn")}</h3>
    <p role="status">{prompt.text}</p>
    {(!code || code.value !== prompt.qr) && failed !== prompt.qr && <div className="mygo-signin-placeholder" aria-hidden="true">{t("loading")}</div>}
    {code && code.value === prompt.qr && <img className="mygo-signin-qr" src={code.image} alt={t("mygoSignInQR")} width={240} height={240} />}
    {failed && failed === prompt.qr && <p>{t("mygoSignInQRError")}</p>}
    <div className="mygo-signin-actions">
      {prompt.qr && /^https?:\/\//.test(prompt.qr) && <a href={prompt.qr} target="_blank" rel="noreferrer">{t("mygoSignInLink")}</a>}
      <button ref={cancel} type="button" onClick={onCancel}>{t("cancel")}</button>
    </div>
  </dialog>;
}
