import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SettingsTab } from "../../types/app";

type SettingsNavigationProps = {
  activeTab: SettingsTab;
  tabs: Array<{ id: SettingsTab; label: string }>;
  label: string;
  onTabChange: (tab: SettingsTab) => void;
};

export function SettingsNavigation({ activeTab, tabs, label, onTabChange }: SettingsNavigationProps) {
  const tabRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollEdges, setScrollEdges] = useState({ start: false, end: false });

  const updateScrollEdges = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    setScrollEdges({
      start: list.scrollLeft > 2,
      end: list.scrollLeft + list.clientWidth < list.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    tabRefs.current.get(activeTab)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    window.requestAnimationFrame(updateScrollEdges);
  }, [activeTab, updateScrollEdges]);

  useEffect(() => {
    updateScrollEdges();
    const list = listRef.current;
    if (!list) return;
    const resizeObserver = new ResizeObserver(updateScrollEdges);
    resizeObserver.observe(list);
    return () => resizeObserver.disconnect();
  }, [tabs.length, updateScrollEdges]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[nextIndex];
    onTabChange(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  return (
    <div
      className="settings-tabs-shell"
      data-overflow-start={scrollEdges.start ? "true" : "false"}
      data-overflow-end={scrollEdges.end ? "true" : "false"}
    >
      <div ref={listRef} className="settings-tabs" role="tablist" aria-label={label} onScroll={updateScrollEdges}>
        {tabs.map((tab, index) => (
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
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
