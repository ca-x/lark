import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, Pause, Play, Plus, X } from "@phosphor-icons/react";
import type { createT } from "../i18n";
import type { RadioSource, RadioStation } from "../types";

import { radioGroupName } from "./radio";
function radioSourceGroups(sources: RadioSource[]) {
  const groups: Array<{ name: string; sources: RadioSource[] }> = [];
  const index = new Map<string, number>();
  for (const source of sources) {
    const name = radioGroupName(source);
    const key = name.toLowerCase();
    const groupIndex = index.get(key);
    if (groupIndex === undefined) {
      index.set(key, groups.length);
      groups.push({ name, sources: [source] });
    } else {
      groups[groupIndex].sources.push(source);
    }
  }
  return groups;
}

export function LibraryRadioSources({
  sources,
  t,
  onOpenRadio,
  onPlayRadio,
}: {
  sources: RadioSource[];
  t: ReturnType<typeof createT>;
  onOpenRadio: (source?: RadioSource) => void;
  onPlayRadio: (source: RadioSource, groupSources?: RadioSource[]) => void;
}) {
  const groups = useMemo(() => radioSourceGroups(sources), [sources]);
  return (
    <div className="source-grid radio-group-grid">
      {groups.map((group) => {
        const first = group.sources[0];
        return (
          <article key={group.name} className="source-card radio-source-card">
            <span>{first?.builtin ? t("defaultSource") : t("customSource")}</span>
            <strong>{group.name}</strong>
            <p>{group.sources.length > 1 ? `${group.sources.length} ${t("liveRadio")}` : first?.name}</p>
            <div>
              <button className="primary" onClick={() => first && onPlayRadio(first, group.sources)} disabled={!first}>
                <Play weight="fill" /> {t("playRadio")}
              </button>
              <button onClick={() => first && onOpenRadio(first)} disabled={!first}>{t("browseRadio")}</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}


export function RadioView({
  t,
  query,
  setQuery,
  sources,
  stations,
  selectedGroup,
  setSelectedGroup,
  currentRadio,
  playing,
  loading,
  onPlayStation,
  onPlaySource,
  onSearch,
  onAddSource,
  onDeleteSource,
}: {
  t: ReturnType<typeof createT>;
  query: string;
  setQuery: (value: string) => void;
  sources: RadioSource[];
  stations: RadioStation[];
  selectedGroup: string;
  setSelectedGroup: (value: string) => void;
  currentRadio: RadioStation | null;
  playing: boolean;
  loading: boolean;
  onPlayStation: (station: RadioStation) => void;
  onPlaySource: (source: RadioSource, groupSources?: RadioSource[]) => void;
  onSearch: () => void;
  onAddSource: (name: string, url: string) => void;
  onDeleteSource: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [url, setURL] = useState("");
  const sourceGroups = useMemo(() => radioSourceGroups(sources), [sources]);
  const activeGroup = sourceGroups.find((group) => group.name === selectedGroup) || sourceGroups[0];
  useEffect(() => {
    if (!sourceGroups.length) return;
    if (!sourceGroups.some((group) => group.name === selectedGroup)) {
      setSelectedGroup(sourceGroups[0].name);
    }
  }, [sourceGroups, selectedGroup, setSelectedGroup]);
  const submitSource = () => {
    if (!name.trim() || !url.trim()) return;
    onAddSource(name, url);
    setName("");
    setURL("");
  };
  return (
    <section className="radio-view">
      <div className="section-head library-actions">
        <div>
          <h2>{t("onlineRadio")}</h2>
          <p className="section-subtitle">{t("radioPageHint")}</p>
        </div>
        <button className="primary compact-action" disabled={!activeGroup?.sources.length} onClick={() => activeGroup?.sources[0] && onPlaySource(activeGroup.sources[0], activeGroup.sources)}>
          <Play weight="fill" /> {t("playRadio")}
        </button>
      </div>

      <div className="radio-layout">
        <aside className="radio-sources-panel">
          <div className="section-head compact radio-source-head">
            <div>
              <h3>{t("radioSources")}</h3>
              <p className="section-subtitle">{activeGroup ? `${activeGroup.name} · ${activeGroup.sources.length}` : t("emptyCollection")}</p>
            </div>
            <button disabled={!activeGroup?.sources.length} onClick={() => activeGroup?.sources[0] && onPlaySource(activeGroup.sources[0], activeGroup.sources)}>
              <Play weight="fill" />
            </button>
          </div>
          <div className="radio-group-tabs" role="tablist" aria-label={t("radioSources")}>
            {sourceGroups.map((group) => (
              <button
                key={group.name}
                type="button"
                className={activeGroup?.name === group.name ? "active" : ""}
                onClick={() => setSelectedGroup(group.name)}
              >
                <strong>{group.name}</strong>
                <small>{group.sources.length}</small>
              </button>
            ))}
          </div>
          <div className="radio-source-list">
            {(activeGroup?.sources ?? []).map((source) => (
              <article key={source.id} className="radio-source-row">
                <button onClick={() => onPlaySource(source, activeGroup?.sources)}>
                  <Play weight="fill" />
                  <span>
                    <strong>{source.name}</strong>
                    <small>{source.builtin ? t("defaultSource") : (source.source_url || source.url)}</small>
                  </span>
                </button>
                {!source.builtin ? (
                  <button className="icon-danger" aria-label={t("deleteSource")} onClick={() => onDeleteSource(source.id)}>
                    <X />
                  </button>
                ) : null}
              </article>
            ))}
          </div>
          <div className="radio-source-form">
            <strong>{t("addRadioSource")}</strong>
            <input value={name} placeholder={t("sourceName")} onChange={(event) => setName(event.target.value)} />
            <input value={url} placeholder="https://…/stream.pls" onChange={(event) => setURL(event.target.value)} />
            <button onClick={submitSource} disabled={!name.trim() || !url.trim()}>
              <Plus /> {t("addRadioSource")}
            </button>
          </div>
        </aside>

        <section className="radio-browser-panel">
          <div className="section-head compact">
            <div>
              <h3>{t("radioBrowser")}</h3>
              <p className="section-subtitle">{t("radioBrowserHint")}</p>
            </div>
            <label className="search radio-search inline-radio-search">
              <MagnifyingGlass />
              <input
                value={query}
                placeholder={t("searchRadio")}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSearch();
                }}
              />
            </label>
            <button onClick={onSearch} disabled={loading}>
              <MagnifyingGlass /> {loading ? t("loading") : t("search")}
            </button>
          </div>
          <div className="radio-station-list" aria-busy={loading}>
            {stations.map((station) => {
              const active = currentRadio?.url === station.url;
              return (
                <article key={`${station.id}-${station.url}`} className={active ? "radio-station active" : "radio-station"}>
                  <button className="station-play" onClick={() => onPlayStation(station)}>
                    {active && playing ? <Pause weight="fill" /> : <Play weight="fill" />}
                  </button>
                  <div>
                    <strong>{station.name}</strong>
                    <small>
                      {[station.country, station.codec, station.bitrate ? `${station.bitrate}kbps` : "", station.tags]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                  <span>{station.votes ? `${station.votes} ${t("votes")}` : t("liveRadio")}</span>
                </article>
              );
            })}
            {!stations.length && !loading ? <div className="empty">{t("emptyCollection")}</div> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

