import type { Album, Artist, AuthStatus, Folder, FolderDirectory, HealthInfo, LyricCandidate, Lyrics, Playlist, ScanResult, ScanStatus, Settings, Song, User, MCPTokenStatus, WebFont, LibrarySource, LibraryDirectory, LibraryStats, NetworkSource, NetworkTrack, RadioSource, RadioStation } from '../types'

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
  users: () => request<User[]>('/api/users'),
  saveProgress: (id: number, progress_seconds: number, duration_seconds: number, completed = false) => request<void>(`/api/songs/${id}/progress`, { method: 'PUT', body: JSON.stringify({ progress_seconds, duration_seconds, completed }) }),
  songs: (q = '', limit = 0) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (limit > 0) params.set('limit', String(limit))
    const qs = params.toString()
    return request<Song[]>(`/api/songs${qs ? `?${qs}` : ''}`)
  },
  dailyMix: (limit = 24) => request<Song[]>(`/api/daily-mix?limit=${limit}`),
  song: (id: number) => request<Song>(`/api/songs/${id}`),
  favoriteSong: (id: number) => request<Song>(`/api/songs/${id}/favorite`, { method: 'POST' }),
  markPlayed: (id: number) => request<void>(`/api/songs/${id}/played`, { method: 'POST' }),
  lyrics: (id: number, sourceId?: string) => request<Lyrics>(`/api/songs/${id}/lyrics${sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : ''}`),
  lyricCandidates: (id: number) => request<LyricCandidate[]>(`/api/songs/${id}/lyrics/candidates`),
  selectLyrics: (id: number, source: string, candidateId: string) => request<Lyrics>(`/api/songs/${id}/lyrics/select`, { method: 'POST', body: JSON.stringify({ source, id: candidateId }) }),
  scan: () => request<ScanResult>('/api/library/scan', { method: 'POST' }),
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
  folderSongs: (path: string) => request<Song[]>(`/api/folders/songs?path=${encodeURIComponent(path)}`),
  albums: (limit = 0) => request<Album[]>(`/api/albums${limit > 0 ? `?limit=${limit}` : ''}`),
  albumSongs: (id: number) => request<Song[]>(`/api/albums/${id}/songs`),
  artists: (limit = 0) => request<Artist[]>(`/api/artists${limit > 0 ? `?limit=${limit}` : ''}`),
  artistSongs: (id: number) => request<Song[]>(`/api/artists/${id}/songs`),
  favoriteArtist: (id: number) => request<Artist>(`/api/artists/${id}/favorite`, { method: 'POST' }),
  favoriteAlbum: (id: number) => request<Album>(`/api/albums/${id}/favorite`, { method: 'POST' }),
  playlists: (limit = 0) => request<Playlist[]>(`/api/playlists${limit > 0 ? `?limit=${limit}` : ''}`),
  createPlaylist: (name: string, description = '', cover_theme = 'deep-space') => request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify({ name, description, cover_theme }) }),
  playlistSongs: (id: number) => request<Song[]>(`/api/playlists/${id}/songs`),
  addToPlaylist: (playlistId: number, songId: number) => request<void>(`/api/playlists/${playlistId}/songs/${songId}`, { method: 'POST' }),
  removeFromPlaylist: (playlistId: number, songId: number) => request<void>(`/api/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE' }),

  librarySources: () => request<LibrarySource[]>('/api/library/sources'),
  libraryDirectories: () => request<LibraryDirectory[]>('/api/library/directories'),
  addLibraryDirectory: (path: string, note: string) => request<LibraryDirectory>('/api/library/directories', { method: 'POST', body: JSON.stringify({ path, note }) }),
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
