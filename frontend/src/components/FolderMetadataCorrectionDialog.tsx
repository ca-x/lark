import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, CircleNotch, Database, FileAudio, FolderSimple, ShieldCheck, WarningCircle, X } from "@phosphor-icons/react";
import { useDialogLifecycle } from "../hooks/useDialogLifecycle";
import type { createT } from "../i18n";
import { api } from "../services/api";
import type { FolderMetadataCorrectionInput, FolderMetadataCorrectionPreview, FolderMetadataCorrectionResult, FolderMetadataField } from "../types";
import { readableErrorMessage } from "../utils/app";

export function FolderMetadataCorrectionDialog({
  path,
  folderName,
  t,
  onClose,
  onDatabaseUpdated,
}: {
  path: string;
  folderName: string;
  t: ReturnType<typeof createT>;
  onClose: () => void;
  onDatabaseUpdated: () => void;
}) {
  const [field, setField] = useState<FolderMetadataField>("artist");
  const [value, setValue] = useState(folderName);
  const [writeFiles, setWriteFiles] = useState(true);
  const [updateDatabase, setUpdateDatabase] = useState(true);
  const [preview, setPreview] = useState<FolderMetadataCorrectionPreview | null>(null);
  const [result, setResult] = useState<FolderMetadataCorrectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogLifecycle<HTMLFormElement>(onClose);

  const invalidatePreview = () => {
    setPreview(null);
    setResult(null);
    setError("");
  };
  const input: FolderMetadataCorrectionInput = {
    path,
    field,
    value: value.trim(),
    write_files: writeFiles,
    update_database: updateDatabase,
  };
  const invalid = !value.trim() || (!writeFiles && !updateDatabase);

  const loadPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalid || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setPreview(await api.folderMetadataCorrectionPreview(input));
    } catch (err) {
      setError(readableErrorMessage(err, t("folderMetadataPreviewFailed")));
    } finally {
      setLoading(false);
    }
  };

  const applyCorrection = async () => {
    if (!preview || invalid || loading) return;
    setLoading(true);
    setError("");
    try {
      const saved = await api.folderMetadataCorrection({
        ...input,
        confirm: true,
        expected_song_count: preview.song_count,
        expected_file_count: preview.file_count,
        expected_snapshot: preview.snapshot,
      });
      setResult(saved);
      setPreview(null);
      if (saved.database_updated > 0) onDatabaseUpdated();
    } catch (err) {
      setError(readableErrorMessage(err, t("folderMetadataCorrectionFailed")));
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="modal-layer" role="presentation">
      <button className="modal-scrim" type="button" aria-label={t("close")} onClick={onClose} />
      <form
        ref={dialogRef}
        className="modal-card folder-metadata-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-metadata-dialog-title"
        onSubmit={loadPreview}
      >
        <div className="modal-card-head">
          <div>
            <p>{t("folderMetadataBatchAction")}</p>
            <h2 id="folder-metadata-dialog-title">{t("folderMetadataCorrect")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("close")}>
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="folder-metadata-context">
          <FolderSimple weight="fill" aria-hidden="true" />
          <span>
            <strong>{folderName}</strong>
            <small>{t("folderMetadataRecursiveHint")}</small>
          </span>
        </div>

        <div className="folder-metadata-fields">
          <label>
            {t("folderMetadataField")}
            <select
              data-autofocus
              value={field}
              onChange={(event) => {
                setField(event.target.value as FolderMetadataField);
                invalidatePreview();
              }}
            >
              <option value="artist">{t("metadataArtist")}</option>
              <option value="album">{t("metadataAlbumTitle")}</option>
              <option value="album_artist">{t("metadataAlbumArtist")}</option>
              <option value="genre">{t("folderMetadataFieldGenre")}</option>
              <option value="year">{t("metadataYear")}</option>
              <option value="language">{t("folderMetadataFieldLanguage")}</option>
              <option value="style">{t("folderMetadataFieldStyle")}</option>
              <option value="title">{t("metadataSongTitle")}</option>
              <option value="track">{t("folderMetadataFieldTrack")}</option>
            </select>
          </label>
          <label>
            {t("folderMetadataTargetValue")}
            <input
              type="text"
              inputMode={field === "year" ? "numeric" : undefined}
              maxLength={field === "year" ? 4 : 180}
              value={value}
              onChange={(event) => {
                setValue(field === "year" ? event.target.value.replace(/\D/g, "").slice(0, 4) : event.target.value);
                invalidatePreview();
              }}
            />
          </label>
        </div>

        {(field === "title" || field === "track") ? (
          <div className="folder-metadata-warning" role="note">
            <WarningCircle weight="fill" aria-hidden="true" />
            <span>{t("folderMetadataSameValueWarning")}</span>
          </div>
        ) : null}

        <fieldset className="folder-metadata-destinations">
          <legend>{t("folderMetadataDestinations")}</legend>
          <label data-selected={writeFiles}>
            <input
              type="checkbox"
              checked={writeFiles}
              onChange={(event) => {
                setWriteFiles(event.target.checked);
                invalidatePreview();
              }}
            />
            <FileAudio aria-hidden="true" />
            <span>
              <strong>{t("folderMetadataWriteFiles")}</strong>
              <small>{t("folderMetadataWriteFilesHint")}</small>
            </span>
          </label>
          <label data-selected={updateDatabase}>
            <input
              type="checkbox"
              checked={updateDatabase}
              onChange={(event) => {
                setUpdateDatabase(event.target.checked);
                invalidatePreview();
              }}
            />
            <Database aria-hidden="true" />
            <span>
              <strong>{t("folderMetadataUpdateDatabase")}</strong>
              <small>{t("folderMetadataUpdateDatabaseHint")}</small>
            </span>
          </label>
        </fieldset>

        {!writeFiles && !updateDatabase ? <div className="metadata-error" role="alert">{t("folderMetadataDestinationRequired")}</div> : null}
        {error ? <div className="metadata-error" role="alert">{error}</div> : null}

        {preview ? (
          <section className="folder-metadata-preview" aria-labelledby="folder-metadata-preview-title">
            <div className="metadata-section-head">
              <strong id="folder-metadata-preview-title">{t("folderMetadataPreview")}</strong>
              <span>{preview.song_count} {t("songs")} · {preview.file_count} {t("files")}</span>
            </div>
            <div className="folder-metadata-preview-list">
              {preview.items.map((item) => (
                <div key={item.song_id}>
                  <strong title={item.file_name}>{item.title || item.file_name}</strong>
                  <span>{item.before || t("emptyValue")}</span>
                  <span aria-hidden="true">→</span>
                  <span>{item.after}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {result ? (
          <section className="folder-metadata-result" role="status" data-failed={result.failed > 0}>
            {result.failed > 0 ? <WarningCircle weight="fill" aria-hidden="true" /> : <CheckCircle weight="fill" aria-hidden="true" />}
            <span>
              <strong>{t(result.failed > 0 ? "folderMetadataCorrectionPartial" : "folderMetadataCorrectionDone")}</strong>
              <small>
                {t("folderMetadataResultSummary")
                  .replace("{files}", String(result.file_updated))
                  .replace("{database}", String(result.database_updated))
                  .replace("{failed}", String(result.failed))}
              </small>
              {result.failed > 0 ? (
                <span className="folder-metadata-failures">
                  {result.items.filter((item) => item.file_status === "failed" || item.database_status === "failed" || item.message).slice(0, 6).map((item) => (
                    <em key={item.song_id}>{item.file_name}: {item.message || t("metadataStatusFailed")}</em>
                  ))}
                </span>
              ) : null}
            </span>
          </section>
        ) : null}

        <div className="modal-actions folder-metadata-actions">
          <button type="button" onClick={onClose} disabled={loading}>{t("close")}</button>
          {preview ? (
            <button className="primary" type="button" onClick={() => void applyCorrection()} disabled={(!writeFiles && !updateDatabase) || loading}>
              {loading ? <CircleNotch className="offline-cache-spinner" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              {loading ? t("loading") : t("folderMetadataConfirmApply")}
            </button>
          ) : (
            <button className="primary" type="submit" disabled={(!writeFiles && !updateDatabase) || !value.trim() || loading}>
              {loading ? <CircleNotch className="offline-cache-spinner" aria-hidden="true" /> : null}
              {loading ? t("loading") : t("folderMetadataPreview")}
            </button>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
