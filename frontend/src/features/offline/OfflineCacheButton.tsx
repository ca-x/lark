import { CheckCircle, CircleNotch, DownloadSimple } from "@phosphor-icons/react";

export type OfflineCacheButtonState = "idle" | "caching" | "cached";

type OfflineCacheButtonProps = {
  state: OfflineCacheButtonState;
  labels: {
    cache: string;
    caching: string;
    cached: string;
  };
  onClick: () => void;
};

export function OfflineCacheButton({ state, labels, onClick }: OfflineCacheButtonProps) {
  const title =
    state === "cached"
      ? labels.cached
      : state === "caching"
        ? labels.caching
        : labels.cache;
  return (
    <button
      type="button"
      className={state === "cached" ? "offline-cache-button active" : "offline-cache-button"}
      disabled={state === "caching"}
      title={title}
      aria-label={title}
      aria-busy={state === "caching" ? "true" : undefined}
      onClick={onClick}
    >
      {state === "cached" ? (
        <CheckCircle weight="fill" />
      ) : state === "caching" ? (
        <CircleNotch weight="bold" className="offline-cache-spinner" />
      ) : (
        <DownloadSimple />
      )}
    </button>
  );
}
