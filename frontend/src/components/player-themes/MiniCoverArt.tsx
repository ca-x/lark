import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Record } from "@phosphor-icons/react";

export function MiniCoverArt({ url, playing }: { url?: string; playing: boolean }) {
  const [failedUrl, setFailedUrl] = useState("");
  useEffect(() => {
    if (url !== failedUrl) setFailedUrl("");
  }, [failedUrl, url]);
  const displayUrl = url && url !== failedUrl ? url : "";
  const style = displayUrl ? ({ "--cover-url": `url(${displayUrl})` } as CSSProperties) : undefined;
  return (
    <div className="mini-art" data-playing={playing ? "true" : "false"} data-has-cover={displayUrl ? "true" : "false"} style={style}>
      {displayUrl ? (
        <img src={displayUrl} alt="" loading="eager" decoding="async" onError={() => setFailedUrl(displayUrl)} />
      ) : (
        <Record weight="fill" />
      )}
    </div>
  );
}
