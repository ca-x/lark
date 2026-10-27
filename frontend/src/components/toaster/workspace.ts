import type { ToasterCodeLine, ToasterCodePart, ToasterMeta } from "../../features/toaster/contracts";

export function exportFilename(meta: ToasterMeta, extension: "strudel" | "mid") {
  const label = [meta.artist.trim(), meta.title.trim()].filter(Boolean).join(" - ") || "lark-toaster";
  const safe = Array.from(label.replace(/[<>:"/\\|?*]/g, "_"), character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? "_" : character;
  }).slice(0, 150).join("").replace(/[. ]+$/g, "");
  return `${safe || "lark-toaster"}.${extension}`;
}

export function visibleCodeParts(line: ToasterCodeLine, count: number): ToasterCodePart[] {
  const parts = line.parts.map(part => part.text).join("") === line.text
    ? line.parts
    : [{ text: line.text, active: false }];
  let remaining = Math.max(0, count);
  const result: ToasterCodePart[] = [];
  for (const part of parts) {
    if (remaining <= 0) break;
    const text = part.text.slice(0, remaining);
    result.push({ text, active: part.active });
    remaining -= text.length;
  }
  return result;
}
