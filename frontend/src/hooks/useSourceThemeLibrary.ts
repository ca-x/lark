import { useEffect, useMemo, useState } from "react";
import type { Song } from "../types";
import { api } from "../services/api";
import { coverUrl } from "../utils/app";
import { sourceThemeLibrary } from "../features/plugins/sourceThemeLibrary";
import type { MygoPlugin } from "../features/plugins/mygo";

export function useSourceThemeLibrary(song: Song | null | undefined, onPlay: (song: Song, songs: Song[]) => void) {
  const source = song?.mygo;
  const [plugin, setPlugin] = useState<MygoPlugin>();
  useEffect(() => {
    if (!source) return;
    let alive = true;
    let sequence = 0;
    const refresh = () => { const request = ++sequence; void Promise.all([api.pluginPlatform(), api.mygoPlugins()]).then(([platform, installed]) => {
      if (alive && request === sequence) setPlugin(platform.mygo ? installed.plugins.find((item) => item.enabled && item.manifest.id === source.plugin && item.identity === source.identity) : undefined);
    }).catch(() => { if (alive && request === sequence) setPlugin(undefined); }); };
    refresh();
    window.addEventListener("lark:plugins-changed", refresh);
    return () => { alive = false; window.removeEventListener("lark:plugins-changed", refresh); };
  }, [source?.plugin, source?.identity]);
  return useMemo(() => song?.mygo ? sourceThemeLibrary(song, plugin, coverUrl(song), (id, signal) => api.mygoCall(song.mygo!.plugin, "album", { id }, song.mygo!.identity, signal), onPlay) : undefined, [song, plugin, onPlay]);
}
