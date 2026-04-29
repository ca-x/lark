# Lark Music

[中文说明](README_ZH.md)

Lark is a self-hosted web music player for personal high-resolution music libraries. The backend is Go + Echo v5 + Ent ORM with SQLite by default, and the frontend is React/Vite with an embedded production build served by the Go binary.

---

## What users can do

### Listen to local hi-res music

- Scan a local music directory from the Library page.
- Upload individual audio files from the Library page.
- Stream files with HTTP Range support so browser seeking works smoothly.
- Play browser-friendly formats directly: MP3, FLAC, WAV, M4A/AAC, OGG/Vorbis, OPUS.
- Keep rarer hi-res formats such as AIFF, APE, DSF, DFF, and DST in the library; when direct browser playback is unreliable, Lark can use the optional `ffmpeg` CLI to transcode the stream to MP3.
- Read metadata and cover art with pure-Go `github.com/dhowden/tag`; optional `ffprobe` improves duration, sample-rate, bit-depth, and embedded lyric discovery.

### Manage albums, playlists, and queue

- Browse all songs, artists, albums, and playlists.
- Open an artist, album, or playlist as its own detail page instead of being sent back to the full library.
- Click a song artist or album artist to open the artist page with every matching library track.
- Start an artist, album, or playlist with one click from the detail page.
- Favorite songs and albums.
- Create playlists and add songs to them.
- Open the current playback queue from the bottom player controls.
- Insert one selected song as the next track, or select multiple library songs and insert them as the next batch.
- Switch play mode from the player controls: sequence, shuffle, and repeat-one.

### Lyrics and playback experience

- Prefer embedded lyrics when they exist in the audio file.
- If embedded lyrics are missing, automatically match lyrics by song title and artist across configured online channels; no provider names, links, IDs, or manual paste fields are exposed in the UI.
- Fullscreen lyrics are opened by clicking the album/record cover in the bottom player.
- LRC parsing supports offset tags, multiple timestamps on one line, millisecond precision, and same-timestamp original/translation grouping so auto-scroll targets the correct playback line.
- Set a temporary sleep timer directly from the bottom player; it is session-only and does not persist as an app setting.

### Personalize the interface

- Language: Simplified Chinese and English. The app name is shown as **百灵** in Chinese and **Lark** in English.
- Themes follow the supplied player schemes: five dark themes (Deep Space Noir, Amber Film, Neon Coral, Arctic Aurora, Carbon Volt) plus five light themes (Milk Porcelain, Oat Latte, Mint Soda, Sakura Washi, Dusk Amber).
- Theme selection lives in Settings to keep the main player clean.
- Each theme remaps the player colors, cover treatment, progress/volume styling, and motion language to match its scheme.
- Adaptive layout supports desktop, tablet, and mobile use, with a desktop sidebar, tablet icon rail, and mobile bottom navigation.

---

## Technical overview

### Stack

- Backend: Go, Echo v5, Ent ORM
- Database: SQLite by default via `github.com/lib-x/entsqlite`; PostgreSQL and MySQL can be selected by environment variables
- Frontend: React, TypeScript, Vite
- Audio metadata: `github.com/dhowden/tag`
- Optional media tools: `ffprobe` for metadata and `ffmpeg` for fallback stream transcoding
- Frontend serving: built assets embedded into the Go server with `go:embed`
- Automation: GitHub Actions for CI, release binaries, and Docker image publishing

### Audio strategy

Lark intentionally keeps the default build CGO-free:

- `/api/songs/:id/stream?mode=raw` serves the original file via `http.ServeFile`, preserving Range requests.
- The frontend uses `mode=auto` so browser-compatible formats stream directly.
- Browser-incompatible formats can be transcoded on demand by the optional `ffmpeg` binary.
- `go-astiav`/FFmpeg bindings are not part of the default build because they require CGO and system `libav*` development packages, which would complicate multi-platform binary releases.

---

## Local development

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

```bash
docker compose up -d
```

For unattended first-run setup, pass the initial admin variables before the first start:

```bash
LARK_ADMIN_USERNAME=admin \
LARK_ADMIN_PASSWORD='change-me-now' \
LARK_ADMIN_NICKNAME='Lark Admin' \
docker compose up -d
```

The default compose file stores app data and uploaded music in the `lark_data` volume. If your runtime already exposes a music directory inside the container, set `LARK_LIBRARY_DIR` to that in-container path; otherwise leave it as `/app/data/music` and use uploads/scans within the app data volume. The published Docker image already includes `ffmpeg`/`ffprobe`; no extra compose environment is required for the default transcoding and metadata probe paths. Recursive scans skip the platform bookkeeping directory named `.shared-center`, then continue scanning sibling directories while keeping the configured library root unchanged.

```bash
LARK_LIBRARY_DIR=/lzcapp/run/mnt/home docker compose up -d
```

SQLite is used by default. To place the SQLite database somewhere else, set `LARK_DB_DSN`:

```bash
LARK_DB_TYPE=sqlite \
LARK_DB_DSN='file:/app/data/lark.db?cache=shared&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(10000)&_pragma=cache_size(-10000)&_pragma=temp_store(FILE)&_pragma=mmap_size(0)' \
docker compose up -d
```

For SQLite, a plain path such as `LARK_DB_DSN=/app/data/lark.db` is also accepted; Lark will expand it to the tuned SQLite `file:` DSN above.

To use another database, set both `LARK_DB_TYPE` and `LARK_DB_DSN`:

```bash
LARK_DB_TYPE=postgres \
LARK_DB_DSN='postgres://lark:secret@postgres:5432/lark?sslmode=disable' \
docker compose up -d

LARK_DB_TYPE=mysql \
LARK_DB_DSN='lark:secret@tcp(mysql:3306)/lark?parseTime=true&charset=utf8mb4&loc=Local' \
docker compose up -d
```

### Cache backend

By default Lark uses the built-in Badger KV cache under `LARK_CACHE_DIR`; no external service is required. Badger memory is auto-sized from physical memory, and `LARK_BADGER_CACHE_MB` is only an advanced override for constrained or unusually large deployments. Redis is only used when you explicitly configure Redis-related environment variables or set `LARK_CACHE_BACKEND=redis`.

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

- `.github/workflows/ci.yml` — installs frontend dependencies, runs frontend lint/build, syncs embedded assets, verifies Go modules, runs `go test` and `go vet`, builds the backend server, and verifies the Docker image build.
- `.github/workflows/binary.yml` — creates release draft assets for Linux, macOS, and Windows when a `v*` tag is pushed; also supports manual artifact builds.
- `.github/workflows/docker.yml` — publishes multi-architecture Docker images to GHCR and, when Docker Hub secrets are configured, Docker Hub.

Required secrets for Docker Hub publishing:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

GHCR publishing uses the repository `GITHUB_TOKEN`.
