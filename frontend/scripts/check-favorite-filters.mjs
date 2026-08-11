import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const app = read("src/App.tsx");
const cards = read("src/components/CardGrid.tsx");
const api = read("src/services/api.ts");
const i18n = read("src/i18n.ts");
const styles = read("src/styles.css");
const mobile = read("src/mobile.css");
const server = read("../backend/internal/api/server.go");
const catalog = read("../backend/internal/library/catalog.go");

const functionBlock = (startMarker, endMarker) => {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `App.tsx is missing ${startMarker}`);
  assert.notEqual(end, -1, `App.tsx is missing ${endMarker}`);
  return app.slice(start, end);
};

for (const marker of [
  "albumFavoritesOnly",
  "artistFavoritesOnly",
  "FavoriteFilterToggle",
  'aria-pressed={active}',
  "favorite-filter-toggle",
  "emptyFavoriteAlbums",
  "emptyFavoriteArtists",
  "albumBrowseIntentRef",
  "artistBrowseIntentRef",
  "albumPageInFlightRef",
  "artistPageInFlightRef",
  "albumFavoriteMutationRef",
  "artistFavoriteMutationRef",
  "albumFavoriteQueueRef",
  "artistFavoriteQueueRef",
  "applyAlbumFavoriteOverrides",
  "applyArtistFavoriteOverrides",
  "setExpectedSessionUserId",
  "SESSION_CHANGED_EVENT",
  "shellAlbumPageData",
]) {
  assert.match(app, new RegExp(marker), `App.tsx is missing ${marker}`);
}

assert.match(api, /if \(favorites\) params\.set\('favorites', 'true'\)/);
assert.match(server, /queryBool\(c, "favorites"\)/);
assert.match(catalog, /FavoriteAlbumsPage/);
assert.match(catalog, /FavoriteArtistsPage/);
assert.match(catalog, /SetAlbumFavorite/);
assert.match(catalog, /SetArtistFavorite/);
assert.match(catalog, /album\.HasUserFavoritesWith/);
assert.match(catalog, /artist\.HasUserFavoritesWith/);
assert.match(cards, /aria-pressed=\{Boolean\(item\.favorite\)\}/);
assert.match(cards, /aria-busy=\{loading\}/);
assert.match(app, /placeholder=\{t\("searchArtist"\)\}[\s\S]*role="combobox"[\s\S]*aria-autocomplete="list"/);
assert.match(app, /className="artist-initial-filter"[\s\S]*role="group"/);
assert.match(app, /className="artist-initial-filter"[\s\S]*aria-busy=\{loading\}/);
assert.match(app, /disabled=\{!enabled && active !== initial\}/);
assert.match(app, /className="player-favorite"[\s\S]*aria-label=\{t\([\s\S]*?"removeFavorite"[\s\S]*?"addFavorite"\)\}[\s\S]*aria-pressed=/);
assert.match(app, /className=\{collection\.favorite \? "active" : ""\}[\s\S]*aria-pressed=\{Boolean\(collection\.favorite\)\}/);
assert.match(app, /aria-label=\{t\("position"\)\}/);
assert.match(app, /aria-label=\{t\("volume"\)\}/);
assert.match(app, /albumFavoriteStateRef\.current\.set\(updated\.id, \{ favorite: updated\.favorite, mutationEpoch \}\)/);
assert.match(app, /artistFavoriteStateRef\.current\.set\(updated\.id, \{ favorite: updated\.favorite, mutationEpoch \}\)/);
assert.match(app, /previousFavorite != null && previousFavorite !== updated\.favorite/);
assert.match(app, /albumFavoriteQueueRef\.current\.has\(id\)[\s\S]*albumFavoriteRepeatRef\.current/);
assert.match(app, /artistFavoriteQueueRef\.current\.has\(id\)[\s\S]*artistFavoriteRepeatRef\.current/);
assert.match(app, /api\.favoriteAlbum\(id, targetFavorite, expectedUserID, signal\)/);
assert.match(app, /api\.favoriteArtist\(id, targetFavorite, expectedUserID, signal\)/);
assert.match(app, /favoriteAlbumItems !== null && favoriteAlbumMutationEpoch === albumFavoriteMutationRef\.current/);
assert.match(app, /favoriteArtistItems !== null && favoriteArtistMutationEpoch === artistFavoriteMutationRef\.current/);
assert.match(app, /applyAlbumFavoriteOverrides\([\s\S]*?\[refreshedAlbum \?\? album\][\s\S]*?albumRequestMutationEpoch/);
assert.match(app, /api\.artist\(id, controller\.signal\)/);
assert.match(app, /favorite: resolvedArtist\.favorite/);
assert.match(app, /nextPage > lastPage \|\| pageItem\.page > lastPage/);
assert.match(app, /const albumBrowseItems = \(albumPageData\?\.items \?\? albums\)/);
assert.match(app, /albums=\{\(shellAlbumPageData\?\.items \?\? \[\]\)\.map/);
assert.doesNotMatch(app, /currentTotal \+ \(updated\.favorite \? 1 : -1\)/);

assert.match(app, /type AlbumBrowseQuery = \{[\s\S]*?limit: number;/);
assert.match(app, /type ArtistBrowseQuery = \{[\s\S]*?limit: number;/);
assert.match(app, /function applyAlbumFavoriteOverrides\([\s\S]*?responseMutationEpoch/);
assert.match(app, /function applyArtistFavoriteOverrides\([\s\S]*?responseMutationEpoch/);
assert.match(app, /acceptedAlbumPageItem &&[\s\S]*?albumPageMutationEpoch === albumFavoriteMutationRef\.current/);
assert.match(app, /api\.playlistsPage\(playlistPage, gridPageSize\)\.catch\(\(\) => null\)/);
assert.match(app, /if \(playlistPageItem\)[\s\S]*?setPlaylistPageData\(playlistPageItem\)/);

const logout = functionBlock("async function logout()", "async function updateProfile(");
assert.ok(
  logout.indexOf("setAuthLoading(true)") < logout.indexOf("loadWithTimeout((signal) => api.logout(signal)"),
  "logout must hide authenticated controls before the logout request",
);

for (const [startMarker, endMarker, apiCall] of [
  ["async function toggleAlbumFavoriteById(", "async function toggleAlbumFavorite(", "api.favoriteAlbum(id, targetFavorite, expectedUserID, signal)"],
  ["async function toggleArtistFavoriteById(", "async function toggleArtistFavorite(", "api.favoriteArtist(id, targetFavorite, expectedUserID, signal)"],
]) {
  const block = functionBlock(startMarker, endMarker);
  assert.ok(
    block.indexOf("session !== favoriteSessionRef.current") < block.indexOf(apiCall),
    `${startMarker} must reject a stale session before sending the mutation`,
  );
  assert.ok(
    block.indexOf("QueueRef.current.delete(id)") < block.indexOf("reconcileFavorite"),
    `${startMarker} must release its queue before reconciliation`,
  );
}

assert.match(app, /aria-activedescendant=\{[\s\S]*?!loading && suggestions\[activeIndex\]/);
assert.match(app, /albumPageData && albumPageData\.limit !== gridPageSize/);
assert.match(app, /artistPageData && artistPageData\.limit !== gridPageSize/);
assert.match(app, /albumPageInFlightRef\.current != null[\s\S]*?albumBrowseIntentRef\.current\.page/);
assert.match(app, /artistPageInFlightRef\.current != null[\s\S]*?artistBrowseIntentRef\.current\.page/);
const openAlbum = functionBlock("async function openAlbum(", "async function openSongAlbum(");
assert.doesNotMatch(openAlbum, /\[resolvedAlbum, \.\.\.old\]/, "album details must not enter the current browse page");
const openSongAlbum = functionBlock("async function openSongAlbum(", "async function openArtistById(");
assert.doesNotMatch(openSongAlbum, /setAlbums\(/, "song album details must not enter the current browse page");
const openArtist = functionBlock("async function openArtistById(", "async function retryCurrentCollection(");
assert.doesNotMatch(openArtist, /mergeAlbums\(/, "artist details must not append to the current album browse page");
assert.match(openArtist, /favoriteArtists\.find\(/, "artist details must reuse the loaded favorite entity state");
assert.match(openArtist, /api\.artist\(id, controller\.signal\)/, "artist details must load authoritative favorite state");
const refreshAll = functionBlock("async function refreshAll(", "async function refreshLibraryDataOnly(");
assert.match(refreshAll, /songItems\.find\(\(item\) => item\.id === song\.id\) \?\? song/);
assert.match(refreshAll, /acceptedAlbumPageItem\.items\.find\(\(item\) => item\.id === album\.id\) \?\? album/);
assert.match(server, /func safePageOffset\(/);
assert.match(server, /func validateExpectedUserID\(/);
assert.match(server, /sessionMismatchHeader/);
assert.match(server, /e\.POST\("\/api\/auth\/logout", s\.handleLogout, auth\)/);
assert.match(api, /X-Lark-Expected-User-ID/);
assert.match(api, /JSON\.stringify\(\{ favorite \}\)/);
assert.match(api, /X-Lark-Session-Mismatch/);

for (const key of [
  "favoritesOnly",
  "favoriteFilterFailed",
  "favoriteUpdateFailed",
  "emptyFavoriteAlbums",
  "emptyFavoriteAlbumsHint",
  "emptyFavoriteArtists",
  "emptyFavoriteArtistsHint",
  "addFavorite",
  "removeFavorite",
]) {
  assert.equal((i18n.match(new RegExp(`${key}:`, "g")) || []).length, 2, `${key} needs Chinese and English copy`);
}

assert.match(styles, /favorite-filter-toggle\[data-active='true'\][^{]*\{[^}]*#d72f48/s);
assert.match(styles, /@media \(hover:hover\) and \(pointer:fine\)[\s\S]*favorite-filter-toggle/);
assert.match(styles, /@media \(prefers-reduced-motion:reduce\)[\s\S]*favorite-filter-toggle/);
assert.match(styles, /\.card-meta small \{ color:var\(--muted-strong\)/);
assert.match(mobile, /section-head \.favorite-filter-toggle[^}]*min-height:48px/s);
assert.match(mobile, /card-favorite[^}]*width:44px[^}]*height:44px/s);
assert.match(mobile, /collection-browse-actions[^}]*grid-template-columns:minmax\(0,1fr\)/s);
assert.match(cards, /aria-label=\{t\(item\.favorite \? "removeFavorite" : "addFavorite"\)\}/);

console.log("favorite collection filter contracts verified");
