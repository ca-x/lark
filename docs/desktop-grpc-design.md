# Lark Music desktop client: first release

## Scope

Build a MyGo desktop app for macOS, Windows, and Linux. Its React UI lives in
the independent `desktop/ui` module. It reuses selected player themes through
shared component imports without changing the existing web build, and uses MyGo
for windows, tray controls, localized app naming, deep links, and packaging. The first release
covers server connection, login, songs, artists, albums, favorites, lyrics,
and local playback. The existing web app and HTTP API remain available.

## Capability map

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `desktop-protocol` | Versioned Protobuf messages and generated clients | — |
| `desktop-server` | Authenticated gRPC methods over the existing library service | `desktop-protocol` |
| `desktop-shell` | MyGo window, saved server, system credentials, media bridge, deep links | `desktop-protocol` |
| `desktop-ui` | Separate Roon-inspired library and album views, familiar desktop playback controls, reusable player themes | `desktop-shell` |
| `desktop-distribution` | macOS DMG, Debian package, Linux archive, Windows executable and installer | `desktop-shell`, `desktop-ui` |

Build order: protocol → server → shell and UI → distribution.

## Connection and authentication

The first screen asks for a server URL, username, and password. The client
normalizes the URL and requires TLS for remote hosts. It calls a versioned
server-info RPC, then a login RPC. The server uses the existing user and
session store. The password is discarded after login. The session token and
server configuration live under MyGo's per-user `PathUserData` directory in
separate `auth.json` and `config.json` files. The directory and files are
created with owner-only permissions; the token is never sent to the WebView.
When the token expires, the app returns to login. Logging out revokes the
session and removes the auth file.

## Protocol and playback

Use `buf` to lint and generate Go from `desktop/v1/desktop.proto`. List and
detail responses use typed Protobuf messages and pagination. The desktop
Go process calls gRPC directly; the WebView calls its local Go bridge. This
keeps the remote transfer binary while preserving a TypeScript UI.

Audio and covers use server-streaming RPCs with bounded chunks. The first
message carries content type, status, total length, and range information;
subsequent messages carry bytes. The MyGo custom protocol exposes those
streams to HTML media elements, forwards byte ranges for seeking, and
cancels remote work when playback changes. The server keeps its current
format selection and transcoding behavior. MyGo's native audio decoder plays
seekable MP3, WAV, and Ogg streams. FLAC, CUE, and non-seekable sources use
the WebView path until a compatible native decoder is available.

## Deep links

Register `lark://` with MyGo and enforce a single instance. Accept only
`lark://song/<positive-id>` and `lark://album/<positive-id>`, optionally with
an encoded `server` URL. Queue an incoming link until login finishes. If the
link names a different server, show the connection screen before opening it.
Web share actions can generate the matching desktop link without changing
the existing HTTPS share URL.

## Delivery and checks

MyGo builds a macOS app/DMG, Linux executable/archive/`.deb`, and Windows
executable/installer. A dedicated desktop tag triggers the build matrix;
the server release workflow keeps using `v*` tags. Check protocol lint and
generation, Go service/client tests, frontend build, a Linux package build,
and deep-link parsing. A packaged app must connect, restart without asking
for a password, browse, play and seek, then sign out cleanly.

## Follow-up parity

The browser's administrative, radio, plugin, metadata-editing, and sharing
surfaces can be added as separate typed RPC groups after the listening flow
is stable. They are excluded from the first desktop UI rather than tunneled
through a generic JSON RPC.
