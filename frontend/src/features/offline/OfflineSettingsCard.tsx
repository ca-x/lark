import { ArrowClockwise, FolderOpen } from "@phosphor-icons/react";
import type { OfflineCacheUsage } from "./cache";

type OfflineSettingsCardProps = {
  usage: OfflineCacheUsage;
  usageLabel: string;
  description: string;
  refreshLabel: string;
  manageLabel: string;
  formatBytes: (bytes: number) => string;
  onRefresh: () => void;
  onManage: () => void;
  owner?: string;
};

export function OfflineSettingsCard({
  usage,
  usageLabel,
  description,
  refreshLabel,
  manageLabel,
  formatBytes,
  onRefresh,
  onManage,
  owner,
}: OfflineSettingsCardProps) {
  return (
    <div className="offline-settings-card settings-wide-row" data-settings-owner={owner}>
      <div>
        <strong>{usageLabel}</strong>
        <span>{description}</span>
      </div>
      <div className="offline-cache-meter">
        <strong>{formatBytes(usage.bytes)}</strong>
        <span>
          {usage.audio_entries} / {usage.entries}
        </span>
      </div>
      <div className="settings-inline-actions">
        <button type="button" onClick={onRefresh} title={refreshLabel} aria-label={refreshLabel}>
          <ArrowClockwise />
        </button>
        <button
          type="button"
          onClick={onManage}
          title={manageLabel}
          aria-label={manageLabel}
        >
          <FolderOpen />
        </button>
      </div>
    </div>
  );
}
