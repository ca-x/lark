import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { SettingsTab } from "../../types/app";
import { settingsSearchAliases } from "./settingsSearchRegistry";

type SearchResult = { key: string; tab: SettingsTab; title: string; detail: string; element?: HTMLElement };

export function SettingsSearch({ root, tabs, label, placeholder, emptyLabel, clearLabel, onTabChange }: {
  root: RefObject<HTMLElement | null>;
  tabs: Array<{ id: SettingsTab; label: string }>;
  label: string;
  placeholder: string;
  emptyLabel: string;
  clearLabel: string;
  onTabChange: (tab: SettingsTab) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const normalized = query.trim().toLocaleLowerCase();
  const open = Boolean(normalized && focused);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setFocused(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  const results = useMemo<SearchResult[]>(() => {
    if (!normalized || !root.current) return [];
    const visibleTabs = new Set(tabs.map((tab) => tab.id));
    const elements = Array.from(root.current.querySelectorAll<HTMLElement>(".settings-grid > [data-settings-owner], .settings-tab-panel > [data-settings-owner]"));
    const matches: SearchResult[] = elements.flatMap((element, index) => {
      const tab = element.dataset.settingsOwner as SettingsTab | undefined;
      if (!tab || !visibleTabs.has(tab)) return [];
      const title = element.querySelector("strong, .switch-row > span > span, :scope > span > span")?.textContent?.trim()
        || Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())?.textContent?.trim()
        || tabs.find((item) => item.id === tab)?.label || label;
      const detail = element.querySelector("small, .settings-section-text > span")?.textContent?.trim() || tabs.find((item) => item.id === tab)?.label || "";
      const searchable = [title, detail, element.textContent || ""].join(" ").toLocaleLowerCase();
      if (!searchable.includes(normalized)) return [];
      return [{ key: `${tab}-${index}`, tab, title, detail, element }];
    });
    const categories = tabs.filter((tab) => !matches.some((match) => match.tab === tab.id)
      && [tab.label, ...(settingsSearchAliases[tab.id] || [])].some((text) => text.toLocaleLowerCase().includes(normalized)))
      .map((tab) => ({ key: `category-${tab.id}`, tab: tab.id, title: tab.label, detail: "" }));
    return [...matches, ...categories].slice(0, 12);
  }, [emptyLabel, label, normalized, root, tabs]);

  useEffect(() => {
    setActiveIndex((index) => results.length ? Math.min(Math.max(index, 0), results.length - 1) : -1);
  }, [results.length]);

  const selectResult = (result: SearchResult) => {
    setQuery("");
    setActiveIndex(-1);
    onTabChange(result.tab);
    window.requestAnimationFrame(() => {
      const element = result.element || root.current?.querySelector<HTMLElement>(".settings-category-header");
      if (!element) return;
      element.querySelector<HTMLButtonElement>('.settings-section-head[aria-expanded="false"]')?.click();
      window.requestAnimationFrame(() => {
        element.scrollIntoView({ block: "center", inline: "nearest" });
        const controls = element.querySelector<HTMLElement>(".settings-section-body") || element;
        const focusTarget = controls.querySelector<HTMLElement>("input:not([disabled]):not([type='file']), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
        if (focusTarget) focusTarget.focus({ preventScroll: true });
        else {
          element.tabIndex = -1;
          element.focus({ preventScroll: true });
        }
      });
    });
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (!normalized || !results.length) {
      if (event.key === "Escape" && query) setQuery("");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectResult(results[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setActiveIndex(-1);
    }
  };

  return (
    <div className="settings-search" ref={containerRef} onFocus={() => setFocused(true)} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
      <label>
        <MagnifyingGlass aria-hidden="true" />
        <span className="sr-only">{label}</span>
        <input
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          value={query}
          placeholder={placeholder}
          onKeyDown={onInputKeyDown}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />
        {query ? (
          <button type="button" aria-label={clearLabel} onClick={() => { setQuery(""); setActiveIndex(-1); }}>
            <X aria-hidden="true" />
          </button>
        ) : null}
      </label>
      {open ? (
        <div id={listboxId} className="settings-search-results" role="listbox" aria-label={label}>
          {results.length ? results.map((result, index) => (
            <button
              key={result.key}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={activeIndex === index}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => selectResult(result)}
            >
              <span><strong>{result.title}</strong><small>{result.detail}</small></span>
              <em>{tabs.find((tab) => tab.id === result.tab)?.label}</em>
            </button>
          )) : <div className="settings-search-empty">{emptyLabel}</div>}
        </div>
      ) : null}
    </div>
  );
}
