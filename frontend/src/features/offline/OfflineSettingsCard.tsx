import { ArrowClockwise, Trash } from "@phosphor-icons/react";
import type { OfflineCacheUsage } from "./cache";

type OfflineSettingsCardProps = {
  usage: OfflineCacheUsage;
  usageLabel: string;
  description: string;
  refreshLabel: string;
  clearLabel: string;
  clearing: boolean;
  disabled: boolean;
  formatBytes: (bytes: number) => string;
  onRefresh: () => void;
  onClear: () => void;
};

export function OfflineSettingsCard({
  usage,
  usageLabel,
  description,
  refreshLabel,
  clearLabel,
  clearing,
  disabled,
  formatBytes,
  onRefresh,
  onClear,
}: OfflineSettingsCardProps) {
  return (
    <div className="offline-settings-card settings-wide-row">
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
          className="danger"
          disabled={disabled || clearing}
          onClick={onClear}
          title={clearLabel}
          aria-label={clearLabel}
        >
          <Trash />
        </button>
      </div>
    </div>
  );
}
