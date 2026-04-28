import type { RadioSource } from "../types";

export function radioGroupName(source: RadioSource) {
  return source.group_name || source.source_url || source.name || source.url || "Radio";
}
