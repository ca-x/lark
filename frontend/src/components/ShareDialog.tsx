import { useMemo, useState } from "react";
import { ShareNetwork, X } from "@phosphor-icons/react";

import { api } from "../services/api";
import type { Share } from "../types";
import type { createT } from "../i18n";
import { SHARE_DURATION_OPTIONS, expiresAtFromDuration } from "./share-duration";
import { useDialogLifecycle } from "../hooks/useDialogLifecycle";

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
  const [createdShare, setCreatedShare] = useState<Share | null>(null);
  const expiresAt = useMemo(() => expiresAtFromDuration(duration), [duration]);
  const dialogRef = useDialogLifecycle<HTMLDivElement>(onClose);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const share = createdShare ?? await api.createShare(target.type, target.id, expiresAt);
      setCreatedShare(share);
      const url = share.url || `${window.location.origin}/share/${encodeURIComponent(share.token)}`;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(url);
      } catch {
        setError(t("shareLinkCopyFailed"));
        return;
      }
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
      <div ref={dialogRef} className="modal-card share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" aria-busy={submitting}>
        <div className="modal-card-head">
          <div>
            <p>{t("share")}</p>
            <h2 id="share-dialog-title">{t(createdShare ? "copyShareLink" : "createShare")}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("close")} title={t("close")}>
            <X weight="bold" />
          </button>
        </div>
        {!createdShare ? <p className="section-subtitle">{t("createShareHint")}</p> : null}
        <div className="share-target-card">
          <span>{target.type}</span>
          <strong>{target.title}</strong>
        </div>
        <fieldset className="share-duration-field" disabled={submitting || Boolean(createdShare)}>
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
        {error ? <div id="share-dialog-error" className="settings-error" role="alert">{error}</div> : null}
        {createdShare ? (
          <label className="share-copy-link">
            <span>{t("sharingEndpoint")}</span>
            <input
              type="url"
              readOnly
              value={createdShare.url || `${window.location.origin}/share/${encodeURIComponent(createdShare.token)}`}
              aria-describedby={error ? "share-dialog-error" : undefined}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
            />
          </label>
        ) : null}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>{t(createdShare ? "close" : "cancel")}</button>
          <button type="button" className="primary" onClick={() => void submit()} disabled={submitting}>
            <ShareNetwork weight="bold" /> {submitting ? t("loading") : t(createdShare ? "copyShareLink" : "createAndCopy")}
          </button>
        </div>
      </div>
    </div>
  );
}
