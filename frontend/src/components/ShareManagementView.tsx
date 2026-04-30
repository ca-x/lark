import { useEffect, useState } from "react";
import { CopySimple, X } from "@phosphor-icons/react";

import { api } from "../services/api";
import { playUISound } from "../services/uiSounds";
import type { Share } from "../types";
import type { createT } from "../i18n";
import { durationValueFromExpiresAt, expiresAtFromDuration } from "./share-duration";

export function ShareManagementView({
  t,
  onToast,
}: {
  t: ReturnType<typeof createT>;
  onToast: (message: string, duration?: number) => void;
}) {
  const [shares, setShares] = useState<Share[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesError, setSharesError] = useState("");

  useEffect(() => {
    void refreshShares();
  }, []);

  async function refreshShares() {
    setSharesLoading(true);
    setSharesError("");
    try {
      const result = await api.shares();
      setShares(result.shares);
    } catch (err) {
      setSharesError(err instanceof Error ? err.message : String(err));
    } finally {
      setSharesLoading(false);
    }
  }

  async function copyShare(share: Share) {
    if (!share.url) return;
    await navigator.clipboard?.writeText(share.url).catch(() => undefined);
    onToast(t("shareLinkCopied"));
    playUISound("copy");
  }

  async function cancelShare(token: string) {
    setSharesError("");
    try {
      await api.deleteShare(token);
      setShares((items) => items.filter((item) => item.token !== token));
      onToast(t("shareCanceled"));
      playUISound("toggleOff");
    } catch (err) {
      setSharesError(err instanceof Error ? err.message : String(err));
    }
  }

  async function updateShareExpiry(token: string, duration: string) {
    setSharesError("");
    try {
      const updated = await api.updateShare(token, expiresAtFromDuration(duration));
      setShares((items) => items.map((item) => (item.token === token ? updated : item)));
      onToast(t("done"));
      playUISound("success");
    } catch (err) {
      setSharesError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="share-management-page">
      <div className="section-head">
        <div>
          <h2>{t("myShares")}</h2>
          <p className="section-subtitle">{t("mySharesHint")}</p>
        </div>
        <button type="button" onClick={() => void refreshShares()} disabled={sharesLoading}>
          {sharesLoading ? t("loading") : t("refresh")}
        </button>
      </div>
      <div className="share-management-card">
        {sharesError ? <div className="settings-error">{sharesError}</div> : null}
        <div className="share-management-list">
          {shares.map((share) => (
            <div className="share-management-row" key={share.token}>
              <div className="share-management-main">
                <span className="status-pill">{share.type || t("shareType")}</span>
                <strong>{share.title}</strong>
                <small>{share.url || `${window.location.origin}/share/${share.token}`}</small>
              </div>
              <div className="share-management-meta">
                <span>{t("createdAt")}</span>
                <strong>{formatShareDateTime(share.created_at)}</strong>
              </div>
              <div className="share-management-meta">
                <span>{t("expires")}</span>
                <strong>{share.expires_at ? formatShareDateTime(share.expires_at) : t("neverExpires")}</strong>
                <select
                  value={durationValueFromExpiresAt(share.expires_at)}
                  onChange={(event) => void updateShareExpiry(share.token, event.target.value)}
                  aria-label={t("shareDuration")}
                >
                  <option value="">{t("shareDurationPermanent")}</option>
                  <option value="3600">{t("shareDuration1Hour")}</option>
                  <option value="86400">{t("shareDuration1Day")}</option>
                  <option value="604800">{t("shareDuration7Days")}</option>
                  <option value="2592000">{t("shareDuration30Days")}</option>
                </select>
              </div>
              <div className="share-management-actions">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => void copyShare(share)}
                  aria-label={t("copyShareLink")}
                  title={t("copyShareLink")}
                >
                  <CopySimple weight="bold" />
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  onClick={() => void cancelShare(share.token)}
                  aria-label={t("cancelShare")}
                  title={t("cancelShare")}
                >
                  <X weight="bold" />
                </button>
              </div>
            </div>
          ))}
          {!sharesLoading && shares.length === 0 ? (
            <div className="settings-empty">{t("noShares")}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function formatShareDateTime(value: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
