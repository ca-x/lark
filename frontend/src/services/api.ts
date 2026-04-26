import type { Album, Lyrics, Playlist, ScanResult, Settings, Song } from '../types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, ...init })
  if (!res.ok) throw new Error(await res.text())
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  songs: (q = '') => request<Song[]>(`/api/songs${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  song: (id: number) => request<Song>(`/api/songs/${id}`),
  favoriteSong: (id: number) => request<Song>(`/api/songs/${id}/favorite`, { method: 'POST' }),
  markPlayed: (id: number) => request<void>(`/api/songs/${id}/played`, { method: 'POST' }),
  lyrics: (id: number, sourceId?: string) => request<Lyrics>(`/api/songs/${id}/lyrics${sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : ''}`),
  scan: () => request<ScanResult>('/api/library/scan', { method: 'POST' }),
  upload: async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch('/api/library/upload', { method: 'POST', body })
    if (!res.ok) throw new Error(await res.text())
    return res.json() as Promise<Song[]>
  },
  albums: () => request<Album[]>('/api/albums'),
  albumSongs: (id: number) => request<Song[]>(`/api/albums/${id}/songs`),
  favoriteAlbum: (id: number) => request<Album>(`/api/albums/${id}/favorite`, { method: 'POST' }),
  playlists: () => request<Playlist[]>('/api/playlists'),
  createPlaylist: (name: string, description = '', cover_theme = 'spotify') => request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify({ name, description, cover_theme }) }),
  playlistSongs: (id: number) => request<Song[]>(`/api/playlists/${id}/songs`),
  addToPlaylist: (playlistId: number, songId: number) => request<void>(`/api/playlists/${playlistId}/songs/${songId}`, { method: 'POST' }),
  removeFromPlaylist: (playlistId: number, songId: number) => request<void>(`/api/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE' }),
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (settings: Settings) => request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
}
