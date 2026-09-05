import { Monitor, Screencast, X } from "@phosphor-icons/react";
import type { DLNADevice, DLNAStatus } from "../types";
import type { TKey } from "../i18n";
import { useDialogLifecycle } from "../hooks/useDialogLifecycle";

function deviceStateLabel(state: string, t: (key: TKey) => string) {
  switch (state) {
    case "available":
      return t("available");
    case "connecting":
      return t("connecting");
    case "playing":
      return t("playing");
    case "unavailable":
      return t("unavailable");
    default:
      return state || t("available");
  }
}

export function DLNACastPanel({
  open,
  devices,
  status,
  loading,
  error,
  onClose,
  onRefresh,
  onSelectLocal,
  onSelectDevice,
  t,
}: {
  open: boolean;
  devices: DLNADevice[];
  status: DLNAStatus | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onSelectLocal: () => void;
  onSelectDevice: (device: DLNADevice) => void;
  t: (key: TKey) => string;
}) {
  const dialogRef = useDialogLifecycle<HTMLElement>(onClose, open);

  if (!open) return null;
  const activeID = status?.output === "dlna" ? status.device_id || "" : "";

  return (
    <div className="dlna-cast-layer">
      <button type="button" className="dlna-cast-scrim" aria-label={t("close")} onClick={onClose} />
      <section ref={dialogRef} className="dlna-cast-panel" role="dialog" aria-modal="true" aria-label={t("playToDevice")}>
        <div className="dlna-cast-head">
          <div>
            <strong>{t("playToDevice")}</strong>
            <span>{activeID ? `${t("playingOnDevice")} ${status?.device_name || ""}` : t("thisDevice")}</span>
          </div>
          <div className="dlna-cast-actions">
            <button type="button" onClick={onRefresh} disabled={loading}>
              {loading ? t("connecting") : t("refresh")}
            </button>
            <button type="button" data-autofocus onClick={onClose} aria-label={t("close")}>
              <X weight="bold" />
            </button>
          </div>
        </div>

        {error ? <div className="dlna-cast-error" role="alert">{error}</div> : null}

        <div className="dlna-cast-list">
          <button type="button" className={!activeID ? "dlna-cast-row active" : "dlna-cast-row"} aria-pressed={!activeID} onClick={onSelectLocal}>
            <span className="dlna-cast-icon"><Monitor weight="bold" /></span>
            <span>
              <strong>{t("thisDevice")}</strong>
              <small>{!activeID ? t("active") : t("localPlayback")}</small>
            </span>
            {!activeID ? <em>{t("active")}</em> : null}
          </button>

          {devices.length === 0 ? (
            <div className="dlna-cast-empty">
              <strong>{t("noDLNADevices")}</strong>
              <span>{t("dlnaNoDevicesHint")}</span>
            </div>
          ) : devices.map((device) => (
            <button
              type="button"
              key={device.id}
              className={device.id === activeID ? "dlna-cast-row active" : "dlna-cast-row"}
              aria-pressed={device.id === activeID}
              onClick={() => onSelectDevice(device)}
              disabled={device.state === "unavailable"}
            >
              <span className="dlna-cast-icon"><Screencast weight="bold" /></span>
              <span>
                <strong>{device.name}</strong>
                <small>{device.protocol} · {deviceStateLabel(device.state, t)}</small>
              </span>
              {device.id === activeID ? <em>{t("active")}</em> : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
