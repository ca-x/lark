import { useEffect, useMemo, useState } from "react";
import { Pause, PencilSimple, Play, Plus, X } from "@phosphor-icons/react";
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
  sources,
  selectedGroup,
  setSelectedGroup,
  currentRadio,
  playing,
  onPlaySource,
  onAddSource,
  onDeleteSource,
}: {
  t: ReturnType<typeof createT>;
  sources: RadioSource[];
  selectedGroup: string;
  setSelectedGroup: (value: string) => void;
  currentRadio: RadioStation | null;
  playing: boolean;
  onPlaySource: (source: RadioSource, groupSources?: RadioSource[]) => void;
  onAddSource: (name: string, url: string) => void;
  onDeleteSource: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [url, setURL] = useState("");
  const [editingGroup, setEditingGroup] = useState("");
  const sourceGroups = useMemo(() => radioSourceGroups(sources), [sources]);
  const activeGroup = sourceGroups.find((group) => group.name === selectedGroup) || sourceGroups[0];

  useEffect(() => {
    if (!sourceGroups.length) return;
    if (!sourceGroups.some((group) => group.name === selectedGroup)) {
      setSelectedGroup(sourceGroups[0].name);
    }
  }, [sourceGroups, selectedGroup, setSelectedGroup]);

  const resetSourceForm = () => {
    setName("");
    setURL("");
    setEditingGroup("");
  };

  const submitSource = () => {
    if (!name.trim() || !url.trim()) return;
    onAddSource(name, url);
    resetSourceForm();
  };

  const editGroup = (group: { name: string; sources: RadioSource[] }) => {
    const first = group.sources.find((source) => !source.builtin) || group.sources[0];
    if (!first || first.builtin) return;
    setEditingGroup(group.name);
    setName(group.name);
    setURL(first.source_url || first.url);
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

      <div className="radio-layout unified-radio-layout">
        <aside className="radio-sources-panel unified-radio-sources">
          <div className="section-head compact radio-source-head">
            <div>
              <h3>{t("radioSources")}</h3>
              <p className="section-subtitle">{activeGroup ? `${activeGroup.name} · ${activeGroup.sources.length}` : t("emptyCollection")}</p>
            </div>
            <button disabled={!activeGroup?.sources.length} onClick={() => activeGroup?.sources[0] && onPlaySource(activeGroup.sources[0], activeGroup.sources)}>
              <Play weight="fill" />
            </button>
          </div>

          <div className="radio-source-list source-only-list">
            {sourceGroups.map((group) => {
              const first = group.sources[0];
              const editable = group.sources.find((source) => !source.builtin);
              const active = activeGroup?.name === group.name;
              return (
                <article key={group.name} className={active ? "radio-source-row source-group-row active" : "radio-source-row source-group-row"}>
                  <button className="source-group-select" onClick={() => setSelectedGroup(group.name)}>
                    <span className="source-dot" aria-hidden="true" />
                    <span>
                      <strong>{group.name}</strong>
                      <small>{first?.builtin ? t("defaultSource") : (first?.source_url || first?.url)} · {group.sources.length}</small>
                    </span>
                  </button>
                  <div className="source-row-actions">
                    <button title={t("playRadio")} aria-label={t("playRadio")} onClick={() => first && onPlaySource(first, group.sources)} disabled={!first}>
                      <Play weight="fill" />
                    </button>
                    {editable ? (
                      <>
                        <button title={t("save")} aria-label={t("save")} onClick={() => editGroup(group)}>
                          <PencilSimple />
                        </button>
                        <button className="icon-danger" title={t("deleteSource")} aria-label={t("deleteSource")} onClick={() => onDeleteSource(editable.id)}>
                          <X />
                        </button>
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="radio-source-form compact-source-form">
            <strong>{editingGroup ? `${t("save")} · ${editingGroup}` : t("addRadioSource")}</strong>
            <input value={name} placeholder={t("sourceName")} onChange={(event) => setName(event.target.value)} />
            <input value={url} placeholder="https://…/stream.pls" onChange={(event) => setURL(event.target.value)} />
            <div className="source-form-actions">
              <button onClick={submitSource} disabled={!name.trim() || !url.trim()}>
                <Plus /> {editingGroup ? t("save") : t("addRadioSource")}
              </button>
              {editingGroup ? <button onClick={resetSourceForm}>{t("cancel")}</button> : null}
            </div>
          </div>
        </aside>

        <section className="radio-browser-panel unified-radio-directory">
          <div className="section-head compact radio-directory-head">
            <div>
              <h3>{activeGroup?.name || t("radioBrowser")}</h3>
              <p className="section-subtitle">
                {activeGroup ? `${t("radioSources")} · ${activeGroup.sources.length}` : t("emptyCollection")}
              </p>
            </div>
          </div>

          <div className="radio-station-list">
            {(activeGroup?.sources ?? []).map((source) => {
              const active = currentRadio?.id === source.id || currentRadio?.url === (source.stream_url || source.url);
              return (
                <article key={source.id} className={active ? "radio-station active" : "radio-station"}>
                  <button className="station-play" onClick={() => onPlaySource(source, activeGroup?.sources)}>
                    {active && playing ? <Pause weight="fill" /> : <Play weight="fill" />}
                  </button>
                  <div>
                    <strong>{source.name}</strong>
                    <small>{source.builtin ? t("defaultSource") : (source.source_url || source.url)}</small>
                  </div>
                  <span>{t("liveRadio")}</span>
                </article>
              );
            })}
            {!activeGroup?.sources.length ? <div className="empty">{t("emptyCollection")}</div> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
