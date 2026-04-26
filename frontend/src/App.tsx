import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Heart, ListBullets, MagnifyingGlass, Pause, Play, Plus, Record, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward, SpeakerHigh, Timer, UploadSimple } from '@phosphor-icons/react'
import { api } from './services/api'
import type { Album, Language, Lyrics, Playlist, Settings, Song, Theme } from './types'
import { createT } from './i18n'

const defaultSettings: Settings = { language: 'zh-CN', theme: 'spotify', sleep_timer_mins: 0, library_path: '', netease_fallback: true }

type View = 'home' | 'library' | 'playlists' | 'albums' | 'collection' | 'settings'
type PlayMode = 'sequence' | 'shuffle' | 'repeat-one'
type Collection = { type: 'playlist' | 'album'; title: string; subtitle: string; songs: Song[] }

function randomQueueIndex(length: number, currentIndex: number) {
  if (length <= 1) return 0
  let nextIndex = Math.floor(Math.random() * length)
  if (nextIndex === currentIndex) nextIndex = (nextIndex + 1) % length
  return nextIndex
}

function coverUrl(song?: Song | null) {
  return song ? `/api/songs/${song.id}/cover` : undefined
}


function formatDuration(seconds: number) {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function formatQuality(song: Song) {
  const bits = song.bit_depth ? `${song.bit_depth}bit` : ''
  const rate = song.sample_rate ? `${(song.sample_rate / 1000).toFixed(song.sample_rate % 1000 ? 1 : 0)}kHz` : ''
  return [song.format.toUpperCase(), bits, rate].filter(Boolean).join(' · ') || song.mime
}

type LyricLine = { at: number; text: string; key: string; groupKey: string; order: number }

function parseTimestamp(value: string) {
  const parts = value.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const secondsPart = parts.pop() ?? '0'
  const seconds = Number(secondsPart.replace(':', '.'))
  const minutes = Number(parts.pop() ?? '0')
  const hours = Number(parts.pop() ?? '0')
  if (![seconds, minutes, hours].every(Number.isFinite)) return null
  return hours * 3600 + minutes * 60 + seconds
}

function parseLyricLines(lyrics?: string): LyricLine[] {
  if (!lyrics) return []
  let offsetSeconds = 0
  const parsed: LyricLine[] = []
  const timestampPattern = /\[((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?)\]/g

  lyrics.split('\n').forEach((rawLine, order) => {
    const line = rawLine.trim()
    if (!line) return
    const offsetMatch = line.match(/^\[offset:([+-]?\d+)\]/i)
    if (offsetMatch) {
      offsetSeconds = Number(offsetMatch[1]) / 1000
      return
    }

    const matches = [...line.matchAll(timestampPattern)]
    const text = line.replace(timestampPattern, '').replace(/^\[[^\]]+\]/, '').trim()
    if (!text) return

    if (!matches.length) {
      if (!/^\[[a-z]+:/i.test(line)) parsed.push({ at: -1, text, key: `u-${order}`, groupKey: `u-${order}`, order })
      return
    }

    matches.forEach((match, tagIndex) => {
      const at = parseTimestamp(match[1])
      if (at == null) return
      const adjusted = Math.max(0, at + offsetSeconds)
      const groupKey = adjusted.toFixed(3)
      parsed.push({ at: adjusted, text, key: `${order}-${tagIndex}-${groupKey}`, groupKey, order })
    })
  })

  return parsed.sort((a, b) => {
    if (a.at < 0 && b.at < 0) return a.order - b.order
    if (a.at < 0) return 1
    if (b.at < 0) return -1
    return a.at - b.at || a.order - b.order
  })
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [songs, setSongs] = useState<Song[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [queue, setQueue] = useState<Song[]>([])
  const [collection, setCollection] = useState<Collection | null>(null)
  const [current, setCurrent] = useState<Song | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playMode, setPlayMode] = useState<PlayMode>('sequence')
  const [view, setView] = useState<View>('home')
  const [query, setQuery] = useState('')
  const [lyrics, setLyrics] = useState<Lyrics | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [lyricsFullScreen, setLyricsFullScreen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [sleepTimerMins, setSleepTimerMins] = useState(0)
  const [sleepLeft, setSleepLeft] = useState(0)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lyricsScrollRef = useRef<HTMLDivElement | null>(null)
  const lyricFollowPausedUntil = useRef(0)
  const t = useMemo(() => createT(settings.language), [settings.language])
  const lyricLines = useMemo(() => parseLyricLines(lyrics?.lyrics), [lyrics])
  const activeLyric = useMemo(() => {
    let activeIndex = -1
    for (let i = 0; i < lyricLines.length; i += 1) {
      if (lyricLines[i].at >= 0 && lyricLines[i].at <= progress + 0.08) activeIndex = i
      if (lyricLines[i].at > progress + 0.08) break
    }
    if (activeIndex < 0) return ''
    const activeGroup = lyricLines[activeIndex].groupKey
    while (activeIndex > 0 && lyricLines[activeIndex - 1].groupKey === activeGroup) activeIndex -= 1
    return lyricLines[activeIndex].key
  }, [lyricLines, progress])

  useEffect(() => { void bootstrap() }, [])
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; document.documentElement.lang = settings.language; document.title = `${t('brand')} Music` }, [settings.theme, settings.language, t])
  useEffect(() => {
    if (!current) return
    setProgress(0)
    setDuration(current.duration_seconds || 0)
    setLyrics(null)
    setLyricsLoading(true)
    void api.lyrics(current.id).then(setLyrics).catch(() => setLyrics(null)).finally(() => setLyricsLoading(false))
  }, [current])
  useEffect(() => {
    if (!audioRef.current) return
    if (playing) void audioRef.current.play().catch(() => setPlaying(false))
    else audioRef.current.pause()
  }, [playing, current])
  useEffect(() => {
    if (!sleepTimerMins) { setSleepLeft(0); return }
    const end = Date.now() + sleepTimerMins * 60_000
    setSleepLeft(sleepTimerMins * 60)
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setSleepLeft(left)
      if (left === 0) { setPlaying(false); setSleepTimerMins(0) }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [sleepTimerMins])

  useEffect(() => {
    if (!lyricsFullScreen || !activeLyric || Date.now() < lyricFollowPausedUntil.current) return
    const container = lyricsScrollRef.current
    const active = container?.querySelector<HTMLElement>(`[data-lyric-key="${CSS.escape(activeLyric)}"]`)
    if (!container || !active) return
    const target = active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [activeLyric, lyricsFullScreen])

  async function bootstrap() {
    const loaded = await api.settings().catch(() => defaultSettings)
    setSettings(loaded)
    await refreshAll()
  }

  async function refreshAll() {
    const [songItems, albumItems, playlistItems] = await Promise.all([api.songs(query), api.albums(), api.playlists()])
    setSongs(songItems); setAlbums(albumItems); setPlaylists(playlistItems)
    setQueue(songItems)
    setCurrent((old) => old ?? songItems[0] ?? null)
  }

  async function playSong(song: Song, list = songs) {
    setCurrent(song); setQueue(list); setPlaying(true); await api.markPlayed(song.id).catch(() => undefined)
  }

  function next(delta: 1 | -1, ended = false) {
    if (!current || queue.length === 0) return
    if (ended && playMode === 'repeat-one') {
      if (audioRef.current) audioRef.current.currentTime = 0
      setPlaying(true)
      return
    }
    const idx = queue.findIndex((song) => song.id === current.id)
    const target = playMode === 'shuffle' && queue.length > 1
      ? queue[randomQueueIndex(queue.length, Math.max(0, idx))]
      : queue[(idx + delta + queue.length) % queue.length]
    void playSong(target, queue)
  }

  function cyclePlayMode() {
    setPlayMode((mode) => mode === 'sequence' ? 'shuffle' : mode === 'shuffle' ? 'repeat-one' : 'sequence')
  }

  async function scan() {
    setMessage('Scanning...')
    const result = await api.scan()
    setMessage(`${t('done')}: +${result.added}, ↻${result.updated}, errors ${result.errors.length}`)
    await refreshAll()
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setMessage(`Uploading ${file.name}...`)
    await api.upload(file)
    setMessage(t('done'))
    await refreshAll()
  }

  async function saveSettings(nextSettings: Settings) {
    setSettings(nextSettings)
    await api.saveSettings(nextSettings).catch(() => undefined)
  }


  async function toggleFavorite(song: Song) {
    const updated = await api.favoriteSong(song.id)
    setSongs((old) => old.map((item) => item.id === updated.id ? updated : item))
    if (current?.id === updated.id) setCurrent(updated)
  }

  async function createPlaylist() {
    const name = window.prompt(t('createPlaylist'))?.trim()
    if (!name) return
    await api.createPlaylist(name, '', settings.theme)
    setPlaylists(await api.playlists())
  }

  async function addToPlaylist(song: Song) {
    if (playlists.length === 0) await createPlaylist()
    const latest = await api.playlists()
    setPlaylists(latest)
    const choice = window.prompt(`${t('pickPlaylist')}:\n${latest.map((p) => `${p.id}: ${p.name}`).join('\n')}`)
    const id = Number(choice)
    if (!id) return
    await api.addToPlaylist(id, song.id)
    setMessage(t('done'))
  }

  async function openPlaylist(playlist: Playlist) {
    const items = await api.playlistSongs(playlist.id)
    setCollection({ type: 'playlist', title: playlist.name, subtitle: `${items.length} ${t('count')}`, songs: items })
    setView('collection')
  }

  async function openAlbum(album: Album) {
    const items = await api.albumSongs(album.id)
    setCollection({ type: 'album', title: album.title, subtitle: `${album.artist} · ${items.length} ${t('count')}`, songs: items })
    setView('collection')
  }

  const nav = [{ id: 'home', label: t('home') }, { id: 'library', label: t('library') }, { id: 'playlists', label: t('playlists') }, { id: 'albums', label: t('albums') }, { id: 'settings', label: t('settings') }] as const
  const activeNav = (id: typeof nav[number]['id']) => view === id || (view === 'collection' && collection?.type === 'playlist' && id === 'playlists') || (view === 'collection' && collection?.type === 'album' && id === 'albums')
  const heroSong = current ?? songs[0]
  const playModeLabel = playMode === 'sequence' ? t('playModeSequence') : playMode === 'shuffle' ? t('playModeShuffle') : t('playModeRepeatOne')
  const playableDuration = duration || current?.duration_seconds || 0

  return <div className={lyricsFullScreen ? 'app-shell lyrics-mode' : 'app-shell'}>
    <aside className="sidebar">
      <div className="brand"><img src="/logo.png" alt={t('brand')} /> <span>{t('brand')}</span></div>
      <nav>{nav.map((item) => <button key={item.id} className={activeNav(item.id) ? 'active' : ''} onClick={() => { setLyricsFullScreen(false); setView(item.id); if (item.id === 'library') void api.songs(query).then(setSongs) }}>{item.label}</button>)}</nav>
    </aside>

    <main className="main">
      {lyricsFullScreen ? <FullLyrics song={current} lines={lyricLines} activeLyric={activeLyric} loading={lyricsLoading} t={t} scrollRef={lyricsScrollRef} onUserScroll={() => { lyricFollowPausedUntil.current = Date.now() + 2500 }} /> : <>
        <header className="topbar">
          <label className="search"><MagnifyingGlass /><input value={query} placeholder={t('search')} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void api.songs(query).then(setSongs) }} /></label>
          </header>
        {message && <div className="message">{message}</div>}

        {view === 'home' && <section className="hero">
          <Turntable song={heroSong} playing={playing && current?.id === heroSong?.id} />
          <div><p>{t('playingFrom')}</p><h1>{heroSong?.title ?? `${t('brand')} Music`}</h1><h2>{heroSong ? `${heroSong.artist} · ${heroSong.album}` : t('noSongs')}</h2><button className="primary" disabled={!heroSong} onClick={() => heroSong && void playSong(heroSong)}><Play weight="fill" /> {t('play')}</button></div>
        </section>}

        {view === 'library' && <LibraryView songs={songs} current={current} t={t} onPlay={playSong} onFavorite={toggleFavorite} onAdd={addToPlaylist} onScan={() => void scan()} onUpload={upload} />}
        {view === 'collection' && collection && <CollectionView collection={collection} current={current} t={t} onBack={() => setView(collection.type === 'playlist' ? 'playlists' : 'albums')} onPlayAll={() => collection.songs[0] && void playSong(collection.songs[0], collection.songs)} onPlay={playSong} onFavorite={toggleFavorite} onAdd={addToPlaylist} />}
        {view === 'playlists' && <CardGrid title={t('playlists')} action={<button onClick={() => void createPlaylist()}><Plus /> {t('createPlaylist')}</button>} items={playlists.map((p) => ({ id: p.id, title: p.name, subtitle: `${p.song_count} ${t('count')}`, theme: p.cover_theme, onClick: () => void openPlaylist(p) }))} />}
        {view === 'albums' && <CardGrid title={t('albums')} items={albums.map((a) => ({ id: a.id, title: a.title, subtitle: `${a.artist} · ${a.song_count} ${t('count')}`, theme: settings.theme, onClick: () => void openAlbum(a) }))} />}
        {view === 'settings' && <SettingsPanel settings={settings} setSettings={(s) => void saveSettings(s)} t={t} />}
      </>}
    </main>

    <footer className="player">
      <div className="now"><button className="cover-button" title={t('lyrics')} aria-label={t('lyrics')} onClick={() => setLyricsFullScreen((value) => !value)}><MiniCover song={current} playing={playing} /></button><div><strong>{current?.title ?? t('nowPlaying')}</strong><span>{current ? `${current.artist} · ${formatQuality(current)}` : '—'}</span></div><button disabled={!current} onClick={() => current && void toggleFavorite(current)}><Heart weight={current?.favorite ? 'fill' : 'regular'} /></button></div>
      <div className="transport"><div className="transport-controls"><button className={playMode === 'sequence' ? 'mode-button' : 'mode-button active'} title={playModeLabel} aria-label={playModeLabel} onClick={cyclePlayMode}>{playMode === 'shuffle' ? <Shuffle /> : playMode === 'repeat-one' ? <RepeatOnce /> : <Repeat />}</button><div className="playback-buttons"><button onClick={() => next(-1)}><SkipBack weight="fill" /></button><button className="play" disabled={!current} onClick={() => setPlaying((v) => !v)}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button><button onClick={() => next(1)}><SkipForward weight="fill" /></button></div><span className="transport-spacer" aria-hidden="true" /></div><input type="range" min="0" max={playableDuration || 0} step="0.01" value={Math.min(progress, playableDuration || progress || 0)} disabled={!playableDuration} onChange={(e) => { if (audioRef.current) { const nextTime = Number(e.target.value); audioRef.current.currentTime = nextTime; setProgress(nextTime) } }} /><span>{formatDuration(progress)} / {formatDuration(playableDuration)}</span></div>
      <div className="volume"><button className={queueOpen ? 'queue-toggle active' : 'queue-toggle'} title={t('queue')} aria-label={t('queue')} onClick={() => setQueueOpen((value) => !value)}><ListBullets /></button><SleepTimerControl value={sleepTimerMins} left={sleepLeft} onChange={setSleepTimerMins} t={t} /><SpeakerHigh /><input type="range" min="0" max="1" step="0.01" defaultValue="0.85" onChange={(e) => { if (audioRef.current) audioRef.current.volume = Number(e.target.value) }} /></div>
      {queueOpen && <QueuePanel queue={queue} current={current} t={t} onPlay={(song) => void playSong(song, queue)} onClose={() => setQueueOpen(false)} />}
      <audio ref={audioRef} preload="metadata" src={current ? `/api/songs/${current.id}/stream?mode=auto` : undefined} onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration) }} onDurationChange={(e) => { if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration) }} onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)} onSeeking={(e) => setProgress(e.currentTarget.currentTime)} onEnded={() => next(1, true)} />
    </footer>
  </div>
}

function Turntable({ song, playing, decorative = false }: { song?: Song | null; playing: boolean; decorative?: boolean }) {
  const style = coverUrl(song) ? { '--cover-url': `url(${coverUrl(song)})` } as React.CSSProperties : undefined
  return <div className={decorative ? 'turntable decorative' : 'turntable'} data-playing={playing ? 'true' : 'false'} style={style}>
    <div className="vinyl-disc"><Record weight="fill" /></div>
    <div className="tonearm"><span /></div>
    <div className="turntable-status">{playing ? 'PLAY' : 'PAUSE'}</div>
  </div>
}

function MiniCover({ song, playing }: { song?: Song | null; playing: boolean }) {
  const style = coverUrl(song) ? { '--cover-url': `url(${coverUrl(song)})` } as React.CSSProperties : undefined
  return <div className="mini-art" data-playing={playing ? 'true' : 'false'} style={style}><Record weight="fill" /></div>
}

function CollectionView({ collection, current, t, onBack, onPlayAll, onPlay, onFavorite, onAdd }: { collection: Collection; current: Song | null; t: ReturnType<typeof createT>; onBack: () => void; onPlayAll: () => void; onPlay: (song: Song, list: Song[]) => void; onFavorite: (song: Song) => void; onAdd: (song: Song) => void }) {
  return <section className="collection-view">
    <button className="back-button" onClick={onBack}>← {collection.type === 'playlist' ? t('playlists') : t('albums')}</button>
    <div className="collection-hero">
      <CollectionCover collection={collection} />
      <div>
        <p>{collection.type === 'playlist' ? t('playlists') : t('albums')}</p>
        <h1>{collection.title}</h1>
        <span>{collection.subtitle}</span>
        <button className="primary" disabled={!collection.songs.length} onClick={onPlayAll}><Play weight="fill" /> {t('playAll')}</button>
      </div>
    </div>
    <SongTable songs={collection.songs} current={current} t={t} onPlay={onPlay} onFavorite={onFavorite} onAdd={onAdd} />
  </section>
}


function CollectionCover({ collection }: { collection: Collection }) {
  const firstSong = collection.songs[0]
  const style = coverUrl(firstSong) ? { '--cover-url': `url(${coverUrl(firstSong)})` } as React.CSSProperties : undefined
  return <div className="cover collection-cover" style={style}><Record weight="fill" /></div>
}

function LibraryView({ songs, current, t, onPlay, onFavorite, onAdd, onScan, onUpload }: { songs: Song[]; current: Song | null; t: ReturnType<typeof createT>; onPlay: (song: Song, list: Song[]) => void; onFavorite: (song: Song) => void; onAdd: (song: Song) => void; onScan: () => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return <section className="library-view">
    <div className="section-head library-actions">
      <h2>{t('library')}</h2>
      <div>
        <button onClick={onScan}><MagnifyingGlass /> {t('scan')}</button>
        <label className="upload"><UploadSimple /> {t('upload')}<input type="file" accept="audio/*,.flac,.dsf,.dff,.dst,.ape" onChange={(event) => onUpload(event)} /></label>
      </div>
    </div>
    {songs.length ? <SongTable songs={songs} current={current} t={t} onPlay={onPlay} onFavorite={onFavorite} onAdd={onAdd} /> : <EmptyLibrary t={t} onScan={onScan} onUpload={onUpload} />}
  </section>
}

function FullLyrics({ song, lines, activeLyric, loading, t, scrollRef, onUserScroll }: { song: Song | null; lines: ReturnType<typeof parseLyricLines>; activeLyric: string; loading: boolean; t: ReturnType<typeof createT>; scrollRef: React.RefObject<HTMLDivElement | null>; onUserScroll: () => void }) {
  return <section className="full-lyrics">
    <Turntable song={song} playing={false} decorative />
    <div className="full-lyrics-head">
      <MiniCover song={song} playing={false} />
      <div><p>{t('nowPlaying')}</p><h1>{song?.title ?? `${t('brand')} Music`}</h1><span>{song ? `${song.artist} · ${song.album}` : '—'}</span></div>
    </div>
    <div className="full-lyrics-lines" ref={scrollRef} onWheel={onUserScroll} onTouchMove={onUserScroll}>
      {lines.length ? lines.map((line) => <p key={line.key} data-lyric-key={line.key} className={line.key === activeLyric ? 'live' : ''}>{line.text}</p>) : <div className="lyrics-empty"><strong>{loading ? t('matchingLyrics') : t('noLyricsTitle')}</strong>{!loading && <span>{t('noLyricsBody')}</span>}</div>}
    </div>
  </section>
}

function EmptyLibrary({ t, onScan, onUpload }: { t: ReturnType<typeof createT>; onScan: () => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return <section className="empty-library">
    <div className="disc-art"><Record weight="fill" /></div>
    <h2>{t('emptyTitle')}</h2>
    <p>{t('emptyBody')}</p>
    <div className="empty-actions">
      <button className="primary" onClick={onScan}><MagnifyingGlass /> {t('scan')}</button>
      <label className="upload"><UploadSimple /> {t('upload')}<input type="file" accept="audio/*,.flac,.dsf,.dff,.dst,.ape" onChange={(event) => onUpload(event)} /></label>
    </div>
    <small>{t('scanHint')}</small>
  </section>
}

function QueuePanel({ queue, current, t, onPlay, onClose }: { queue: Song[]; current: Song | null; t: ReturnType<typeof createT>; onPlay: (song: Song) => void; onClose: () => void }) {
  return <div className="queue-panel">
    <div className="queue-head"><strong>{t('queue')}</strong><button onClick={onClose}>×</button></div>
    <div className="queue-list">
      {queue.map((song, index) => <button key={`${song.id}-${index}`} className={song.id === current?.id ? 'active' : ''} onClick={() => onPlay(song)}>
        <span>{index + 1}</span>
        <div><strong>{song.title}</strong><small>{song.artist}</small></div>
        <em>{formatDuration(song.duration_seconds)}</em>
      </button>)}
    </div>
  </div>
}

function SleepTimerControl({ value, left, onChange, t }: { value: number; left: number; onChange: (value: number) => void; t: ReturnType<typeof createT> }) {
  const label = value ? `${Math.ceil(left / 60)} ${t('minutes')}` : t('sleepTimer')
  return <label className={value ? 'sleep-control active' : 'sleep-control'} title={label} aria-label={label}>
    <Timer />
    <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
      <option value="0">{t('off')}</option>
      <option value="15">15 {t('minutes')}</option>
      <option value="30">30 {t('minutes')}</option>
      <option value="60">60 {t('minutes')}</option>
      <option value="90">90 {t('minutes')}</option>
    </select>
    {value ? <span>{Math.ceil(left / 60)}</span> : null}
  </label>
}

function SettingsPanel({ settings, setSettings, t }: { settings: Settings; setSettings: (settings: Settings) => void; t: ReturnType<typeof createT> }) { return <section className="settings-grid"><label>{t('language')}<select value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value as Language })}><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></label><label>{t('theme')}<select value={settings.theme} onChange={(e) => setSettings({ ...settings, theme: e.target.value as Theme })}><option value="spotify">{t('spotify')}</option><option value="apple">{t('apple')}</option><option value="vinyl">{t('vinyl')}</option></select></label><label>{t('libraryPath')}<input readOnly value={settings.library_path} /></label></section> }
function SongTable({ songs, current, t, onPlay, onFavorite, onAdd }: { songs: Song[]; current: Song | null; t: ReturnType<typeof createT>; onPlay: (song: Song, list: Song[]) => void; onFavorite: (song: Song) => void; onAdd: (song: Song) => void }) { if (!songs.length) return <div className="empty">{t('noSongs')}</div>; return <section className="song-table">{songs.map((song, index) => <div key={song.id} className={current?.id === song.id ? 'song-row active' : 'song-row'} onDoubleClick={() => onPlay(song, songs)}><span>{index + 1}</span><button onClick={() => onPlay(song, songs)}><Play weight="fill" /></button><div><strong>{song.title}</strong><small>{song.artist}</small></div><div>{song.album}</div><div>{formatQuality(song)}</div><div>{formatDuration(song.duration_seconds)}</div><button onClick={() => onFavorite(song)}><Heart weight={song.favorite ? 'fill' : 'regular'} /></button><button onClick={() => onAdd(song)}>{t('addToPlaylist')}</button></div>)}</section> }
function CardGrid({ title, items, action }: { title: string; items: { id: number; title: string; subtitle: string; theme: string; onClick: () => void }[]; action?: React.ReactNode }) { return <section><div className="section-head"><h2>{title}</h2>{action}</div><div className="cards">{items.map((item) => <button className={`media-card ${item.theme}`} key={item.id} onClick={item.onClick}><div className="cover"><Record weight="fill" /></div><strong>{item.title}</strong><span>{item.subtitle}</span></button>)}</div></section> }
