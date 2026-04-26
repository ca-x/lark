import type { Album, Artist, AuthStatus, Lyrics, Playlist, ScanResult, ScanStatus, Settings, Song } from '../types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, ...init })
  if (!res.ok) throw new Error(await res.text())
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  setup: (username: string, password: string) => request<{ user: AuthStatus['user'] }>('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => request<{ user: AuthStatus['user'] }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) => request<{ user: AuthStatus['user'] }>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  songs: (q = '') => request<Song[]>(`/api/songs${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  song: (id: number) => request<Song>(`/api/songs/${id}`),
  favoriteSong: (id: number) => request<Song>(`/api/songs/${id}/favorite`, { method: 'POST' }),
  markPlayed: (id: number) => request<void>(`/api/songs/${id}/played`, { method: 'POST' }),
  lyrics: (id: number, sourceId?: string) => request<Lyrics>(`/api/songs/${id}/lyrics${sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : ''}`),
  scan: () => request<ScanResult>('/api/library/scan', { method: 'POST' }),
  scanStatus: () => request<ScanStatus>('/api/library/scan/status'),
  upload: async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/library/upload', { method: 'POST', body, credentials: 'include' })
    if (!res.ok) throw new Error(await res.text())
    return res.json() as Promise<Song[]>
  },
  albums: () => request<Album[]>('/api/albums'),
  albumSongs: (id: number) => request<Song[]>(`/api/albums/${id}/songs`),
  artists: () => request<Artist[]>('/api/artists'),
  artistSongs: (id: number) => request<Song[]>(`/api/artists/${id}/songs`),
  favoriteAlbum: (id: number) => request<Album>(`/api/albums/${id}/favorite`, { method: 'POST' }),
  playlists: () => request<Playlist[]>('/api/playlists'),
  createPlaylist: (name: string, description = '', cover_theme = 'deep-space') => request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify({ name, description, cover_theme }) }),
  playlistSongs: (id: number) => request<Song[]>(`/api/playlists/${id}/songs`),
  addToPlaylist: (playlistId: number, songId: number) => request<void>(`/api/playlists/${playlistId}/songs/${songId}`, { method: 'POST' }),
  removeFromPlaylist: (playlistId: number, songId: number) => request<void>(`/api/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE' }),
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (settings: Settings) => request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
}
