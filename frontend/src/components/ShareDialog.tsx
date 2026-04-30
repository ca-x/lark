import { useMemo, useState } from "react";
import { ShareNetwork, X } from "@phosphor-icons/react";

import { api } from "../services/api";
import type { Share } from "../types";
import type { createT } from "../i18n";
import { SHARE_DURATION_OPTIONS, expiresAtFromDuration } from "./share-duration";

export type ShareTarget = {
  type: "song" | "album" | "artist" | "playlist";
  id: number;
  title: string;
};

export function ShareDialog({
  target,
  t,
  onCreated,
  onClose,
}: {
  target: ShareTarget;
  t: ReturnType<typeof createT>;
  onCreated: (share: Share) => void;
  onClose: () => void;
}) {
  const [duration, setDuration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const expiresAt = useMemo(() => expiresAtFromDuration(duration), [duration]);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const share = await api.createShare(target.type, target.id, expiresAt);
      if (share.url) await navigator.clipboard?.writeText(share.url).catch(() => undefined);
      onCreated(share);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-layer share-dialog-layer" role="presentation">
      <button className="modal-scrim" type="button" aria-label={t("close")} onClick={onClose} />
      <div className="modal-card share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
        <div className="modal-card-head">
          <div>
            <p>{t("share")}</p>
            <h2 id="share-dialog-title">{t("createShare")}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("close")} title={t("close")}>
            <X weight="bold" />
          </button>
        </div>
        <p className="section-subtitle">{t("createShareHint")}</p>
        <div className="share-target-card">
          <span>{target.type}</span>
          <strong>{target.title}</strong>
        </div>
        <fieldset className="share-duration-field">
          <legend>{t("shareDuration")}</legend>
          <div className="share-duration-options">
            {SHARE_DURATION_OPTIONS.map((option) => (
              <label key={option.value || "permanent"} className={duration === option.value ? "active" : ""}>
                <input
                  type="radio"
                  name="share-duration"
                  value={option.value}
                  checked={duration === option.value}
                  onChange={() => setDuration(option.value)}
                />
                <span>{t(option.labelKey)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error ? <div className="settings-error">{error}</div> : null}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>{t("cancel")}</button>
          <button type="button" className="primary" onClick={() => void submit()} disabled={submitting}>
            <ShareNetwork weight="bold" /> {submitting ? t("loading") : t("createAndCopy")}
          </button>
        </div>
      </div>
    </div>
  );
}
