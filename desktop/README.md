# Lark Music Desktop

Lark Music is a separate MyGo application for macOS, Windows, and Linux.
It connects to the Lark server with the versioned Protobuf/gRPC protocol in
[`../protocol`](../protocol). The desktop UI lives in [`ui`](ui); the web app
keeps its own build and API.

## What the first desktop release includes

- First connection with server URL, username, and password; later launches
  reuse a 30-day server session.
- Songs, search, artists, albums, favorites, lyrics, playback progress,
  queue, volume, and the existing vinyl and cassette player components.
- Native MyGo window, tray menu, localized app name (Lark Music / 百灵音乐),
  URL scheme, and platform packages.
- A setting for closing to the tray or quitting. If a Linux desktop has no
  tray service, closing exits so the window cannot become unreachable.

The server and desktop exchange typed Protobuf messages. Audio and covers
are sent in bounded gRPC chunks; the local MyGo media protocol exposes them
to the WebView. Byte ranges are forwarded so seeking works without
downloading a whole song. The desktop UI does not receive the session token.

For seekable MP3, WAV, and Ogg sources, MyGo's native audio engine decodes
and plays the gRPC range stream. FLAC, CUE, and sources without byte-range
support stay on the WebView playback path, preserving the existing format
fallback. Album hover and connection motion respect reduced-motion settings.

The optional `8bitMyGoUI` native pixel mode is not included in this release:
its current API targets MyGo v0.2.10 and does not compile with the v0.5.1
native UI API used here. The normal UI still offers the existing vinyl and
cassette themes.

## Connect

Use the address of an updated Lark server, for example
`https://music.example.com`. gRPC uses the same host and port as the web
app. Remote connections require HTTPS. To connect to a local or private
network server over plain HTTP, enter its `http://` URL and explicitly check
the local HTTP option on the first screen.

The server must allow HTTP/2 gRPC requests through its reverse proxy. With
Caddy, an h2c upstream for the Lark server can serve both the web and gRPC
on one public HTTPS address:

```caddyfile
music.example.com {
    reverse_proxy h2c://127.0.0.1:8080
}
```

Cloudflare Tunnel public hostnames currently do not support gRPC. For a
Cloudflare connection, use private network routing with Cloudflare One/WARP;
see [the connection guide](../docs/desktop-cloudflare-tunnel.md).

The desktop saves `config.json` and `auth.json` under MyGo's per-user
`PathUserData` directory. On Unix they have mode `0600`, and the directory
has mode `0700`. The password is never written there. Signing out revokes
the server session and deletes `auth.json`.

## Open from the web

Installed apps register `lark://`. A song or album can be opened with:

```text
lark://song/123?server=https%3A%2F%2Fmusic.example.com
lark://album/45?server=https%3A%2F%2Fmusic.example.com
```

The web share dialog offers this link for songs and albums. An incoming link
waits for login if needed; a link for another server asks for that server's
credentials before opening it.

## Build

Requirements: Go 1.27+, Node.js 22+, and pnpm 11+. Linux WebView builds
need WebKitGTK 4.1 at runtime; the tray needs Ayatana AppIndicator.

```sh
pnpm --dir desktop/ui install --frozen-lockfile
cd desktop
go test ./...
go tool mygo build -platform linux/amd64
```

`go tool mygo build` produces a Linux executable, `.tar.gz`, and `.deb`.
The [desktop workflow](../.github/workflows/desktop.yml) also builds a
macOS universal app and `.dmg`, a Windows `.exe` and installer, and Linux
amd64/arm64 packages. Run it manually or push a `desktop-v*` tag. A tag
creates a draft release and uploads the packages. Code signing and macOS
notarization need project certificates before distributing outside a test
environment.

To edit the wire protocol, change `../protocol/lark/desktop/v1/desktop.proto`
and run `buf lint` and `buf generate` from `../protocol`. Commit the generated
Go code with the schema.
