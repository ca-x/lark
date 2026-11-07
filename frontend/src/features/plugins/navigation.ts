import type { Plugin } from "../../types";
import type { MygoPlugin, PluginPlatform } from "./mygo";

export function hasMygoSourceUI(plugin: Pick<MygoPlugin, "exports">) {
  return plugin.exports.includes("stream") && ["home", "browse", "search", "liked", "playlists", "shows", "stations"].some((method) => plugin.exports.includes(method));
}

export function pluginNavigation(platform: PluginPlatform, sources: MygoPlugin[], plugins: Plugin[], admin: boolean) {
  return {
    sources: platform.mygo ? sources.filter((plugin) => plugin.enabled && hasMygoSourceUI(plugin)) : [],
    tools: platform.songloft && admin ? plugins.filter((plugin) => plugin.status === "active" && plugin.has_frontend) : [],
  };
}
