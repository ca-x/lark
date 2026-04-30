import type { CSSProperties } from "react";
import { Record } from "@phosphor-icons/react";

export function MiniCoverArt({ url, playing }: { url?: string; playing: boolean }) {
  const style = url ? ({ "--cover-url": `url(${url})` } as CSSProperties) : undefined;
  return (
    <div className="mini-art" data-playing={playing ? "true" : "false"} data-has-cover={url ? "true" : "false"} style={style}>
      {!url ? <Record weight="fill" /> : null}
    </div>
  );
}
