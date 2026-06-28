# Lark Music

[中文说明](README_ZH.md)

Lark is a self-hosted web music player for people who keep their own music library. Point it at music on a NAS, home server, desktop, or container volume, then use a browser to scan, browse, fix, play, cache, and share that collection.

It is designed for large local libraries first: FLAC/WAV/Hi-Res albums, CUE sheets, uneven tags, missing lyrics, album art problems, and folders collected over time. It also covers the listening habits around that library: mobile playback, browser-side offline cache, radio, Subsonic-compatible clients, ListenBrainz/Last.fm scrobbling, and public share links.

The backend is Go + Echo v5 + Ent ORM, with SQLite by default. The frontend is React + TypeScript + Vite. The production web build is embedded into the Go server, so Lark can run as one service.

For release notes, see [CHANGELOG.md](CHANGELOG.md).

## Acknowledgements

Thanks to the [LinuxDo Community](https://linux.do) for discussion and feedback.

The Mineradio Stage player theme and its optional dark-stage effects take visual and interaction inspiration from [Mineradio](https://github.com/XxHuberrr/Mineradio) by XxHuberrr. Lark's implementation is a separate React/Three.js adaptation for this project and is not affiliated with Mineradio.

---

## Use Lark When

- You have a local music collection that has outgrown file browsers and shared folders.
- You want a private music site for a NAS, home server, VPS, or always-on desktop.
- You keep FLAC/WAV/Hi-Res albums, CUE rips, and older formats that need a careful playback path.
- Your tags, covers, artists, or lyrics are inconsistent and you want to repair them from the same interface you use to listen.
- You listen from desktop and mobile browsers, sometimes offline, sometimes through Subsonic/Navidrome-compatible clients.
- You want to share a song, album, artist, or playlist with someone without creating an account for them.

## Quick Start

The fastest way to try Lark is Docker:

```bash
docker compose up -d
```

Then open:

```text
http://localhost:8080
```

On first launch, create an admin account in the web UI. For unattended setup, pass the first admin account before the first start:

```bash
LARK_ADMIN_USERNAME=admin \
LARK_ADMIN_PASSWORD='change-me-now' \
LARK_ADMIN_NICKNAME='Lark Admin' \
docker compose up -d
```

By default, Lark stores app data and uploaded music in the `lark_data` Docker volume. If your music already exists inside the container, set `LARK_LIBRARY_DIR` to that path, then scan it from the web UI.

## Common Workflows

### Put A Local Library On The Web

- Scan one or more local directories, upload audio files, and browse by songs, albums, artists, playlists, folders, and sources.
- Paginated library views, album artist filtering, artist initials, folder browsing, and source tabs help with large or uneven collections.
- Album, artist, and playlist detail pages can start playback in one click.
- Browser-friendly formats stream directly, including MP3, FLAC, WAV, M4A/AAC, OGG/Vorbis, and OPUS.
- AIFF, APE, DSF, DFF, DST, and other less browser-friendly formats can stay in the library. When direct playback is unreliable, optional `ffmpeg` can transcode on demand.
- HTTP Range streaming keeps seeking stable in the browser.

### Clean Up Tags, Covers, And Lyrics

- Lark reads tags and embedded artwork with `github.com/dhowden/tag`. Optional `ffprobe` adds richer duration, sample-rate, bit-depth, and lyric detection.
- CUE sheets are parsed for image-based albums, and malformed non-audio CUE data is skipped without blocking the real audio files.
- Noisy artist names can be normalized, artist initials are saved, and A-Z / # filters make large artist lists easier to browse.
- Embedded lyrics are preferred. When they are missing, Lark can search online lyrics and let you choose a better candidate.
- LRC parsing supports offset tags, multiple timestamps on one line, millisecond precision, and original/translation grouping at the same timestamp.
- Lyrics can be shifted with an offset and saved automatically as a same-name `.lrc` file when that option is enabled.
- Song and album editors support online candidates, file-path candidates, manual input, cover URLs, and uploaded covers.
- Supported source files can be updated with corrected tags and artwork after confirmation. Lark shows per-file writeback results before you move on.
- Path-assisted metadata can repair bad tags during scans without writing back to source files unless tag writeback is enabled.

### Listen Across Devices

- Desktop home player styles include vinyl deck, cassette deck, iPod, audio scope, album sleeve, Smartisan deck, Gramophone, and Running kitten.
- Mobile player styles include Precision Audio, Gramophone, indiewave, iPod, soft vinyl, stage glass, blue halo, and Smartisan classic.
- The bottom player exposes queue, play mode, volume, progress, favorites, sleep timer, and fullscreen lyrics.
- Sleep timer can stop by duration, after a number of songs, or at the end of the current album.
- Playback queue, source context, resume position, and history can persist across sessions. Cross-device continue restores the saved queue, not only the last track.
- History can be separated by device when you want each phone, tablet, or browser to keep its own playback trail.
- Equalizer presets apply to local music, network tracks, and radio playback. Optional interface sounds add light feedback for playback, favorites, and sharing actions.
- The layout adapts across desktop sidebar, tablet icon rail, and mobile bottom navigation.
- Songs can be prepared for browser-side offline playback with visible cache status and storage use. Played songs can also be cached automatically, and offline mode prefers cached audio when the network is unavailable.

### Build Daily Listening Habits

- Favorites are user-scoped and cover songs, albums, artists, and radio stations.
- Playlists support creation, song insertion, and detail playback.
- Smart playlists surface recently played, recently added, favorites, unplayed tracks, Hi-Res tracks, and songs that still need lyrics.
- Daily Mix uses favorites, listening history, and the current day seed.
- The History view shows listening events as a timeline, with calendar and date filters for jumping back to a specific day.
- History retention is configurable in Site Settings. Set retention to `0` to keep playback history permanently.
- Library inventory stays separate from playback behavior: recently played songs do not change the library's latest-added ordering.

### Add Radio, Network Libraries, And External Clients

- Online radio includes the built-in cliamp source, custom playlist sources, Radio Browser top/search, and radio favorites.
- Network library sources can connect to Navidrome/Subsonic, Jellyfin, and Plex for search and streaming.
- Streaming quality and transcode policy can be tuned for local network, mobile data, or constrained devices.
- Public share links can expose songs, albums, artists, or playlists on a playback page without sign-in.
- Share links can be permanent or expire after 1 hour, 1 day, 7 days, or 30 days, and users can manage links they created.
- The optional Subsonic-compatible `/rest/*.view` service lets Subsonic/Navidrome clients connect with separate Subsonic credentials.
- Lark exposes an MCP SSE endpoint for AI clients, with tools for listing artists and albums, searching songs, reading favorites, toggling favorites, fetching lyrics, and preparing playback URLs.
- Played tracks can be scrobbled to ListenBrainz or Last.fm with configurable thresholds.

### Administer A Private Music Service

- First-run setup creates the first admin account. Admins can also enable registration.
- Settings cover language, theme, library paths, directory status, directory watch, diagnostics, font uploads, lyrics font, and transcode policy.
- Lark supports Simplified Chinese and English. The app name appears as **百灵** in Chinese and **Lark** in English.
- The theme system includes 21 schemes: original dark and light themes, Apple Music / Spotify / NetEase / Winamp / Foobar2000 inspired dark and light themes, and a Smartisan Music classic theme.
- Uploaded web fonts can be used for the whole interface or just lyrics.
- Health information reports the running version, commit, build time, Go version, and media backend status.

---

## Screenshots

<img width="1338" height="407" alt="Lark player themes" src="https://github.com/user-attachments/assets/5060aa84-964b-4ce8-a544-868d4dd87daa" />

<img width="2516" height="1371" alt="Lark music library" src="https://github.com/user-attachments/assets/de8653f7-c166-4fc2-ae31-6f5bc4648646" />

<img width="2520" height="1370" alt="Lark album view" src="https://github.com/user-attachments/assets/7bc38bbe-9003-436c-bd16-14d9e94be07c" />

---

## Technical Overview

### Stack

- Backend: Go, Echo v5, Ent ORM
- Database: SQLite by default via `github.com/lib-x/entsqlite`; PostgreSQL and MySQL can be selected by environment variables
- Frontend: React, TypeScript, Vite
- Audio metadata: `github.com/dhowden/tag` for reading, `go.senan.xyz/taglib` for tag/artwork writeback, and the built-in WAV INFO writer for WAV text fields
- Optional media tools: `ffprobe` for metadata and `ffmpeg` for fallback stream transcoding/offline preparation
- Frontend serving: built assets embedded into the Go server with `go:embed`
- Automation: GitHub Actions for CI, release binaries, and Docker image publishing

### Audio Strategy

Lark intentionally keeps the default build CGO-free:

- `/api/songs/:id/stream?mode=raw` serves the original file via `http.ServeFile`, preserving Range requests.
- The frontend uses `mode=auto` so browser-compatible formats stream directly.
- Browser-incompatible formats can be transcoded on demand by the optional `ffmpeg` binary.
- `go-astiav`/FFmpeg bindings are not part of the default build because they require CGO and system `libav*` development packages, which would complicate multi-platform binary releases.

---

## Local Development

### Prerequisites

- Go 1.25+ / 1.26 recommended
- Node.js 22+
- pnpm 10+
- Optional: `ffmpeg` and `ffprobe`

### Backend

```bash
cd backend
go test ./...
go run ./cmd/server
```

Default server settings:

| Environment variable | Default | Description |
| --- | --- | --- |
| `LARK_PORT` | `8080` | HTTP port |
| `LARK_DATA_DIR` | `./data` | App data directory |
| `LARK_LIBRARY_DIR` | `./data/music` | Music library scan/upload directory |
| `LARK_DB_TYPE` | `sqlite` | Database type: `sqlite` / `sqlite3`, `postgres` / `postgresql`, or `mysql` / `mariadb` |
| `LARK_DB_DSN` | empty | Database connection string. Leave empty for SQLite to use `./data/lark.db`; for SQLite this can be a `file:` DSN or a plain file path. Required for PostgreSQL/MySQL. |
| `LARK_FRONTEND_ORIGIN` | `*` | CORS origin |
| `LARK_ADMIN_USERNAME` | empty | Create the first admin automatically when the database has no users |
| `LARK_ADMIN_PASSWORD` | empty | Password for `LARK_ADMIN_USERNAME`; must be set together with username |
| `LARK_ADMIN_NICKNAME` | empty | Optional nickname for the auto-created admin |
| `FFMPEG_BIN` | `ffmpeg` | Optional transcoder binary |
| `FFPROBE_BIN` | `ffprobe` | Optional metadata probe binary |
| `LARK_CACHE_BACKEND` | `badger` | Cache backend: `badger`, `redis`, `memory`, or `none`. If unset and Redis env vars are present, Redis is selected automatically. |
| `LARK_CACHE_TTL_SECONDS` | `120` | TTL for cached library list/query responses |
| `LARK_CACHE_DIR` | `./data/cache/badger` | Badger cache directory when using the built-in KV backend |
| `LARK_BADGER_CACHE_MB` | empty | Advanced override for the built-in Badger cache memory budget in MB. Leave empty to auto-size from physical memory. |
| `LARK_REDIS_URL` | empty | Optional Redis URL, e.g. `redis://:password@redis:6379/0`. Takes precedence over host/password/db settings. |
| `LARK_REDIS_ADDR` | empty | Redis address. Setting this env var enables Redis when `LARK_CACHE_BACKEND` is unset; if Redis is explicitly selected without an address, runtime falls back to `localhost:6379`. |
| `LARK_REDIS_PASSWORD` | empty | Redis password |
| `LARK_REDIS_DB` | empty | Redis database number; runtime fallback is `0` when Redis is selected |
| `LARK_REDIS_KEY_PREFIX` | empty | Prefix for Lark cache keys in Redis; runtime fallback is `lark:cache:` when Redis is selected |
| `LARK_SQLITE_MAX_OPEN_CONNS` | `4` | SQLite connection pool size. Lower to `2` on low-memory devices such as NAS or Raspberry Pi. |
| `LARK_SQLITE_MAX_IDLE_CONNS` | `4` | SQLite idle connections kept warm. Should equal `LARK_SQLITE_MAX_OPEN_CONNS`. |

Release builds inject `lark/backend/pkg/version` values with Go `-ldflags`; the Web settings page displays the running version, commit, and build time from `/api/health`.

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

For a production-style embedded server build:

```bash
cd frontend
pnpm build   # writes embedded assets to ../backend/web/dist
cd ../backend
go run ./cmd/server
```

---

## Docker

Use the Quick Start command above for a basic deployment. This section covers the Docker defaults you usually change after the first run: where music lives, database tuning, and optional Redis.

The default compose file stores app data and uploaded music in the `lark_data` volume. If your runtime already exposes a music directory inside the container, set `LARK_LIBRARY_DIR` to that in-container path; otherwise leave it as `/app/data/music` and use uploads/scans within the app data volume. The published Docker image already includes `ffmpeg`/`ffprobe`; no extra compose environment is required for the default transcoding and metadata probe paths. Recursive scans skip the platform bookkeeping directory named `.shared-center`, then continue scanning sibling directories while keeping the configured library root unchanged.

```bash
LARK_LIBRARY_DIR=/lzcapp/run/mnt/home docker compose up -d
```

SQLite is used by default. Lark applies a tuned DSN automatically; set `LARK_DB_DSN` only when you need to relocate the file:

```bash
LARK_DB_DSN=/app/data/lark.db docker compose up -d
```

### Recommended SQLite Configuration

Lark's default DSN enables WAL mode, foreign keys, and memory-mapped I/O. The connection pool defaults to 4 connections, which is sufficient for most deployments including 9000+ FLAC libraries. For low-memory devices such as Raspberry Pi or NAS with 1 GB RAM or less, reduce the pool:

```bash
LARK_SQLITE_MAX_OPEN_CONNS=2
LARK_SQLITE_MAX_IDLE_CONNS=2
LARK_DB_DSN='file:/app/data/lark.db?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)&_pragma=cache_size(-8000)&_pragma=temp_store(MEMORY)&_pragma=mmap_size(134217728)'
```

The default DSN applied for a plain SQLite path uses these pragmas:

| Pragma | Value | Purpose |
| --- | --- | --- |
| `foreign_keys` | `1` | Enable referential integrity |
| `journal_mode` | `WAL` | Concurrent readers + 1 writer; crash-safe |
| `synchronous` | `NORMAL` | Good durability with WAL; faster than FULL |
| `busy_timeout` | `5000` | Fail fast on write contention after 5 seconds |
| `cache_size` | `-20000` | About 20 MB shared page cache per connection |
| `temp_store` | `MEMORY` | Keep temp tables in RAM |
| `mmap_size` | `268435456` | 256 MB memory-mapped I/O for reads |

If you set a custom `LARK_DB_DSN` with `?` parameters, Lark uses your DSN as-is without adding defaults. This is useful when you need to tune for a specific workload.

To use another database, set both `LARK_DB_TYPE` and `LARK_DB_DSN`:

```bash
LARK_DB_TYPE=postgres \
LARK_DB_DSN='postgres://lark:secret@postgres:5432/lark?sslmode=disable' \
docker compose up -d

LARK_DB_TYPE=mysql \
LARK_DB_DSN='lark:secret@tcp(mysql:3306)/lark?parseTime=true&charset=utf8mb4&loc=Local' \
docker compose up -d
```

### Cache Backend

By default Lark uses the built-in Badger KV cache under `LARK_CACHE_DIR`; no external service is required. Badger memory is auto-sized from physical memory, and `LARK_BADGER_CACHE_MB` is only an advanced override for constrained or unusually large deployments. Redis is used only when you explicitly configure Redis-related environment variables or set `LARK_CACHE_BACKEND=redis`.

Use an external Redis:

```bash
LARK_REDIS_URL='redis://:password@redis.example.com:6379/0' docker compose up -d
# or
LARK_REDIS_ADDR='redis.example.com:6379' \
LARK_REDIS_PASSWORD='password' \
LARK_REDIS_DB=0 \
docker compose up -d
```

Run the optional Redis service bundled in `docker-compose.yml`:

```bash
LARK_REDIS_ADDR=redis:6379 docker compose --profile redis up -d
```

If no `LARK_REDIS_*` variable is set, compose starts only Lark and keeps using the built-in Badger KV cache.

Then open:

```text
http://localhost:8080
```

---

## GitHub Actions

- `.github/workflows/ci.yml`: installs frontend dependencies, runs frontend lint/build, syncs embedded assets, verifies Go modules, runs `go test` and `go vet`, builds the backend server, and verifies the Docker image build.
- `.github/workflows/binary.yml`: creates release draft assets for Linux, macOS, and Windows when a `v*` tag is pushed; also supports manual artifact builds.
- `.github/workflows/docker.yml`: publishes multi-architecture Docker images to GHCR and, when Docker Hub secrets are configured, Docker Hub.

Required secrets for Docker Hub publishing:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

GHCR publishing uses the repository `GITHUB_TOKEN`.

---

## Credits And Notices

- The Smartisan Music classic theme is credited to [DE105/SmartisanMusic-Revived](https://github.com/DE105/SmartisanMusic-Revived). The referenced Smartisan Music visual assets, trademarks, product names, and UI designs belong to their respective rights holders and are included here only for learning, research, and preservation.
- Lyrics matching and local metadata handling ideas reference [guohuiyuan/go-music-dl](https://github.com/guohuiyuan/go-music-dl). Lark implements the source-file writeback flow independently.
