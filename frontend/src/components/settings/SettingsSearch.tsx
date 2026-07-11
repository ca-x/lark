import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useMemo, useState, type RefObject } from "react";
import type { SettingsTab } from "../../types/app";
import { settingsSearchAliases } from "./settingsSearchRegistry";

type SearchResult = { key: string; tab: SettingsTab; title: string; detail: string; element: HTMLElement };

export function SettingsSearch({ root, tabs, label, placeholder, emptyLabel, onTabChange }: {
  root: RefObject<HTMLElement | null>;
  tabs: Array<{ id: SettingsTab; label: string }>;
  label: string;
  placeholder: string;
  emptyLabel: string;
  onTabChange: (tab: SettingsTab) => void;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const results = useMemo<SearchResult[]>(() => {
    if (!normalized || !root.current) return [];
    const visibleTabs = new Set(tabs.map((tab) => tab.id));
    const elements = Array.from(root.current.querySelectorAll<HTMLElement>(".settings-grid > [data-settings-owner], .settings-tab-panel > [data-settings-owner]"));
    return elements.flatMap((element, index) => {
      const tab = element.dataset.settingsOwner as SettingsTab | undefined;
      if (!tab || !visibleTabs.has(tab)) return [];
      const title = element.querySelector("strong")?.textContent?.trim() || tabs.find((item) => item.id === tab)?.label || label;
      const detail = element.querySelector("span")?.textContent?.trim() || tabs.find((item) => item.id === tab)?.label || "";
      const searchable = [title, detail, element.textContent || "", ...(settingsSearchAliases[tab] || [])].join(" ").toLocaleLowerCase();
      if (!searchable.includes(normalized)) return [];
      return [{ key: `${tab}-${index}`, tab, title, detail, element }];
    }).slice(0, 12);
  }, [emptyLabel, label, normalized, root, tabs]);

  const selectResult = (result: SearchResult) => {
    onTabChange(result.tab);
    window.requestAnimationFrame(() => {
      result.element.scrollIntoView({ block: "center", inline: "nearest" });
      const focusTarget = result.element.querySelector<HTMLElement>("input, select, textarea, button");
      if (focusTarget) focusTarget.focus();
      else {
        result.element.tabIndex = -1;
        result.element.focus();
      }
    });
  };

  return (
    <div className="settings-search">
      <label>
        <MagnifyingGlass aria-hidden="true" />
        <span className="sr-only">{label}</span>
        <input type="search" value={query} placeholder={placeholder} onChange={(event) => setQuery(event.target.value)} />
        {query ? <button type="button" aria-label={label} onClick={() => setQuery("")}><X /></button> : null}
      </label>
      {normalized ? (
        <div className="settings-search-results" role="listbox" aria-label={label}>
          {results.length ? results.map((result) => (
            <button key={result.key} type="button" role="option" onClick={() => selectResult(result)}>
              <span><strong>{result.title}</strong><small>{result.detail}</small></span>
              <em>{tabs.find((tab) => tab.id === result.tab)?.label}</em>
            </button>
          )) : <div className="settings-search-empty">{emptyLabel}</div>}
        </div>
      ) : null}
    </div>
  );
}
