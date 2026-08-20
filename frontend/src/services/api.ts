import type { Album, AlbumPage, Artist, ArtistPage, AuthStatus, Folder, FolderDirectory, HealthInfo, LyricCandidate, Lyrics, MetadataCandidate, MetadataWritebackResult, Playlist, PlaylistPage, PublicShare, ScanResult, ScanStatus, Settings, Share, ShareList, Song, SongPage, SongSort, SongReview, User, MCPTokenStatus, OfflineAudioStatus, SubsonicCredentialStatus, UISoundSettings, PlaybackHistorySettings, PlaybackHistoryEntry, UserPreferences, WebFont, LibrarySource, LibraryDirectory, LibraryStats, LibraryReviewSummary, NetworkSource, NetworkTrack, RadioSource, RadioStation, PlaybackQueueStatus, PlaybackSourceStatus, PlaybackSourceType, SmartPlaylist, ScrobblingSettings, DLNADevice, DLNAStatus, Plugin, PluginCapability, PluginRegistry, PluginRegistryEntry } from '../types'

function currentDeviceType() {
  if (typeof navigator === 'undefined') return 'pc'
  return /Mobile|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'mobile' : 'pc'
}

export const SESSION_CHANGED_EVENT = 'lark:session-changed'

let expectedSessionUserId = 0
let notifiedSessionUserId = 0

export function setExpectedSessionUserId(userId: number) {
  const nextUserId = Number.isInteger(userId) && userId > 0 ? userId : 0
  if (expectedSessionUserId !== nextUserId) notifiedSessionUserId = 0
  expectedSessionUserId = nextUserId
}

function notifySessionChanged(requestUserId: number) {
  if (
    typeof window === 'undefined' ||
    requestUserId <= 0 ||
    requestUserId !== expectedSessionUserId ||
    notifiedSessionUserId === requestUserId
  ) return
  notifiedSessionUserId = requestUserId
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT))
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const requestUserId = expectedSessionUserId
  headers.set('X-Lark-Device-Type', currentDeviceType())
  if (requestUserId > 0 && !headers.has('X-Lark-Expected-User-ID')) {
    headers.set('X-Lark-Expected-User-ID', String(requestUserId))
  }
  if (init?.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, { ...init, credentials: 'include', headers })
  if (
    res.headers.get('X-Lark-Session-Mismatch') === 'true' ||
    (res.status === 401 && requestUserId > 0 && !url.startsWith('/api/auth/'))
  ) notifySessionChanged(requestUserId)
  if (!res.ok) throw new Error(await res.text())
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function normalizeMetadataWritebackResult(result: MetadataWritebackResult | null | undefined): MetadataWritebackResult {
  return {
    updated: Number(result?.updated) || 0,
    skipped: Number(result?.skipped) || 0,
    failed: Number(result?.failed) || 0,
    items: arrayOrEmpty(result?.items),
    ...(result?.song ? { song: result.song } : {}),
    ...(result?.album ? { album: result.album } : {}),
    ...(Array.isArray(result?.albums) ? { albums: result.albums } : {}),
    ...(Array.isArray(result?.songs) ? { songs: result.songs } : {}),
  }
}

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  setup: (username: string, password: string) => request<{ user: AuthStatus['user'] }>('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => request<{ user: AuthStatus['user'] }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) => request<{ user: AuthStatus['user'] }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: (signal?: AbortSignal) => request<void>('/api/auth/logout', { method: 'POST', signal }),
  updateProfile: (nickname: string, avatar_data_url: string) => request<AuthStatus['user']>('/api/me', { method: 'PUT', body: JSON.stringify({ nickname, avatar_data_url }) }),
  scrobblingSettings: () => request<ScrobblingSettings>('/api/me/scrobbling'),
  saveScrobblingSettings: (settings: ScrobblingSettings & { token?: string }) => request<ScrobblingSettings>('/api/me/scrobbling', { method: 'PUT', body: JSON.stringify(settings) }),
  uiSoundSettings: () => request<UISoundSettings>('/api/me/ui-sounds'),
  saveUISoundSettings: (settings: UISoundSettings) => request<UISoundSettings>('/api/me/ui-sounds', { method: 'PUT', body: JSON.stringify(settings) }),
  playbackHistorySettings: () => request<PlaybackHistorySettings>('/api/me/playback-history'),
  savePlaybackHistorySettings: (settings: PlaybackHistorySettings) => request<PlaybackHistorySettings>('/api/me/playback-history', { method: 'PUT', body: JSON.stringify(settings) }),
  userPreferences: () => request<UserPreferences>('/api/me/preferences'),
  saveUserPreferences: (preferences: UserPreferences) => request<UserPreferences>('/api/me/preferences', { method: 'PUT', body: JSON.stringify(preferences) }),
  subsonicCredential: () => request<SubsonicCredentialStatus>('/api/me/subsonic'),
  saveSubsonicCredential: (username: string, password: string) => request<SubsonicCredentialStatus>('/api/me/subsonic', { method: 'PUT', body: JSON.stringify({ username, password }) }),
  deleteSubsonicCredential: () => request<SubsonicCredentialStatus>('/api/me/subsonic', { method: 'DELETE' }),
  users: () => request<User[]>('/api/users'),
  saveProgress: (id: number, progress_seconds: number, duration_seconds: number, completed = false) => request<void>(`/api/songs/${id}/progress`, { method: 'PUT', body: JSON.stringify({ progress_seconds, duration_seconds, completed }) }),
  songs: (q = '', limit = 0) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (limit > 0) params.set('limit', String(limit))
    const qs = params.toString()
    return request<Song[]>(`/api/songs${qs ? `?${qs}` : ''}`)
  },
  songsPage: (q = '', page = 1, limit = 100, favorites = false, options: { sort?: SongSort; review?: SongReview } = {}) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (favorites) params.set('favorites', 'true')
    params.set('page', String(page))
    params.set('limit', String(limit))
    if (options.sort && options.sort !== 'added_desc') params.set('sort', options.sort)
    if (options.review) params.set('review', options.review)
    return request<SongPage>(`/api/songs/page?${params.toString()}`)
  },
  libraryReviewSummary: () => request<LibraryReviewSummary>('/api/library/review-summary'),
  recentPlayedSongs: (limit = 12) => request<Song[]>(`/api/songs/recent-played?limit=${limit}`),
  playbackHistory: (limit = 100) => request<PlaybackHistoryEntry[]>(`/api/playback/history?limit=${limit}`),
  recentAddedSongs: (limit = 12) => request<Song[]>(`/api/songs/recent-added?limit=${limit}`),
  dailyMix: (limit = 24) => request<Song[]>(`/api/daily-mix?limit=${limit}`),
  smartPlaylists: () => request<SmartPlaylist[]>('/api/smart-playlists'),
  smartPlaylistSongs: (id: string, limit = 50) => request<Song[]>(`/api/smart-playlists/${encodeURIComponent(id)}/songs?limit=${limit}`),
  song: (id: number) => request<Song>(`/api/songs/${id}`),
  favoriteSong: (id: number) => request<Song>(`/api/songs/${id}/favorite`, { method: 'POST' }),
  markPlayed: (id: number) => request<void>(`/api/songs/${id}/played`, { method: 'POST' }),
  playbackSource: () => request<PlaybackSourceStatus>('/api/playback/source'),
  savePlaybackSource: (type: PlaybackSourceType, source_id: number) => request<PlaybackSourceStatus>('/api/playback/source', { method: 'PUT', body: JSON.stringify({ type, source_id }) }),
  clearPlaybackSource: () => request<void>('/api/playback/source', { method: 'DELETE' }),
  playbackQueue: () => request<PlaybackQueueStatus>('/api/playback/queue'),
  savePlaybackQueue: (song_ids: number[], current_id: number, source?: { type: PlaybackSourceType; source_id: number } | null) =>
    request<PlaybackQueueStatus>('/api/playback/queue', {
      method: 'PUT',
      body: JSON.stringify({
        song_ids,
        current_id,
        ...(source ? { source } : { clear_source: true }),
        clear_radio: true,
      }),
    }),
  savePlaybackRadioQueue: (current: RadioStation, queue: RadioStation[]) =>
    request<PlaybackQueueStatus>('/api/playback/queue', {
      method: 'PUT',
      body: JSON.stringify({
        radio: { current, queue },
        clear_source: true,
      }),
    }),
  clearPlaybackQueue: () => request<void>('/api/playback/queue', { method: 'DELETE' }),
  prepareOfflineSong: (id: number, quality = 192) => request<OfflineAudioStatus>(`/api/offline/songs/${id}/prepare?quality=${quality}`, { method: 'POST' }),
  offlineSongStatus: (id: number, quality = 192) => request<OfflineAudioStatus>(`/api/offline/songs/${id}/status?quality=${quality}`),
  shares: () => request<ShareList>('/api/shares'),
  createShare: (type: Share['type'], id: number, expires_at?: string) => request<Share>('/api/shares', { method: 'POST', body: JSON.stringify({ type, id, expires_at: expires_at || null }) }),
  updateShare: (token: string, expires_at?: string) => request<Share>(`/api/shares/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ expires_at: expires_at || null }) }),
  deleteShare: (token: string) => request<void>(`/api/shares/${encodeURIComponent(token)}`, { method: 'DELETE' }),
  publicShare: (token: string) => request<PublicShare>(`/api/public/shares/${encodeURIComponent(token)}`),
  lyrics: (id: number, sourceId?: string) => request<Lyrics>(`/api/songs/${id}/lyrics${sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : ''}`),
  lyricCandidates: (id: number, refresh = false) => request<LyricCandidate[]>(`/api/songs/${id}/lyrics/candidates${refresh ? '?refresh=true' : ''}`),
  selectLyrics: (id: number, source: string, candidateId: string) => request<Lyrics>(`/api/songs/${id}/lyrics/select`, { method: 'POST', body: JSON.stringify({ source, id: candidateId }) }),
  songMetadataCandidates: (id: number, scope: 'path' | 'online' | 'all' = 'all', refresh = false) => request<MetadataCandidate[] | null>(`/api/songs/${id}/metadata-candidates?scope=${encodeURIComponent(scope)}${refresh ? '&refresh=true' : ''}`).then(arrayOrEmpty),
  updateSongMetadata: (id: number, body: FormData) => request<MetadataWritebackResult | null>(`/api/songs/${id}/metadata`, { method: 'POST', body }).then(normalizeMetadataWritebackResult),
  scan: () => request<ScanResult>('/api/library/scan', { method: 'POST' }),
  cancelScan: () => request<{ canceled: boolean }>('/api/library/scan/cancel', { method: 'POST' }),
  scanStatus: () => request<ScanStatus>('/api/library/scan/status'),
  libraryStats: () => request<LibraryStats>('/api/library/stats'),
  upload: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<Song[]>('/api/library/upload', { method: 'POST', body })
  },
  folders: (limit = 0) => request<Folder[]>(`/api/folders?limit=${limit}`),
  folderDirectory: (path = '.') => request<FolderDirectory>(`/api/folders/tree?path=${encodeURIComponent(path)}`),
  folderSongs: (path: string, limit = 0) => {
    const params = new URLSearchParams({ path })
    if (limit > 0) params.set('limit', String(limit))
    return request<Song[]>(`/api/folders/songs?${params.toString()}`)
  },
  albums: (limit = 0) => request<Album[]>(`/api/albums${limit > 0 ? `?limit=${limit}` : ''}`),
  favoriteAlbums: (limit = 500) => request<Album[]>(`/api/albums/favorites?limit=${limit}`),
  albumsPage: (page = 1, limit = 100, artistId = 0, signal?: AbortSignal, favorites = false) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (artistId > 0) params.set('artist_id', String(artistId))
    if (favorites) params.set('favorites', 'true')
    return request<AlbumPage>(`/api/albums/page?${params.toString()}`, { signal })
  },
  album: (id: number, signal?: AbortSignal) => request<Album>(`/api/albums/${id}`, { signal }),
  albumSongs: (id: number, limit = 0, signal?: AbortSignal) => request<Song[]>(`/api/albums/${id}/songs${limit > 0 ? `?limit=${limit}` : ''}`, { signal }),
  albumMetadataCandidates: (id: number, scope: 'path' | 'online' | 'all' = 'all', refresh = false) => request<MetadataCandidate[] | null>(`/api/albums/${id}/metadata-candidates?scope=${encodeURIComponent(scope)}${refresh ? '&refresh=true' : ''}`).then(arrayOrEmpty),
  updateAlbumMetadata: (id: number, body: FormData) => request<MetadataWritebackResult | null>(`/api/albums/${id}/metadata`, { method: 'POST', body }).then(normalizeMetadataWritebackResult),
  artists: (limit = 0) => request<Artist[]>(`/api/artists${limit > 0 ? `?limit=${limit}` : ''}`),
  favoriteArtists: (limit = 500) => request<Artist[]>(`/api/artists/favorites?limit=${limit}`),
  artistsPage: (page = 1, limit = 100, initial = '', favorites = false) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (initial) params.set('initial', initial)
    if (favorites) params.set('favorites', 'true')
    return request<ArtistPage>(`/api/artists/page?${params.toString()}`)
  },
  searchArtists: (q = '', limit = 20) => request<Artist[]>(`/api/artists/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  artist: (id: number, signal?: AbortSignal) => request<Artist>(`/api/artists/${id}`, { signal }),
  artistSongs: (id: number, limit = 0, signal?: AbortSignal) => request<Song[]>(`/api/artists/${id}/songs${limit > 0 ? `?limit=${limit}` : ''}`, { signal }),
  favoriteArtist: (id: number, favorite: boolean, expectedUserId: number, signal?: AbortSignal) => request<Artist>(`/api/artists/${id}/favorite`, {
    method: 'POST',
    headers: { 'X-Lark-Expected-User-ID': String(expectedUserId) },
    body: JSON.stringify({ favorite }),
    signal,
  }),
  favoriteAlbum: (id: number, favorite: boolean, expectedUserId: number, signal?: AbortSignal) => request<Album>(`/api/albums/${id}/favorite`, {
    method: 'POST',
    headers: { 'X-Lark-Expected-User-ID': String(expectedUserId) },
    body: JSON.stringify({ favorite }),
    signal,
  }),
  playlists: (limit = 0) => request<Playlist[]>(`/api/playlists${limit > 0 ? `?limit=${limit}` : ''}`),
  playlistsPage: (page = 1, limit = 100) => request<PlaylistPage>(`/api/playlists/page?page=${page}&limit=${limit}`),
  createPlaylist: (name: string, description = '', cover_theme = 'deep-space') => request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify({ name, description, cover_theme }) }),
  playlistSongs: (id: number, limit = 0, signal?: AbortSignal) => request<Song[]>(`/api/playlists/${id}/songs${limit > 0 ? `?limit=${limit}` : ''}`, { signal }),
  addToPlaylist: (playlistId: number, songId: number) => request<void>(`/api/playlists/${playlistId}/songs/${songId}`, { method: 'POST' }),
  removeFromPlaylist: (playlistId: number, songId: number) => request<void>(`/api/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE' }),

  librarySources: () => request<LibrarySource[]>('/api/library/sources'),
  libraryDirectories: () => request<LibraryDirectory[]>('/api/library/directories'),
  checkLibraryDirectories: () => request<LibraryDirectory[]>('/api/library/directories/check', { method: 'POST' }),
  addLibraryDirectory: (path: string, note: string) => request<LibraryDirectory>('/api/library/directories', { method: 'POST', body: JSON.stringify({ path, note }) }),
  updateLibraryDirectory: (id: string, patch: Partial<Pick<LibraryDirectory, 'watch_enabled'>>) => request<LibraryDirectory>(`/api/library/directories/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteLibraryDirectory: (id: string) => request<void>(`/api/library/directories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  networkSources: () => request<NetworkSource[]>('/api/network/sources'),
  saveNetworkSource: (source: Partial<NetworkSource>) => request<NetworkSource>('/api/network/sources', { method: 'POST', body: JSON.stringify(source) }),
  deleteNetworkSource: (id: string) => request<void>(`/api/network/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testNetworkSource: (id: string) => request<NetworkSource>(`/api/network/sources/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  searchNetworkTracks: (sourceId: string, q: string, limit = 30) => request<NetworkTrack[]>(`/api/network/sources/${encodeURIComponent(sourceId)}/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  radioSources: () => request<RadioSource[]>('/api/radio/sources'),
  addRadioSource: (name: string, url: string) => request<RadioSource>('/api/radio/sources', { method: 'POST', body: JSON.stringify({ name, url }) }),
  deleteRadioSource: (id: string) => request<void>(`/api/radio/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  radioFavorites: () => request<RadioStation[]>('/api/radio/favorites'),
  favoriteRadioStation: (station: RadioStation) => request<RadioStation>('/api/radio/favorite', { method: 'POST', body: JSON.stringify(station) }),
  topRadioStations: (limit = 30, offset = 0) => request<RadioStation[]>(`/api/radio/top?limit=${limit}&offset=${offset}`),
  searchRadioStations: (q: string, limit = 30) => request<RadioStation[]>(`/api/radio/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  settings: () => request<Settings>('/api/settings'),
  fonts: () => request<WebFont[]>('/api/fonts'),
  uploadFont: (file: File) => {
    const body = new FormData()
    body.append('font', file)
    return request<Settings>('/api/fonts', { method: 'POST', body })
  },
  deleteFont: (name: string) => request<Settings>(`/api/fonts/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  dlnaStatus: () => request<DLNAStatus>('/api/dlna/status'),
  dlnaDevices: () => request<DLNADevice[]>('/api/dlna/devices'),
  discoverDLNADevices: () => request<DLNADevice[]>('/api/dlna/discover', { method: 'POST' }),
  playDLNA: (device_id: string, song_id: number) => request<DLNAStatus>('/api/dlna/play', { method: 'POST', body: JSON.stringify({ device_id, song_id }) }),
  pauseDLNA: (device_id: string) => request<DLNAStatus>('/api/dlna/pause', { method: 'POST', body: JSON.stringify({ device_id }) }),
  resumeDLNA: (device_id: string) => request<DLNAStatus>('/api/dlna/resume', { method: 'POST', body: JSON.stringify({ device_id }) }),
  stopDLNA: (device_id: string) => request<DLNAStatus>('/api/dlna/stop', { method: 'POST', body: JSON.stringify({ device_id }) }),
  switchDLNALocal: () => request<DLNAStatus>('/api/dlna/local', { method: 'POST' }),
  mcpToken: () => request<MCPTokenStatus>('/api/mcp/token'),
  setMcpToken: (token: string) => request<MCPTokenStatus>('/api/mcp/token', { method: 'PUT', body: JSON.stringify({ token }) }),
  generateMcpToken: () => request<MCPTokenStatus>('/api/mcp/token/generate', { method: 'POST' }),
  deleteMcpToken: () => request<MCPTokenStatus>('/api/mcp/token', { method: 'DELETE' }),
  saveSettings: (settings: Settings) => request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  plugins: () => request<{ plugins: Plugin[] }>('/api/plugins'),
  pluginCapabilities: () => request<{ capabilities: PluginCapability[] }>('/api/plugins/capabilities'),
  uploadPlugin: (file: File) => request<Plugin>('/api/plugins/upload', { method: 'POST', body: file }),
  enablePlugin: (id: number) => request<void>(`/api/plugins/${id}/enable`, { method: 'POST' }),
  disablePlugin: (id: number) => request<void>(`/api/plugins/${id}/disable`, { method: 'POST' }),
  reloadPlugin: (id: number) => request<void>(`/api/plugins/${id}/reload`, { method: 'POST' }),
  deletePlugin: (id: number) => request<void>(`/api/plugins/${id}`, { method: 'DELETE' }),
  pluginRegistries: () => request<{ registries: PluginRegistry[] }>('/api/plugin-registries'),
  savePluginRegistries: (registries: PluginRegistry[]) => request<{ registries: PluginRegistry[] }>('/api/plugin-registries', { method: 'PUT', body: JSON.stringify({ registries }) }),
  pluginMarketplace: () => request<{ plugins: PluginRegistryEntry[]; warnings?: string[] }>('/api/plugin-marketplace'),
  installMarketplacePlugin: (plugin: PluginRegistryEntry) => request<Plugin>('/api/plugin-marketplace/install', { method: 'POST', body: JSON.stringify(plugin) }),
}
