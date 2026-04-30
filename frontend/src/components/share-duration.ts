export const SHARE_DURATION_OPTIONS = [
  { value: "", seconds: 0, labelKey: "shareDurationPermanent" },
  { value: "3600", seconds: 3600, labelKey: "shareDuration1Hour" },
  { value: "86400", seconds: 86400, labelKey: "shareDuration1Day" },
  { value: "604800", seconds: 604800, labelKey: "shareDuration7Days" },
  { value: "2592000", seconds: 2592000, labelKey: "shareDuration30Days" },
] as const;

export function expiresAtFromDuration(value: string) {
  const option = SHARE_DURATION_OPTIONS.find((item) => item.value === value);
  if (!option?.seconds) return "";
  return new Date(Date.now() + option.seconds * 1000).toISOString();
}

export function durationValueFromExpiresAt(expiresAt?: string) {
  if (!expiresAt) return "";
  const diffSeconds = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const closest = SHARE_DURATION_OPTIONS
    .filter((item) => item.seconds > 0)
    .reduce((best, item) => (Math.abs(item.seconds - diffSeconds) < Math.abs(best.seconds - diffSeconds) ? item : best), SHARE_DURATION_OPTIONS[1]);
  return closest.value;
}
