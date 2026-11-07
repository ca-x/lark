// A plugin that does everything a plugin can, with made-up music and no
// network. Every export is optional: leave one out and the app hides what it's
// for. Functions take one object of parameters, and may be async.

const artist = { id: "a1", name: "The Examples" };
const album = { id: "al1", name: "First Album", artists: [artist], released: "2026-01-01" };

const tracks = [1, 2, 3].map((n) => ({
  id: `t${n}`,
  name: `Song ${n}`,
  artists: [artist],
  album,
  duration: 12000,
}));

const episodes = [1, 2].map((n) => ({
  id: `e${n}`,
  name: `Episode ${n}`,
  artists: [{ id: "host", name: "The Host" }],
  album: { id: "s1", name: "The Show" },
  duration: 12000,
  showId: "s1",
  description: `What episode ${n} is about.`,
  published: "2026-02-01",
}));

const show = {
  id: "s1",
  name: "The Show",
  publisher: "The Host",
  description: "A podcast.",
  episodeCount: episodes.length,
};

const station = { id: "st1", name: "Endless", description: "Goes on for as long as you listen." };

// What the listener changes is kept in the plugin's own storage.
const load = (key, fallback) => host.storage.get(key) ?? fallback;
const save = (key, value) => host.storage.set(key, value);

function playlistsNow() {
  return load("playlists", [
    { id: "p1", name: "Favourites", mine: true, trackCount: tracks.length, trackIds: tracks.map((t) => t.id) },
  ]);
}
const byId = (id) => [...tracks, ...episodes].find((t) => t.id === id);
const withTracks = (p) => ({ ...p, tracks: p.trackIds.map(byId), trackCount: p.trackIds.length });
function changePlaylist(id, change) {
  const all = playlistsNow();
  const p = all.find((p) => p.id === id);
  if (!p) throw new Error("no such playlist");
  change(p);
  save("playlists", all);
}

function toggled(key, id, on) {
  const set = new Set(load(key, []));
  if (on) set.add(id);
  else set.delete(id);
  save(key, [...set]);
}

// An error with one of these codes tells the app what to do about it: signIn,
// setup, unavailable or unsupported. Any other shows its message.
function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Signing in. A real plugin would call host.openURL with the service's page,
// then await host.waitForRedirect({ port, path }), which takes the network
// permission, for what it answers.
export function signIn() {
  const me = { id: "me", name: "Demo Listener" };
  save("account", me);
  return me;
}
export function signOut() {
  host.storage.remove("account");
}
export function account() {
  return load("account", null);
}
export function setSetting({ key, value }) {
  console.log(`setting ${key} changed to ${value}`);
}

// Home and pages of the plugin's own. What they say is in the listener's
// language, from locales/zh-CN.json, through host.t.
const t = host.t;

export function home() {
  return {
    title: host.setting("greeting") || t("Welcome"),
    sections: [
      { title: t("Picked for you"), tracks, morePage: "discover" },
      { title: t("Albums"), albums: [album] },
      { title: t("Listen"), shows: [show], stations: [station] },
      { title: t("Explore"), links: [{ title: t("Discover"), subtitle: t("A page of the plugin's own"), page: "discover" }] },
    ],
  };
}
export function browse({ page }) {
  if (page !== "discover") throw fail("unavailable", "no such page");
  return {
    title: t("Discover"),
    subtitle: t("Anything a plugin wants to show"),
    sections: [{ title: t("Artists"), artists: [artist] }, { title: t("Everything"), tracks }],
  };
}

// Search.
export function search({ query, kind, offset }) {
  const q = query.toLowerCase();
  const found = {
    tracks: tracks.filter((t) => t.name.toLowerCase().includes(q)),
    albums: [album].filter((a) => a.name.toLowerCase().includes(q)),
    artists: [artist].filter((a) => a.name.toLowerCase().includes(q)),
    playlists: playlistsNow().filter((p) => p.name.toLowerCase().includes(q)),
    shows: [show].filter((s) => s.name.toLowerCase().includes(q)),
  };
  return { [kind]: offset > 0 ? [] : found[kind], more: false };
}
export function suggest({ query }) {
  return tracks.map((t) => t.name).filter((n) => n.toLowerCase().startsWith(query.toLowerCase()));
}

// The library.
export function recent() {
  return tracks.slice(0, 2);
}
export function played({ id }) {
  console.log(`played ${id}`);
}
export function liked() {
  const ids = load("liked", []);
  return { tracks: ids.map(byId), more: false };
}
export function isLiked({ ids }) {
  const set = new Set(load("liked", []));
  return Object.fromEntries(ids.map((id) => [id, set.has(id)]));
}
export function like({ id, on }) {
  toggled("liked", id, on);
}
export { like as likeEpisode };

// Albums and artists.
export { getAlbum as album, getArtist as artist };
function getAlbum() {
  return { album: { ...album, saved: load("albums", []).includes(album.id) }, tracks };
}
function getArtist() {
  return { artist: { ...artist, following: load("following", []).includes(artist.id) }, tracks, albums: [album] };
}
export function saveAlbum({ id, on }) {
  toggled("albums", id, on);
}
export function savedAlbums() {
  return { albums: load("albums", []).length ? [album] : [], more: false };
}
export function followArtist({ id, on }) {
  toggled("following", id, on);
}

// Playlists.
export function playlists() {
  return playlistsNow().map((p) => ({ ...p, trackIds: undefined, trackCount: p.trackIds.length }));
}
export function playlist({ id }) {
  const p = playlistsNow().find((p) => p.id === id);
  if (!p) throw fail("unavailable", "no such playlist");
  return withTracks(p);
}
export function createPlaylist({ name }) {
  const all = playlistsNow();
  const made = { id: `p${Date.now()}`, name, mine: true, trackIds: [] };
  save("playlists", [...all, made]);
  return withTracks(made);
}
export function renamePlaylist({ id, name }) {
  changePlaylist(id, (p) => (p.name = name));
}
export function deletePlaylist({ id }) {
  save("playlists", playlistsNow().filter((p) => p.id !== id));
}
export function addToPlaylist({ id, trackIds }) {
  changePlaylist(id, (p) => p.trackIds.push(...trackIds));
}
export function removeFromPlaylist({ id, trackIds }) {
  changePlaylist(id, (p) => (p.trackIds = p.trackIds.filter((t) => !trackIds.includes(t))));
}
export function movePlaylistTrack({ id, from, to }) {
  changePlaylist(id, (p) => p.trackIds.splice(to, 0, p.trackIds.splice(from, 1)[0]));
}
export function savePlaylist({ id, on }) {
  toggled("savedPlaylists", id, on);
}

// Podcasts: an episode is a track that says which show it's of.
export function shows() {
  return load("shows", []).length ? [{ ...show, subscribed: true }] : [];
}
export { getShow as show };
function getShow({ offset }) {
  return {
    show: { ...show, subscribed: load("shows", []).includes(show.id) },
    episodes: offset > 0 ? [] : episodes,
    more: false,
  };
}
export function subscribeShow({ id, on }) {
  toggled("shows", id, on);
}

// Stations play for as long as stationNext has more.
export function stations() {
  return [station];
}
export function stationNext() {
  return tracks;
}

// Comments.
export function comments({ offset }) {
  return {
    comments: offset > 0 ? [] : [{ id: "c1", author: "A Listener", text: "Nice one.", time: 1767225600000, likes: 2 }],
    total: 1,
    more: false,
  };
}
export function likeComment() {}
export function postComment({ text }) {
  return { id: `c${Date.now()}`, author: "Demo Listener", text, time: Date.now() };
}

// Lyrics: lrc is the simple way, and lines can time every word.
export function lyrics({ id }) {
  if (id === "t1") {
    return { lrc: "[00:01.00]A plain line\n[00:04.00]And another", translation: "[00:01.00]Translated" };
  }
  return {
    lines: [
      {
        start: 1000,
        end: 3000,
        translation: "A line sung word by word",
        words: [
          { start: 1000, end: 1600, text: "Word " },
          { start: 1600, end: 2200, text: "by " },
          { start: 2200, end: 3000, text: "word" },
        ],
      },
    ],
  };
}

// Audio: where it is, and what it is. headers go with the request for it.
export function stream({ id, quality }) {
  if (!byId(id)) throw fail("unavailable");
  return { url: `file://${host.dir}/tone.mp3`, type: "mp3", quality };
}

// With "playback": "remote" in plugin.json, these play instead: the plugin makes
// the sound itself, or has something else do so, and the app only tells it what
// to do and asks how it's going.
let state = null;
export function remotePlay({ ids, start, position }) {
  state = { playing: true, trackId: ids[start], position, duration: 12000, volume: 100, device: "demo" };
}
export function remotePause() {
  if (state) state.playing = false;
}
export function remoteResume() {
  if (state) state.playing = true;
}
export function remoteSeek({ position }) {
  if (state) state.position = position;
}
export function remoteVolume({ percent }) {
  if (state) state.volume = percent;
}
export function remoteState() {
  return state;
}
export function remoteDevices() {
  return [{ id: "demo", name: "Demo Device", active: true }];
}
export function remoteUse() {}
