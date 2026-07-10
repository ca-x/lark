import { useEffect, useRef } from "react";
import type { SettingsTab } from "../../types/app";

type SettingsNavigationProps = {
  activeTab: SettingsTab;
  tabs: Array<{ id: SettingsTab; label: string }>;
  label: string;
  onTabChange: (tab: SettingsTab) => void;
};

export function SettingsNavigation({ activeTab, tabs, label, onTabChange }: SettingsNavigationProps) {
  const tabRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());

  useEffect(() => {
    tabRefs.current.get(activeTab)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);

  return (
    <div className="settings-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={(element) => {
            if (element) tabRefs.current.set(tab.id, element);
            else tabRefs.current.delete(tab.id);
          }}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          className={activeTab === tab.id ? "active" : ""}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
