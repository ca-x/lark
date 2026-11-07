import { useEffect, useState } from "react";
import { api } from "../services/api";
import { pluginNavigation } from "../features/plugins/navigation";

const empty = { sources: [], tools: [] } as ReturnType<typeof pluginNavigation>;

export function usePluginNavigation(userId: number | undefined, admin: boolean) {
  const [snapshot, setSnapshot] = useState({ userId, admin, ready: false, ...empty });
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let sequence = 0;
    const refresh = async () => {
      const request = ++sequence;
      try {
        const platform = await api.pluginPlatform();
        const [sources, plugins] = await Promise.all([
          platform.mygo ? api.mygoPlugins() : Promise.resolve({ plugins: [] }),
          admin && platform.songloft ? api.plugins() : Promise.resolve({ plugins: [] }),
        ]);
        if (alive && request === sequence) setSnapshot({ userId, admin, ready: true, ...pluginNavigation(platform, sources.plugins || [], plugins.plugins || [], admin) });
      } catch {
        if (alive && request === sequence) setSnapshot({ userId, admin, ready: true, ...empty });
      }
    };
    void refresh();
    window.addEventListener("lark:plugins-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { alive = false; window.removeEventListener("lark:plugins-changed", refresh); window.removeEventListener("focus", refresh); };
  }, [userId, admin]);
  return snapshot.userId === userId && snapshot.admin === admin ? snapshot : { ready: false, ...empty };
}
