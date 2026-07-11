import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  CircleNotch,
  ArrowClockwise,
  FolderSimple,
  ImageSquare,
  PencilSimple,
  Record,
  ShieldCheck,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { createT } from "../i18n";
import { api } from "../services/api";
import type { Album, MetadataCandidate, MetadataWritebackResult, Song } from "../types";
import { readableErrorMessage } from "../utils/app";
import { useDialogLifecycle } from "../hooks/useDialogLifecycle";
import {
  getCandidateCache,
  invalidateMetadataCandidateCache,
  loadCandidateCache,
  reloadCandidateCache,
  metadataCandidateCacheKey,
} from "../services/candidateCache";

export type MetadataEditorTarget =
  | { type: "song"; song: Song }
  | { type: "album"; album: Album; songs: Song[] };

export function MetadataEditorDialog({
  target,
  currentCover,
  t,
  onClose,
  onSaved,
}: {
  target: MetadataEditorTarget;
  currentCover?: string;
  t: ReturnType<typeof createT>;
  onClose: () => void;
  onSaved: (result: MetadataWritebackResult) => void;
}) {
  const isAlbum = target.type === "album";
  const initial = useMemo(
    () =>
      isAlbum
        ? {
            title: target.album.title,
            artist: "",
            album: "",
            albumArtist: target.album.album_artist || target.album.artist,
            year: target.album.year ? String(target.album.year) : "",
          }
        : {
            title: target.song.title,
            artist: target.song.artist,
            album: target.song.album,
            albumArtist: "",
            year: target.song.year ? String(target.song.year) : "",
          },
    [isAlbum, target],
  );
  const [title, setTitle] = useState(initial.title);
  const [artist, setArtist] = useState(initial.artist);
  const [album, setAlbum] = useState(initial.album);
  const [albumArtist, setAlbumArtist] = useState(initial.albumArtist);
  const [year, setYear] = useState(initial.year);
  const [coverURL, setCoverURL] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [pathAssist, setPathAssist] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [finalConfirmOpen, setFinalConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MetadataWritebackResult | null>(null);
  const [pathCandidates, setPathCandidates] = useState<MetadataCandidate[]>([]);
  const [onlineCandidates, setOnlineCandidates] = useState<MetadataCandidate[]>([]);
  const [pathCandidatesLoading, setPathCandidatesLoading] = useState(false);
  const [onlineCandidatesLoading, setOnlineCandidatesLoading] = useState(false);
  const [onlineCandidatesError, setOnlineCandidatesError] = useState(false);
  const dialogRef = useDialogLifecycle<HTMLFormElement>(onClose);
  const finalConfirmCancelRef = useRef<HTMLButtonElement | null>(null);
  const previewCover = coverPreview || coverURL.trim() || currentCover;
  const estimatedFiles = metadataTargetFileCount(target);
  const finalTargetTitle = title.trim() || (isAlbum ? target.album.title : target.song.title);
  const finalConfirmMessage = t("metadataFinalConfirm")
    .replace("{count}", String(estimatedFiles))
    .replace("{target}", finalTargetTitle);
  const dirty =
    title.trim() !== initial.title ||
    artist.trim() !== initial.artist ||
    album.trim() !== initial.album ||
    albumArtist.trim() !== initial.albumArtist ||
    year.trim() !== initial.year ||
    coverURL.trim() !== "" ||
    Boolean(coverFile) ||
    pathAssist;
  const canWrite = dirty || isAlbum;
  const candidates = useMemo(
    () => mergeMetadataCandidates(pathCandidates, onlineCandidates),
    [onlineCandidates, pathCandidates],
  );
  const targetType = isAlbum ? "album" : "song";
  const targetID = isAlbum ? target.album.id : target.song.id;
  const onlineKey = metadataCandidateCacheKey(targetType, targetID, "online");

  useEffect(() => {
    setTitle(initial.title);
    setArtist(initial.artist);
    setAlbum(initial.album);
    setAlbumArtist(initial.albumArtist);
    setYear(initial.year);
    setCoverURL("");
    setCoverFile(null);
    setPathAssist(false);
    setConfirmed(false);
    setFinalConfirmOpen(false);
    setError("");
    setResult(null);
  }, [initial]);

  useEffect(() => {
    if (!finalConfirmOpen) return;
    const frame = window.requestAnimationFrame(() => finalConfirmCancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [finalConfirmOpen]);

  useEffect(() => {
    if (!coverFile) {
      setCoverPreview("");
      return;
    }
    const objectURL = URL.createObjectURL(coverFile);
    setCoverPreview(objectURL);
    return () => URL.revokeObjectURL(objectURL);
  }, [coverFile]);

  useEffect(() => {
    let canceled = false;
    const targetType = isAlbum ? "album" : "song";
    const targetID = isAlbum ? target.album.id : target.song.id;
    const pathKey = metadataCandidateCacheKey(targetType, targetID, "path");
    const onlineKey = metadataCandidateCacheKey(targetType, targetID, "online");
    const cachedPath = getCandidateCache<MetadataCandidate>(pathKey);
    const cachedOnline = getCandidateCache<MetadataCandidate>(onlineKey);

    setPathCandidates(cachedPath || []);
    setOnlineCandidates(cachedOnline || []);
    setPathCandidatesLoading(cachedPath === undefined);
    setOnlineCandidatesLoading(false);
    setOnlineCandidatesError(false);

    const loadScope = (scope: "path" | "online") =>
      isAlbum
        ? api.albumMetadataCandidates(target.album.id, scope)
        : api.songMetadataCandidates(target.song.id, scope);

    void (async () => {
      if (cachedPath === undefined) {
        try {
          const items = await loadCandidateCache(pathKey, () => loadScope("path"));
          if (!canceled) setPathCandidates(items);
        } catch {
          if (!canceled) setPathCandidates([]);
        } finally {
          if (!canceled) setPathCandidatesLoading(false);
        }
      }
      if (canceled || cachedOnline !== undefined) return;

      setOnlineCandidatesLoading(true);
      try {
        const items = await loadCandidateCache(onlineKey, () => loadScope("online"));
        if (!canceled) setOnlineCandidates(items);
      } catch {
        if (!canceled) setOnlineCandidatesError(true);
      } finally {
        if (!canceled) setOnlineCandidatesLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [isAlbum, target]);

  const refreshOnlineCandidates = async () => {
    if (onlineCandidatesLoading) return;
    setOnlineCandidatesLoading(true);
    setOnlineCandidatesError(false);
    try {
      const items = await reloadCandidateCache(onlineKey, () => isAlbum
        ? api.albumMetadataCandidates(target.album.id, "online", true)
        : api.songMetadataCandidates(target.song.id, "online", true));
      setOnlineCandidates(items);
    } catch {
      setOnlineCandidatesError(true);
    } finally {
      setOnlineCandidatesLoading(false);
    }
  };

  const applyCandidate = (candidate: MetadataCandidate) => {
    const usePathAssist = candidate.source === "path" && isAlbum;
    setPathAssist(usePathAssist);
    if (candidate.title) {
      setTitle(candidate.title);
    }
    if (isAlbum) {
      if (candidate.artist) setAlbumArtist(candidate.artist);
    } else {
      if (candidate.artist) setArtist(candidate.artist);
      if (candidate.album) setAlbum(candidate.album);
    }
    if (candidate.year) setYear(String(candidate.year));
    if (candidate.cover) {
      setCoverURL(candidate.cover);
      setCoverFile(null);
    }
  };
  const markManualMetadataEdit = () => {
    if (pathAssist) setPathAssist(false);
  };

  const writeMetadata = async () => {
    setError("");
    if (!canWrite || saving) return;
    setFinalConfirmOpen(false);
    const body = new FormData();
    body.set("title", title.trim());
    if (isAlbum) {
      body.set("album_artist", albumArtist.trim());
    } else {
      body.set("artist", artist.trim());
      body.set("album", album.trim());
    }
    body.set("year", year.trim());
    body.set("cover_url", coverFile ? "" : coverURL.trim());
    body.set("path_assist", pathAssist ? "true" : "false");
    body.set("confirm_writeback", "true");
    if (coverFile) body.set("cover", coverFile);
    setSaving(true);
    try {
      const saved = isAlbum
        ? await api.updateAlbumMetadata(target.album.id, body)
        : await api.updateSongMetadata(target.song.id, body);
      invalidateMetadataCandidateCache(isAlbum ? "album" : "song", isAlbum ? target.album.id : target.song.id);
      setResult(saved);
      onSaved(saved);
      setConfirmed(false);
    } catch (err) {
      setError(readableErrorMessage(err, t("metadataWritebackFailed")));
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!canWrite || saving) return;
    if (!confirmed) {
      setError(t("metadataConfirmRequired"));
      return;
    }
    setFinalConfirmOpen(true);
  };

  const trapFinalConfirmKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setFinalConfirmOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const resultItems = Array.isArray(result?.items) ? result.items : [];

  return (
    <div className="modal-layer" role="presentation">
      <button className="modal-scrim" type="button" aria-label={t("close")} onClick={onClose} />
      <form
        ref={dialogRef}
        className="modal-card metadata-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-editor-title"
        onSubmit={submit}
      >
        <div className="modal-card-head">
          <div>
            <p>{isAlbum ? t("album") : t("song")}</p>
            <h2 id="metadata-editor-title">{t("editMetadata")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("close")}>
            <X />
          </button>
        </div>

        <div className="metadata-editor-body">
          <div className="metadata-editor-cover">
            <div className="metadata-cover-preview">
              {previewCover ? <img src={previewCover} alt={t("metadataCoverPreview")} /> : <Record weight="fill" />}
            </div>
            <div>
              <strong>{t("metadataSourceWriteback")}</strong>
              <span>{isAlbum ? t("metadataAlbumHint") : t("metadataSongHint")}</span>
            </div>
          </div>

          <div className="metadata-editor-grid">
            <label>
              {isAlbum ? t("metadataAlbumTitle") : t("metadataSongTitle")}
              <input
                data-autofocus
                type="text"
                value={title}
                maxLength={180}
                autoComplete="off"
                onChange={(event) => {
                  markManualMetadataEdit();
                  setTitle(event.target.value);
                }}
              />
            </label>
            {isAlbum ? (
              <label>
                {t("metadataAlbumArtist")}
                <input
                  type="text"
                  value={albumArtist}
                  maxLength={180}
                  autoComplete="off"
                  onChange={(event) => {
                    markManualMetadataEdit();
                    setAlbumArtist(event.target.value);
                  }}
                />
              </label>
            ) : (
              <>
                <label>
                  {t("metadataArtist")}
                  <input
                    type="text"
                    value={artist}
                    maxLength={180}
                    autoComplete="off"
                    onChange={(event) => {
                      markManualMetadataEdit();
                      setArtist(event.target.value);
                    }}
                  />
                </label>
                <label>
                  {t("metadataAlbumTitle")}
                  <input
                    type="text"
                    value={album}
                    maxLength={180}
                    autoComplete="off"
                    onChange={(event) => {
                      markManualMetadataEdit();
                      setAlbum(event.target.value);
                    }}
                  />
                </label>
              </>
            )}
            <label>
              {t("metadataYear")}
              <input
                value={year}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                autoComplete="off"
                onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </label>
            <label className="metadata-cover-url">
              {t("metadataCoverURL")}
              <input
                type="url"
                value={coverURL}
                placeholder="https://..."
                autoComplete="off"
                onChange={(event) => setCoverURL(event.target.value)}
              />
            </label>
            <label className="metadata-cover-upload">
              <span><UploadSimple /> {t("metadataUploadCover")}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setCoverFile(file);
                  if (file) setCoverURL("");
                }}
              />
            </label>
          </div>

          <div className="metadata-candidates">
            <div className="metadata-section-head">
              <strong>{t("metadataCandidates")}</strong>
              <span className="metadata-candidate-head-actions">
                {pathCandidatesLoading
                  ? t("loading")
                  : onlineCandidatesLoading
                    ? t("metadataOnlineLoading")
                    : `${candidates.length} ${t("candidate")}`}
                <button type="button" onClick={() => void refreshOnlineCandidates()} disabled={onlineCandidatesLoading} aria-label={t("refreshOnlineCandidates")}>
                  <ArrowClockwise /> {t("refresh")}
                </button>
              </span>
            </div>
            {candidates.length ? (
              <>
                <div className="metadata-candidate-list">
                  {candidates.map((candidate) => (
                    <button
                      key={`${candidate.source}-${candidate.id}`}
                      type="button"
                      onClick={() => applyCandidate(candidate)}
                    >
                      {candidate.source === "path"
                        ? <FolderSimple />
                        : candidate.cover
                          ? <img src={candidate.cover} alt="" loading="lazy" />
                          : <ImageSquare />}
                      <span>
                        <strong>{candidate.source === "path" ? t("metadataPathCandidate") : candidate.title}</strong>
                        <em>
                          {candidate.source === "path"
                            ? metadataPathCandidateSummary(candidate, isAlbum, t)
                            : [candidate.artist, candidate.album, candidate.year || candidate.release_date].filter(Boolean).join(" · ")}
                        </em>
                      </span>
                    </button>
                  ))}
                </div>
                {onlineCandidatesLoading ? (
                  <div className="metadata-online-status" data-state="loading" role="status">
                    <CircleNotch weight="bold" className="offline-cache-spinner" />
                    <span>{t("metadataOnlineLoading")}</span>
                  </div>
                ) : onlineCandidatesError ? (
                  <div className="metadata-online-status" data-state="error" role="status">
                    <WarningCircle weight="fill" />
                    <span>{t("metadataOnlineError")}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <span className="metadata-empty">
                {pathCandidatesLoading || onlineCandidatesLoading
                  ? onlineCandidatesLoading
                    ? t("metadataOnlineLoading")
                    : t("loadingContent")
                  : onlineCandidatesError
                    ? t("metadataOnlineError")
                    : t("metadataNoCandidates")}
              </span>
            )}
          </div>

          {error ? <div className="metadata-error" role="alert">{error}</div> : null}
          {result ? (
            <div className="metadata-result">
              <div className="metadata-section-head">
                <strong>{t("metadataWritebackResult")}</strong>
                <span>{result.updated} / {result.skipped} / {result.failed}</span>
              </div>
              <div className="metadata-result-list">
                {resultItems.map((item, index) => (
                  <div key={`${item.path}-${index}`} data-status={item.status}>
                    <strong>{metadataStatusLabel(item.status, t)}</strong>
                    <span title={item.path}>{item.title || item.path}</span>
                    {item.message ? <em>{item.message}</em> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="modal-actions metadata-editor-actions">
          <label className="metadata-confirm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>
              <strong><ShieldCheck /> {t("metadataConfirmTitle")}</strong>
              <em>{pathAssist && isAlbum ? t("metadataPathAssistConfirmBody") : t("metadataConfirmBody")}</em>
            </span>
          </label>
          <div className="metadata-editor-action-buttons">
            <button type="button" onClick={onClose} disabled={saving}>
              {t("close")}
            </button>
            <button className="primary" type="submit" disabled={!canWrite || !confirmed || saving}>
              {saving ? <CircleNotch weight="bold" className="offline-cache-spinner" /> : <PencilSimple />}
              {saving ? t("loading") : t("metadataWriteToFiles")}
            </button>
          </div>
        </div>
        {finalConfirmOpen ? (
          <div className="metadata-write-confirm-layer" role="presentation" onKeyDown={trapFinalConfirmKeyDown}>
            <button
              className="metadata-write-confirm-scrim"
              type="button"
              aria-label={t("cancel")}
              onClick={() => setFinalConfirmOpen(false)}
            />
            <div
              className="metadata-write-confirm-dialog"
              role="alertdialog"
              aria-labelledby="metadata-write-confirm-title"
              aria-describedby="metadata-write-confirm-body"
            >
              <div>
                <strong id="metadata-write-confirm-title"><WarningCircle /> {t("metadataFinalConfirmTitle")}</strong>
                <p id="metadata-write-confirm-body">{finalConfirmMessage}</p>
              </div>
              <div className="metadata-write-confirm-actions">
                <button
                  ref={finalConfirmCancelRef}
                  type="button"
                  onClick={() => setFinalConfirmOpen(false)}
                  disabled={saving}
                >
                  {t("cancel")}
                </button>
                <button className="primary" type="button" onClick={() => void writeMetadata()} disabled={saving}>
                  {saving ? <CircleNotch weight="bold" className="offline-cache-spinner" /> : <ShieldCheck />}
                  {saving ? t("loading") : t("metadataFinalConfirmAction")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function metadataStatusLabel(status: string, t: ReturnType<typeof createT>) {
  if (status === "updated") return t("metadataStatusUpdated");
  if (status === "skipped") return t("metadataStatusSkipped");
  if (status === "failed") return t("metadataStatusFailed");
  return status;
}

function mergeMetadataCandidates(pathItems: MetadataCandidate[], onlineItems: MetadataCandidate[]) {
  const seen = new Set<string>();
  const merged: MetadataCandidate[] = [];
  for (const candidate of [...pathItems, ...onlineItems]) {
    const key = `${candidate.source}:${candidate.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }
  return merged;
}

function metadataPathCandidateSummary(candidate: MetadataCandidate, isAlbum: boolean, t: ReturnType<typeof createT>) {
  if (isAlbum && candidate.path_groups && candidate.path_groups > 1) {
    return t("metadataPathSplitHint")
      .replace("{groups}", String(candidate.path_groups))
      .replace("{count}", String(candidate.song_count || 0));
  }
  return [candidate.title, candidate.artist, candidate.album].filter(Boolean).join(" · ") || t("metadataPathCandidateHint");
}

function metadataTargetFileCount(target: MetadataEditorTarget) {
  if (target.type === "song") return 1;
  const paths = new Set(
    target.songs
      .map((song) => (song.path || "").split("#lark-cue=")[0].trim())
      .filter(Boolean),
  );
  return Math.max(paths.size || target.album.song_count || target.songs.length, 1);
}
