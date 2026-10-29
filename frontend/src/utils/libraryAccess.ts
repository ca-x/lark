import type { User } from "../types";
import type { LibraryTab, SettingsTab } from "../types/app";

export function canManageLibrary(role: User["role"] | undefined): boolean {
  return role === "admin";
}

export function resolveSettingsTab(tab: SettingsTab, role: User["role"]): SettingsTab {
  if (!canManageLibrary(role) && !["account", "playback", "services"].includes(tab)) return "account";
  return tab;
}

export function resolveLibraryTab(tab: LibraryTab, role: User["role"], mobile: boolean): LibraryTab {
  if (tab === "manage" && !canManageLibrary(role)) return "songs";
  if (mobile && tab !== "songs" && tab !== "folders" && tab !== "manage") return "songs";
  return tab;
}
