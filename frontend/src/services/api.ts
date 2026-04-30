import type { Album, AlbumPage, Artist, ArtistPage, AuthStatus, Folder, FolderDirectory, HealthInfo, LyricCandidate, Lyrics, Playlist, PlaylistPage, PublicShare, ScanResult, ScanStatus, Settings, Share, ShareList, Song, SongPage, User, MCPTokenStatus, SubsonicCredentialStatus, UISoundSettings, WebFont, LibrarySource, LibraryDirectory, LibraryStats, NetworkSource, NetworkTrack, RadioSource, RadioStation, PlaybackSourceStatus, PlaybackSourceType, SmartPlaylist, ScrobblingSettings } from '../types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, { ...init, credentials: 'include', headers })
  if (!res.ok) throw new Error(await res.text())
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  setup: (username: string, password: string) => request<{ user: AuthStatus['user'] }>('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => request<{ user: AuthStatus['user'] }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) => request<{ user: AuthStatus['user'] }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (nickname: string, avatar_data_url: string) => request<AuthStatus['user']>('/api/me', { method: 'PUT', body: JSON.stringify({ nickname, avatar_data_url }) }),
  scrobblingSettings: () => request<ScrobblingSettings>('/api/me/scrobbling'),
  saveScrobblingSettings: (settings: ScrobblingSettings & { token?: string }) => request<ScrobblingSettings>('/api/me/scrobbling', { method: 'PUT', body: JSON.stringify(settings) }),
  uiSoundSettings: () => request<UISoundSettings>('/api/me/ui-sounds'),
  saveUISoundSettings: (settings: UISoundSettings) => request<UISoundSettings>('/api/me/ui-sounds', { method: 'PUT', body: JSON.stringify(settings) }),
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
  songsPage: (q = '', page = 1, limit = 100, favorites = false) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (favorites) params.set('favorites', 'true')
    params.set('page', String(page))
    params.set('limit', String(limit))
    return request<SongPage>(`/api/songs/page?${params.toString()}`)
  },
  recentPlayedSongs: (limit = 12) => request<Song[]>(`/api/songs/recent-played?limit=${limit}`),
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
  shares: () => request<ShareList>('/api/shares'),
  createShare: (type: Share['type'], id: number, expires_at?: string) => request<Share>('/api/shares', { method: 'POST', body: JSON.stringify({ type, id, expires_at: expires_at || null }) }),
  updateShare: (token: string, expires_at?: string) => request<Share>(`/api/shares/${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify({ expires_at: expires_at || null }) }),
  deleteShare: (token: string) => request<void>(`/api/shares/${encodeURIComponent(token)}`, { method: 'DELETE' }),
  publicShare: (token: string) => request<PublicShare>(`/api/public/shares/${encodeURIComponent(token)}`),
  lyrics: (id: number, sourceId?: string) => request<Lyrics>(`/api/songs/${id}/lyrics${sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : ''}`),
  lyricCandidates: (id: number) => request<LyricCandidate[]>(`/api/songs/${id}/lyrics/candidates`),
  selectLyrics: (id: number, source: string, candidateId: string) => request<Lyrics>(`/api/songs/${id}/lyrics/select`, { method: 'POST', body: JSON.stringify({ source, id: candidateId }) }),
  scan: () => request<ScanResult>('/api/library/scan', { method: 'POST' }),
  cancelScan: () => request<{ canceled: boolean }>('/api/library/scan/cancel', { method: 'POST' }),
  scanStatus: () => request<ScanStatus>('/api/library/scan/status'),
  libraryStats: () => request<LibraryStats>('/api/library/stats'),
  upload: async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/library/upload', { method: 'POST', body, credentials: 'include' })
    if (!res.ok) throw new Error(await res.text())
    return res.json() as Promise<Song[]>
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
  albumsPage: (page = 1, limit = 100, artistId = 0) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (artistId > 0) params.set('artist_id', String(artistId))
    return request<AlbumPage>(`/api/albums/page?${params.toString()}`)
  },
  album: (id: number) => request<Album>(`/api/albums/${id}`),
  albumSongs: (id: number, limit = 0) => request<Song[]>(`/api/albums/${id}/songs${limit > 0 ? `?limit=${limit}` : ''}`),
  artists: (limit = 0) => request<Artist[]>(`/api/artists${limit > 0 ? `?limit=${limit}` : ''}`),
  favoriteArtists: (limit = 500) => request<Artist[]>(`/api/artists/favorites?limit=${limit}`),
  artistsPage: (page = 1, limit = 100) => request<ArtistPage>(`/api/artists/page?page=${page}&limit=${limit}`),
  searchArtists: (q = '', limit = 20) => request<Artist[]>(`/api/artists/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  artistSongs: (id: number, limit = 0) => request<Song[]>(`/api/artists/${id}/songs${limit > 0 ? `?limit=${limit}` : ''}`),
  favoriteArtist: (id: number) => request<Artist>(`/api/artists/${id}/favorite`, { method: 'POST' }),
  favoriteAlbum: (id: number) => request<Album>(`/api/albums/${id}/favorite`, { method: 'POST' }),
  playlists: (limit = 0) => request<Playlist[]>(`/api/playlists${limit > 0 ? `?limit=${limit}` : ''}`),
  playlistsPage: (page = 1, limit = 100) => request<PlaylistPage>(`/api/playlists/page?page=${page}&limit=${limit}`),
  createPlaylist: (name: string, description = '', cover_theme = 'deep-space') => request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify({ name, description, cover_theme }) }),
  playlistSongs: (id: number, limit = 0) => request<Song[]>(`/api/playlists/${id}/songs${limit > 0 ? `?limit=${limit}` : ''}`),
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
  uploadFont: async (file: File) => {
    const body = new FormData()
    body.append('font', file)
    const res = await fetch('/api/fonts', { method: 'POST', body, credentials: 'include' })
    if (!res.ok) throw new Error(await res.text())
    return res.json() as Promise<Settings>
  },
  deleteFont: (name: string) => request<Settings>(`/api/fonts/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  mcpToken: () => request<MCPTokenStatus>('/api/mcp/token'),
  setMcpToken: (token: string) => request<MCPTokenStatus>('/api/mcp/token', { method: 'PUT', body: JSON.stringify({ token }) }),
  generateMcpToken: () => request<MCPTokenStatus>('/api/mcp/token/generate', { method: 'POST' }),
  deleteMcpToken: () => request<MCPTokenStatus>('/api/mcp/token', { method: 'DELETE' }),
  saveSettings: (settings: Settings) => request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
}
