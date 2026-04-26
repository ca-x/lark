# Lark Music

[中文说明](README_ZH.md)

Lark is a self-hosted web music player for personal high-resolution music libraries. The backend is Go + Echo v5 + Ent ORM + SQLite, and the frontend is React/Vite with an embedded production build served by the Go binary.

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
- Database: SQLite via `github.com/lib-x/entsqlite`
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
| `LARK_DB_PATH` | `./data/lark.db` | SQLite database path |
| `LARK_FRONTEND_ORIGIN` | `*` | CORS origin |
| `LARK_ADMIN_USERNAME` | empty | Create the first admin automatically when the database has no users |
| `LARK_ADMIN_PASSWORD` | empty | Password for `LARK_ADMIN_USERNAME`; must be set together with username |
| `LARK_ADMIN_NICKNAME` | empty | Optional nickname for the auto-created admin |
| `FFMPEG_BIN` | `ffmpeg` | Optional transcoder binary |
| `FFPROBE_BIN` | `ffprobe` | Optional metadata probe binary |

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

The default compose file stores data in the `lark_data` volume. To use an existing music folder, mount it to `/app/data/music` in `docker-compose.yml`.

```yaml
services:
  lark:
    volumes:
      - /path/to/music:/app/data/music:ro
```

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
