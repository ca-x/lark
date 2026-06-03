import { useEffect, useState } from "react";

export function cssCoverImage(url: string) {
  return `url("${url.replace(/"/g, "%22")}")`;
}

export function useCoverFallback(url?: string) {
  const [failedUrl, setFailedUrl] = useState("");

  useEffect(() => {
    if (url !== failedUrl) setFailedUrl("");
  }, [failedUrl, url]);

  const displayUrl = url && url !== failedUrl ? url : "";

  return {
    displayUrl,
    hasCover: Boolean(displayUrl),
    coverImage: displayUrl ? cssCoverImage(displayUrl) : undefined,
    onCoverError: () => {
      if (displayUrl) setFailedUrl(displayUrl);
    },
  };
}
