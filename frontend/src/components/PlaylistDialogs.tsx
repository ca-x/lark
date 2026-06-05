import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import type { createT } from "../i18n";
import type { Playlist, Song } from "../types";
import { useDialogLifecycle } from "../hooks/useDialogLifecycle";

export function PlaylistDialog({
  t,
  submitting,
  onCancel,
  onSubmit,
}: {
  t: ReturnType<typeof createT>;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (name: string, description: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const trimmedName = name.trim();
  const dialogRef = useDialogLifecycle<HTMLFormElement>(onCancel);
  return (
    <div className="modal-layer" role="presentation">
      <button
        className="modal-scrim"
        type="button"
        aria-label={t("close")}
        onClick={onCancel}
      />
      <form
        ref={dialogRef}
        className="modal-card playlist-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedName || submitting) return;
          onSubmit(trimmedName, description.trim());
        }}
      >
        <div>
          <p>{t("playlists")}</p>
          <h2 id="playlist-dialog-title">{t("createPlaylist")}</h2>
        </div>
        <label>
          {t("playlistName")}
          <input
            value={name}
            autoFocus
            required
            maxLength={80}
            placeholder={t("playlistName")}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {t("playlistDescription")}
          <input
            value={description}
            maxLength={160}
            placeholder={t("playlistDescriptionOptional")}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={submitting}>
            {t("cancel")}
          </button>
          <button className="primary" type="submit" disabled={!trimmedName || submitting}>
            {submitting ? t("loading") : t("createPlaylist")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function AddToPlaylistDialog({
  t,
  song,
  playlists,
  onCancel,
  onSubmit,
  onCreate,
}: {
  t: ReturnType<typeof createT>;
  song: Song;
  playlists: Playlist[];
  onCancel: () => void;
  onSubmit: (playlistId: number) => void;
  onCreate: () => void;
}) {
  const [selected, setSelected] = useState(playlists[0]?.id ?? 0);
  const dialogRef = useDialogLifecycle<HTMLDivElement>(onCancel);
  return (
    <div className="modal-layer" role="presentation">
      <button className="modal-scrim" type="button" aria-label={t("close")} onClick={onCancel} />
      <div ref={dialogRef} className="modal-card playlist-picker" role="dialog" aria-modal="true" aria-labelledby="playlist-picker-title">
        <div className="modal-card-head">
          <div>
            <p>{t("addToPlaylist")}</p>
            <h2 id="playlist-picker-title">{song.title}</h2>
          </div>
          <button type="button" onClick={onCreate}><Plus /> {t("createPlaylist")}</button>
        </div>
        <div className="playlist-picker-list">
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className={selected === playlist.id ? "active" : ""}
              onClick={() => setSelected(playlist.id)}
            >
              <strong>{playlist.name}</strong>
              <span>{playlist.song_count} {t("count")}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>{t("cancel")}</button>
          <button className="primary" type="button" disabled={!selected} onClick={() => onSubmit(selected)}>
            {t("addToPlaylist")}
          </button>
        </div>
      </div>
    </div>
  );
}
