export const SONGLOFT_PLAYLIST_OFFSET = 1_000_000_000;

export function toSongloftPlaylistID(nativeID: number) {
  const encoded = nativeID + SONGLOFT_PLAYLIST_OFFSET;
  if (!Number.isSafeInteger(nativeID) || nativeID <= 0 || !Number.isSafeInteger(encoded)) throw new Error("invalid playlist ID");
  return encoded;
}

export function fromSongloftPlaylistID(playlistID: number) {
  if (!Number.isSafeInteger(playlistID) || playlistID <= SONGLOFT_PLAYLIST_OFFSET) throw new Error("invalid or legacy Songloft playlist ID; reload the plugin playlist list and select it again");
  return playlistID - SONGLOFT_PLAYLIST_OFFSET;
}

export function songloftPlaylistSource(playlistID: number) {
  if (playlistID === 1) return {};
  return { source: { type: "playlist" as const, source_id: fromSongloftPlaylistID(playlistID) } };
}
