import type { User } from "../types";
import type { LibraryTab, SettingsTab } from "../types/app";

export function canManageLibrary(role: User["role"] | undefined): boolean {
  return role === "admin";
}

export function resolveSettingsTab(tab: SettingsTab, role: User["role"]): SettingsTab {
  if (!canManageLibrary(role) && !["account", "appearance", "playback", "lyrics", "offline", "services"].includes(tab)) return "account";
  return tab;
}

export function resolveLibraryTab(tab: LibraryTab, role: User["role"], mobile: boolean): LibraryTab {
  if (tab === "manage" && !canManageLibrary(role)) return "songs";
  if (tab === "tools" && !canManageLibrary(role)) return "songs";
  if (mobile && tab !== "songs" && tab !== "folders" && tab !== "manage" && tab !== "sources" && tab !== "tools") return "songs";
  return tab;
}
