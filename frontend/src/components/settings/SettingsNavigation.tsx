import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CloudArrowDown, GearSix, MusicNotes, PaintBrush, PlugsConnected, PuzzlePiece, TextAlignLeft, UserCircle, Users, VinylRecord } from "@phosphor-icons/react";
import type { SettingsTab } from "../../types/app";
import type { SettingsCategory } from "./settingsCategories";

const categoryIcons = {
  account: UserCircle, appearance: PaintBrush, playback: VinylRecord,
  lyrics: TextAlignLeft, offline: CloudArrowDown, services: PlugsConnected,
  library: MusicNotes, plugins: PuzzlePiece, system: GearSix, users: Users,
};

type SettingsNavigationProps = {
  activeTab: SettingsTab;
  tabs: SettingsCategory[];
  label: string;
  categoryLabel: string;
  onTabChange: (tab: SettingsTab) => void;
};

export function SettingsNavigation({ activeTab, tabs, label, categoryLabel, onTabChange }: SettingsNavigationProps) {
  const tabRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());
  const [vertical, setVertical] = useState(() => window.matchMedia("(min-width: 1180px)").matches);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1180px)");
    const update = () => setVertical(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const tab = tabRefs.current.get(activeTab);
    const list = tab?.closest<HTMLElement>(".settings-navigation");
    if (!tab || !list || !list.clientHeight) return;
    const tabBounds = tab.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    const above = tabBounds.top - listBounds.top;
    const below = tabBounds.bottom - listBounds.bottom;
    list.scrollTop += above < 0 ? above : Math.max(0, below);
  }, [activeTab, vertical]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === (vertical ? "ArrowDown" : "ArrowRight")) nextIndex = (index + 1) % tabs.length;
    else if (event.key === (vertical ? "ArrowUp" : "ArrowLeft")) nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[nextIndex];
    onTabChange(next.id);
    tabRefs.current.get(next.id)?.focus({ preventScroll: true });
  };

  return (
    <div className="settings-navigation">
      <label className="settings-category-picker">
        <span>{categoryLabel}</span>
        <select value={activeTab} onChange={(event) => onTabChange(event.target.value as SettingsTab)}>
          {[...new Set(tabs.map((tab) => tab.group))].map((group) => (
            <optgroup key={group} label={group}>
              {tabs.filter((tab) => tab.group === group).map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="settings-tabs" role="tablist" aria-label={label} aria-orientation={vertical ? "vertical" : "horizontal"}>
        {tabs.map((tab, index) => {
          const Icon = categoryIcons[tab.id];
          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element);
                else tabRefs.current.delete(tab.id);
              }}
              id={`settings-tab-${tab.id}`}
              type="button"
              role="tab"
              tabIndex={activeTab === tab.id ? 0 : -1}
              aria-controls="settings-panel"
              aria-label={tab.label}
              aria-selected={activeTab === tab.id}
              data-group-start={index === 0 || tabs[index - 1].group !== tab.group ? tab.group : undefined}
              className={activeTab === tab.id ? "active" : ""}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              onClick={() => onTabChange(tab.id)}
            >
              <Icon aria-hidden="true" weight={activeTab === tab.id ? "fill" : "regular"} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
