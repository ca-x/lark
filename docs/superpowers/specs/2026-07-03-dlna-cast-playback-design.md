# DLNA Playback And Library Design

## Goal

Add DLNA support to Lark in two complementary ways:

- Play to another device: the user keeps browsing and controlling playback from Lark, chooses a DLNA-capable renderer from the player UI, and has the current song or queue play on that remote device.
- DLNA library: external DLNA clients can discover Lark on the LAN as a MediaServer and browse/play the Lark music library directly.

The Lark frontend only exposes the first user workflow: playing to another device. The DLNA library is a backend/protocol capability for TVs, speakers, receivers, and third-party DLNA clients, not a new library-browsing surface inside Lark.

## Reference Findings

The Stash reference implementation in `/tmp/stashapp-stash/internal/dlna` is useful for the protocol shape:

- `service.go` owns lifecycle, interface selection, server name, port, and running status.
- `dms.go` implements the UPnP HTTP server, SSDP announcements, device description, SOAP control routing, media resource handler, icons, and DLNA headers.
- `cds.go` implements ContentDirectory browsing and DIDL-Lite item metadata.
- `cms.go` implements ConnectionManager protocol information.
- `whitelist.go` tracks allowed and recent client IPs.

Lark needs an audio-focused adaptation. The important parts to borrow are SSDP/UPnP service structure, device description generation, ContentDirectory browsing, ConnectionManager responses, DIDL-Lite generation, range-friendly resource serving, and DLNA response headers. Stash's scene/video repository model should not be copied directly.

## Scope

In scope:

- A backend DLNA MediaServer that advertises Lark and exposes a browsable music library.
- ContentDirectory containers for all songs, albums, artists, playlists, and folders.
- A backend DLNA casting subsystem that can discover MediaRenderer devices.
- A backend media endpoint that exposes selected songs to DLNA devices without requiring browser cookies.
- A backend controller that can send `SetAVTransportURI`, `Play`, `Pause`, and `Stop` to a selected device.
- Frontend player entry points for selecting an output device and starting/stopping remote playback.
- Basic queue handoff: next/previous from Lark sends the next selected song to the same remote device.
- Admin/user settings needed to enable the feature and surface status.

Out of scope for the first implementation:

- A DLNA library browser inside the Lark Web frontend.
- Remote volume control.
- Reliable remote progress tracking on every renderer.
- Multi-room or simultaneous playback.
- Chromecast, AirPlay, Bluetooth, or vendor-specific casting protocols.

## Product Model

The Lark frontend model is "playback output", not "DLNA".

Output targets:

- `This device`: the current browser player.
- `DLNA device`: a discovered MediaRenderer such as a TV, speaker, set-top box, or receiver.

When the user chooses a DLNA target, Lark pauses local audio and becomes the remote controller for the selected target. The current queue stays in Lark. The remote device receives one playable URL and metadata item at a time.

Separately, external DLNA clients see Lark as a MediaServer. They can browse Lark's library from their own UI. This does not add a second music-browsing experience to the Lark frontend.

## Frontend Interaction

The normal player UI only exposes casting: choosing where the current Lark playback should go. It does not expose a DLNA library browser.

### Entry

Add a Cast icon button to the player controls.

Desktop placement:

- Near volume and playback-mode controls, where users already expect output-related controls.
- The button label or tooltip is `Play to device`.

Mobile placement:

- In the mobile player tool row.
- Tapping opens a bottom sheet.

Button states:

- Local: `Play to device`.
- Discovering: `Searching...`.
- Connecting: `Connecting...`.
- Remote active: show the selected device name, for example `Living Room TV`.
- Failed: retain the cast button and show the recoverable error inside the device panel.

### Device Panel

Title: `Play to device`.

Rows:

- `This device`, always first.
- Available DLNA devices.
- Recently used devices, shown disabled if currently unavailable.

Each DLNA row includes:

- Device name.
- Protocol label `DLNA`.
- Availability state: `Available`, `Connecting`, `Playing`, or `Unavailable`.
- Selection indicator or loading indicator on the right.

Top-right action:

- `Refresh`, which triggers active discovery without exposing SSDP details.

Empty state:

- `No devices found`.
- Secondary text: `Make sure the device is powered on and connected to the same network.`
- Action: `Refresh`.

### Remote Playback State

When connected, the player surface displays:

`Playing on <device name>`

Available actions:

- Play and pause control the remote device.
- Next and previous use Lark's queue and send the chosen song to the same device.
- Stop casting stops the remote device and returns to local output.
- Switch to this device attempts to resume locally from the last known position. If the renderer does not report progress, Lark resumes from the current local queue item at the best known position.

### Failure Recovery

Failures are displayed in the device panel and may also trigger a short toast.

Recoverable states:

- No devices found: show `Refresh`.
- Device connection timed out: show `Retry` and `This device`.
- Device rejected playback: show `Retry` and `This device`.
- Format unsupported: backend retries once with a transcoded MP3 URL, then shows `This device` if that fails.

### Settings Entry

Add a site-settings section near Sharing and Subsonic.

Controls:

- `Play to DLNA devices`: enables renderer discovery and the player cast button behavior.
- `Expose Lark as a DLNA library`: lets TVs, receivers, speakers, and third-party DLNA clients discover Lark as a LAN media source.
- `DLNA library name`: display name used by external DLNA clients when library exposure is enabled.
- `Media base URL`: optional advanced field for the URL sent to DLNA devices when automatic LAN address detection is wrong.
- `Allowed client IPs`: optional advanced allowlist for devices that may browse or fetch DLNA media.

`Expose Lark as a DLNA library` should default off for existing installs because it publishes library metadata to LAN devices. Turning it on starts SSDP MediaServer announcements. Turning it off stops announcements and rejects ContentDirectory browse requests, while `Play to DLNA devices` can still remain enabled.

## Backend Architecture

Add `backend/internal/dlna`.

### Service

`Service` owns lifecycle and shared state:

- Starts and stops MediaServer advertisement, ContentDirectory handlers, discovery, and controller support with the main server.
- Maintains discovered device cache with last-seen timestamps.
- Maintains the currently selected renderer per authenticated user or session.
- Issues and validates short-lived media tokens.
- Exposes methods used by API handlers.

The service should support ordered shutdown from `cmd/server/main.go` and must not leave SSDP announcement loops, discovery timers, UDP sockets, HTTP callbacks, or controller goroutines running after server shutdown.

### MediaServer

The MediaServer runs on the existing backend HTTP server and advertises a UPnP root device through SSDP. It does not need a separate TCP port in the first version.

MediaServer responsibilities:

- Serve the root device description XML.
- Serve SCPD XML for `ContentDirectory`, `ConnectionManager`, and a minimal `X_MS_MediaReceiverRegistrar` compatibility service.
- Handle SOAP control requests for ContentDirectory and ConnectionManager.
- Announce `urn:schemas-upnp-org:device:MediaServer:1` and related services over SSDP.
- Serve album art and audio resources with DLNA-friendly headers.

ContentDirectory root containers:

- `All Songs`
- `Albums`
- `Artists`
- `Playlists`
- `Folders`

ContentDirectory rules:

- Use stable object IDs, for example `song:<id>`, `album:<id>`, `artist:<id>`, `playlist:<id>`, `folder:<escaped-path>`, and `songs/page:<n>`.
- Page large song lists to keep browse responses bounded.
- Return `object.item.audioItem.musicTrack` for songs.
- Return `object.container.album.musicAlbum` for albums when supported by the UPnP AV types; otherwise use `object.container.storageFolder`.
- Return `object.container.person.musicArtist` for artists when supported; otherwise use `object.container.storageFolder`.
- Use Lark's existing catalog methods and direct ent queries where catalog methods do not expose the exact paged shape needed by DLNA.
- Expose the server-wide catalog, not user-specific favorites or per-user playback state.

ConnectionManager should advertise audio formats Lark can serve directly or through the fallback transcode path, including MP3, FLAC, WAV, AAC/MP4, OGG/Opus, AIFF, APE, and WMA where available.

### Discovery

Discovery performs SSDP M-SEARCH for MediaRenderer targets:

- `urn:schemas-upnp-org:device:MediaRenderer:1`
- Optionally `ssdp:all` as a fallback for devices with incomplete responses.

For each response, the service fetches the device description XML and extracts:

- Stable device ID or UDN.
- Friendly name.
- Manufacturer and model.
- Service control URLs for `AVTransport` and optionally `RenderingControl`.
- Last seen time.

Discovery should be explicit and cached. The UI's `Refresh` action triggers active discovery, while a background refresh can run at a low interval when `dlna_cast_enabled` is true.

### Controller

Controller operations:

- `PlaySong(ctx, userID, deviceID, songID)`
- `Pause(ctx, userID, deviceID)`
- `Play(ctx, userID, deviceID)`
- `Stop(ctx, userID, deviceID)`

`PlaySong` builds a reachable HTTP URL and DIDL-Lite metadata, then calls:

1. `AVTransport.SetAVTransportURI`
2. `AVTransport.Play`

DIDL-Lite metadata uses the same song item builder as ContentDirectory, with title, artist, album, duration, size, MIME type, bitrate when available, and album art URI when available.

### Media Endpoint

Expose unauthenticated but token-protected DLNA endpoints under the backend HTTP server:

- `GET /dlna/audio/:token/:songID`
- `GET /dlna/cover/:token/:songID`
- `GET /dlna/transcode/:token/:songID`

The token binds:

- Song ID.
- Issuing user ID or casting session ID.
- Expiry timestamp.
- Purpose: audio, cover, or transcode.

The endpoint must support:

- HTTP range requests.
- `Accept-Ranges: bytes`.
- `transferMode.dlna.org: Streaming`.
- `contentFeatures.dlna.org` with range support.
- Correct content type.
- Cache headers that are useful for devices but do not make long-lived tokens permanent.

Raw playback is preferred when the file is likely compatible. If the target rejects playback or the configured policy requires compatibility mode, the controller sends a transcoded MP3 URL using the existing ffmpeg transcode path.

ContentDirectory browse responses also use tokenized media URLs. Those tokens can have a longer but still bounded lifetime than cast-control tokens so DLNA clients can browse and then start playback without immediately expiring the resource URL.

### API

Add authenticated API routes:

- `GET /api/dlna/status`
- `GET /api/dlna/devices`
- `POST /api/dlna/discover`
- `POST /api/dlna/play`
- `POST /api/dlna/pause`
- `POST /api/dlna/resume`
- `POST /api/dlna/stop`
- `POST /api/dlna/local`

Representative request for play:

```json
{
  "device_id": "uuid:device",
  "song_id": 123
}
```

Representative status:

```json
{
  "cast_enabled": true,
  "library_enabled": false,
  "output": "dlna",
  "device_id": "uuid:device",
  "device_name": "Living Room TV",
  "state": "playing"
}
```

These API routes are for Lark's own frontend cast controls. They are separate from the UPnP/SOAP routes used by DLNA clients.

### Settings

Add settings fields:

- `dlna_cast_enabled`
- `dlna_library_enabled`, default false for existing installs.
- `dlna_server_name`
- `dlna_media_base_url`, optional override for the URL sent to renderers when auto-detecting the backend LAN address is not reliable.
- `dlna_allowed_ips`, optional LAN allowlist for browsing and media endpoints. A wildcard is convenient but should be explicit.
- `dlna_interfaces`, optional interface names for SSDP announcements and discovery.

The settings UI can place this near the existing Sharing and Subsonic service settings. The player cast button can still be visible when disabled, but selecting it should point the user to enable DLNA if they have permission.

`dlna_cast_enabled` controls renderer discovery and remote playback control. `dlna_library_enabled` controls whether Lark announces and serves itself as a browsable DLNA MediaServer. The two settings are independent so users can cast to devices without publishing the library, or publish the library without using Lark's player-side cast controls.

The first implementation does not need a separate DLNA HTTP port because Lark can serve UPnP descriptions, SOAP handlers, covers, and audio resources from the existing backend HTTP server.

## Data Flow

### Discover Devices

1. User opens the device panel.
2. Frontend calls `GET /api/dlna/devices`.
3. If list is empty or stale, frontend offers `Refresh`.
4. User taps `Refresh`.
5. Frontend calls `POST /api/dlna/discover`.
6. Backend runs SSDP discovery, fetches device descriptions, updates cache, and returns devices.

### Play To Device

1. User selects a device.
2. Frontend calls `POST /api/dlna/play` with current song ID.
3. Backend loads song metadata from `library.Service`.
4. Backend issues short-lived audio and cover tokens.
5. Backend builds DIDL-Lite metadata and sends it to the renderer.
6. Backend calls `Play`.
7. Frontend pauses local audio and marks remote output active.

### Browse From External DLNA Client

1. Lark announces itself as a DLNA MediaServer.
2. A TV, receiver, speaker, or third-party DLNA client opens Lark from its own media-source UI.
3. The client calls `ContentDirectory.Browse` on root object `0`.
4. Backend returns `All Songs`, `Albums`, `Artists`, `Playlists`, and `Folders`.
5. The client browses containers and receives DIDL-Lite song items with tokenized audio and cover URLs.
6. The client requests the audio resource URL.
7. Backend validates the token and allowed client IP, then serves raw audio or the fallback transcode stream with range and DLNA headers.

This flow only runs when `dlna_library_enabled` is true.

### Next Song

1. User presses next in Lark.
2. Frontend resolves the next song from the existing queue state.
3. Frontend calls `POST /api/dlna/play` with the same device ID and next song ID.
4. Backend repeats URI and metadata handoff.

## Error Handling

- Discovery failures return an empty list plus an error message only when the discovery request itself failed.
- Device description fetch failures do not fail the whole discovery run.
- ContentDirectory browse failures return UPnP errors with a valid SOAP fault, not JSON.
- SOAP errors are mapped to user-facing states: timeout, rejected playback, unavailable, or unsupported.
- Media token errors return 403 and are logged at debug level, not exposed as internal details.
- If the selected device disappears, Lark keeps the local queue and offers `This device` and `Refresh`.

## Security

- DLNA devices cannot use the normal authenticated `/api/songs/:id/stream` route because they do not carry browser cookies.
- DLNA media URLs must be scoped and short-lived.
- Tokens must not grant library-wide access.
- DLNA library browsing exposes metadata to LAN clients, so it must be gated by the explicit `dlna_library_enabled` setting and the allowed IP policy.
- The first version should avoid an implicit wildcard permanent IP whitelist. If wildcard access is supported, it should be an explicit setting.
- Log device IPs and SOAP errors without logging media tokens.

## Accessibility

- The cast button has an aria label and visible focus ring.
- The device panel supports keyboard navigation, Escape to close, and Enter/Space to select.
- Loading and error states use text, not color alone.
- Touch targets are at least 44 px on mobile.

## Verification

Backend:

- Unit test DIDL-Lite metadata generation for title, artist, album, MIME type, duration, resource URL, and cover URL.
- Unit test ContentDirectory browse results for root, all songs, album songs, artist songs, playlists, and folders.
- Unit test UPnP root device description and service descriptor XML routes.
- Unit test ConnectionManager protocol info.
- Unit test token creation, expiry, purpose checks, and song binding.
- Unit test device description parsing with sample XML.
- Use `httptest` to verify SOAP request bodies for `SetAVTransportURI`, `Play`, `Pause`, and `Stop`.
- Test media endpoint range behavior.

Frontend:

- Test API client functions for device listing and playback actions.
- Test device panel empty, loading, available, active, and error states.
- Test switching back to local output.

Manual:

- Verify with at least one DLNA renderer on the LAN.
- Verify Lark appears as a DLNA media source in a DLNA client and can browse/play songs.
- Verify no device found state on a network with no renderers.
- Verify raw MP3 playback and fallback MP3 transcode for a non-MP3 source.
- Verify mobile bottom sheet and desktop panel do not overlap player controls.

## First Implementation Slice

Build the feature in this order:

1. Shared DLNA metadata, token, resource URL, and media endpoint foundation.
2. Backend MediaServer device description, SSDP announcements, ContentDirectory, and ConnectionManager.
3. Backend renderer discovery and device-description parsing.
4. SOAP controller for play, pause, resume, and stop.
5. Authenticated API routes for the Lark cast controls.
6. Frontend API client and cast state.
7. Player cast button and device panel.
8. Settings entry and error polish.

This sequence keeps the DLNA protocol surface testable before the frontend depends on it, and lets the library-browsing and cast-control paths share the same media resource implementation.
