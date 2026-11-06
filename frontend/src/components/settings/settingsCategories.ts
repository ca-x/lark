import type { TKey } from "../../i18n";
import type { SettingsTab } from "../../types/app";

export type SettingsCategory = {
  id: SettingsTab;
  label: string;
  description: string;
  group: string;
};

export function getSettingsCategories(t: (key: TKey) => string, admin: boolean): SettingsCategory[] {
  return [
    { id: "account", label: t("accountSettings"), description: t("settingsAccountHint"), group: t("settingsPersonal") },
    { id: "appearance", label: t("appearanceSettings"), description: t("settingsAppearanceHint"), group: t("settingsPersonal") },
    { id: "playback", label: t("playerSettings"), description: t("settingsPlaybackHint"), group: t("settingsPersonal") },
    { id: "lyrics", label: t("lyricsSettings"), description: t("settingsLyricsHint"), group: t("settingsPersonal") },
    { id: "offline", label: t("offlineSettings"), description: t("settingsOfflineHint"), group: t("settingsPersonal") },
    { id: "services", label: t("servicesConnectionsSettings"), description: t("settingsConnectionsHint"), group: t("settingsConnections") },
    ...(admin ? [
      { id: "library" as const, label: t("mediaLibrarySettings"), description: t("settingsLibraryHint"), group: t("settingsAdministration") },
      { id: "plugins" as const, label: t("pluginManagement"), description: t("pluginManagementHint"), group: t("settingsAdministration") },
      { id: "system" as const, label: t("systemSettings"), description: t("settingsSystemHint"), group: t("settingsAdministration") },
      { id: "users" as const, label: t("userManagement"), description: t("settingsUsersHint"), group: t("settingsAdministration") },
    ] : []),
  ];
}
