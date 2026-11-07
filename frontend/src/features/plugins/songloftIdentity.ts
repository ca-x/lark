export function songloftIdentity(entry: { entry_path: string; author?: string; update_url?: string }): string {
  let identity = (entry.author || "").replace(/<[^>]*>|\([^)]*\)|（[^）]*）/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!identity && entry.update_url) {
    try {
      const address = new URL(entry.update_url);
      const parts = address.pathname.split("/").filter(Boolean);
      if (["github.com", "raw.githubusercontent.com", "objects.githubusercontent.com"].includes(address.hostname.toLowerCase()) && parts.length >= 2) identity = `repo:${parts[0]}/${parts[1].replace(/\.git$/, "")}`.toLowerCase();
    } catch { identity = ""; }
  }
  return `${entry.entry_path.trim().toLowerCase()}\0${identity}`;
}
