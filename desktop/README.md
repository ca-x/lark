# Lark Music Desktop

Lark Music is a separate MyGo application for macOS, Windows, and Linux.
It connects to the Lark server with the versioned Protobuf protocol in
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

The client automatically negotiates Connect, gRPC-Web, or native gRPC. The
server and desktop exchange typed Protobuf messages. Audio and covers
are sent in bounded streaming chunks; the local MyGo media protocol exposes them
to the WebView. Byte ranges are forwarded so seeking works without
downloading a whole song. The desktop UI does not receive the session token.

For seekable MP3, WAV, and Ogg sources, MyGo's native audio engine decodes
and plays the range stream over the negotiated transport. FLAC, CUE, and sources without byte-range
support stay on the WebView playback path, preserving the existing format
fallback. Album hover and connection motion respect reduced-motion settings.

The optional `8bitMyGoUI` native pixel mode is not included in this release:
its API integration is not part of the MyGo v0.6.2 upgrade.
The normal UI still offers the existing vinyl and
cassette themes.

## Connect

Use the address of an updated Lark server, for example
`https://music.example.com`. All desktop protocols use the same host and port as the web
app. Remote connections require HTTPS. To connect to a local or private
network server over plain HTTP, enter its `http://` URL and explicitly check
the local HTTP option on the first screen.

Automatic negotiation works with ordinary HTTP/1.1 reverse proxies, including
Cloudflare Tunnel public hostnames. It probes server information without credentials,
then signs in once. Settings show the selected transport. Restored sessions prefer
their last working transport, and connection checks renegotiate after a transport
failure. Authentication, TLS and protocol-version errors do not trigger credential
retries, and HTTPS never falls back to HTTP.

For a direct proxy that also supports native gRPC, Caddy can use an h2c upstream:

```caddyfile
music.example.com {
    reverse_proxy h2c://127.0.0.1:8080
}
```

Cloudflare Tunnel public hostnames do not support native gRPC, but the automatic
HTTP-compatible transport needs neither WARP nor a separate port. WARP private
network routing remains an option for native gRPC. Interactive Cloudflare Access
browser challenges are not supported. See the [connection guide](../docs/desktop-cloudflare-tunnel.md)
and the [Docker, ports, Caddy and Nginx guide](../docs/client-deployment.md).

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

Requirements: Go 1.27.1+, MyGo 0.6.2 (pinned in `go.mod`), Node.js 22.13+ (24 recommended), and pnpm 11+. Linux WebView builds
need WebKitGTK 4.1 at runtime; the tray needs Ayatana AppIndicator.

```sh
pnpm --dir frontend install --frozen-lockfile
pnpm --dir desktop/ui install --frozen-lockfile
cd desktop
go tool mygo generate
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
