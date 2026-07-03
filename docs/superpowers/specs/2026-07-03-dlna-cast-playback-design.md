# DLNA Cast Playback Design

## Goal

Add "play to another device" support to Lark. The user should keep browsing and controlling playback from Lark, choose a DLNA-capable device from the player UI, and have the current song or queue play on that remote device.

This is not primarily a DLNA library-browsing feature. Lark remains the control surface. DLNA is the transport used to discover renderers, provide a playable media URL, send metadata, and control playback.

## Reference Findings

The Stash reference implementation in `/tmp/stashapp-stash/internal/dlna` is useful for the protocol shape:

- `service.go` owns lifecycle, interface selection, server name, port, and running status.
- `dms.go` implements the UPnP HTTP server, SSDP announcements, device description, SOAP control routing, media resource handler, icons, and DLNA headers.
- `cds.go` implements ContentDirectory browsing and DIDL-Lite item metadata.
- `cms.go` implements ConnectionManager protocol information.
- `whitelist.go` tracks allowed and recent client IPs.

Lark needs a narrower audio-focused adaptation. The important parts to borrow are SSDP/UPnP service structure, DIDL-Lite generation, range-friendly resource serving, and DLNA response headers. Stash's scene/video repository model and full library browsing hierarchy should not be copied directly.

## Scope

In scope:

- A backend DLNA casting subsystem that can discover MediaRenderer devices.
- A backend media endpoint that exposes selected songs to DLNA devices without requiring browser cookies.
- A backend controller that can send `SetAVTransportURI`, `Play`, `Pause`, and `Stop` to a selected device.
- Frontend player entry points for selecting an output device and starting/stopping remote playback.
- Basic queue handoff: next/previous from Lark sends the next selected song to the same remote device.
- Admin/user settings needed to enable the feature and surface status.

Out of scope for the first implementation:

- Browsing the full Lark library from a TV's built-in DLNA browser.
- Remote volume control.
- Reliable remote progress tracking on every renderer.
- Multi-room or simultaneous playback.
- Chromecast, AirPlay, Bluetooth, or vendor-specific casting protocols.

## Product Model

The user-facing model is "playback output", not "DLNA".

Output targets:

- `This device`: the current browser player.
- `DLNA device`: a discovered MediaRenderer such as a TV, speaker, set-top box, or receiver.

When the user chooses a DLNA target, Lark pauses local audio and becomes the remote controller for the selected target. The current queue stays in Lark. The remote device receives one playable URL and metadata item at a time.

## Frontend Interaction

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

## Backend Architecture

Add `backend/internal/dlna`.

### Service

`Service` owns lifecycle and shared state:

- Starts and stops discovery/controller support with the main server.
- Maintains discovered device cache with last-seen timestamps.
- Maintains the currently selected renderer per authenticated user or session.
- Issues and validates short-lived media tokens.
- Exposes methods used by API handlers.

The service should support ordered shutdown from `cmd/server/main.go` and must not leave discovery timers, UDP sockets, or controller goroutines running after server shutdown.

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

Discovery should be explicit and cached. The UI's `Refresh` action triggers active discovery, while a background refresh can run at a low interval when DLNA is enabled.

### Controller

Controller operations:

- `PlaySong(ctx, userID, deviceID, songID)`
- `Pause(ctx, userID, deviceID)`
- `Play(ctx, userID, deviceID)`
- `Stop(ctx, userID, deviceID)`

`PlaySong` builds a reachable HTTP URL and DIDL-Lite metadata, then calls:

1. `AVTransport.SetAVTransportURI`
2. `AVTransport.Play`

DIDL-Lite metadata uses an `object.item.audioItem.musicTrack` item with title, artist, album, duration, size, MIME type, bitrate when available, and album art URI when available.

### Media Endpoint

Expose unauthenticated but token-protected DLNA endpoints under the backend HTTP server:

- `GET /dlna/audio/:token/:songID`
- `GET /dlna/cover/:token/:songID`

The token binds:

- Song ID.
- Issuing user ID or casting session ID.
- Expiry timestamp.
- Purpose: audio or cover.

The endpoint must support:

- HTTP range requests.
- `Accept-Ranges: bytes`.
- `transferMode.dlna.org: Streaming`.
- `contentFeatures.dlna.org` with range support.
- Correct content type.
- Cache headers that are useful for devices but do not make long-lived tokens permanent.

Raw playback is preferred when the file is likely compatible. If the target rejects playback or the configured policy requires compatibility mode, the controller sends a transcoded MP3 URL using the existing ffmpeg transcode path.

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
  "enabled": true,
  "output": "dlna",
  "device_id": "uuid:device",
  "device_name": "Living Room TV",
  "state": "playing"
}
```

### Settings

Add settings fields:

- `dlna_enabled`
- `dlna_media_base_url`, optional override for the URL sent to renderers when auto-detecting the backend LAN address is not reliable.

The settings UI can place this near the existing Sharing and Subsonic service settings. The player cast button can still be visible when disabled, but selecting it should point the user to enable DLNA if they have permission.

The first implementation does not need a separate DLNA HTTP port or a user-visible DLNA server name because Lark is not exposing a browsable MediaServer library. Renderers receive direct, token-protected media URLs from the existing backend HTTP server.

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

### Next Song

1. User presses next in Lark.
2. Frontend resolves the next song from the existing queue state.
3. Frontend calls `POST /api/dlna/play` with the same device ID and next song ID.
4. Backend repeats URI and metadata handoff.

## Error Handling

- Discovery failures return an empty list plus an error message only when the discovery request itself failed.
- Device description fetch failures do not fail the whole discovery run.
- SOAP errors are mapped to user-facing states: timeout, rejected playback, unavailable, or unsupported.
- Media token errors return 403 and are logged at debug level, not exposed as internal details.
- If the selected device disappears, Lark keeps the local queue and offers `This device` and `Refresh`.

## Security

- DLNA devices cannot use the normal authenticated `/api/songs/:id/stream` route because they do not carry browser cookies.
- DLNA media URLs must be scoped and short-lived.
- Tokens must not grant library-wide access.
- The first version should avoid a wildcard permanent IP whitelist. Network-level restrictions can be added after the token-protected path is working.
- Log device IPs and SOAP errors without logging media tokens.

## Accessibility

- The cast button has an aria label and visible focus ring.
- The device panel supports keyboard navigation, Escape to close, and Enter/Space to select.
- Loading and error states use text, not color alone.
- Touch targets are at least 44 px on mobile.

## Verification

Backend:

- Unit test DIDL-Lite metadata generation for title, artist, album, MIME type, duration, resource URL, and cover URL.
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
- Verify no device found state on a network with no renderers.
- Verify raw MP3 playback and fallback MP3 transcode for a non-MP3 source.
- Verify mobile bottom sheet and desktop panel do not overlap player controls.

## First Implementation Slice

Build the feature in this order:

1. Backend device discovery and parsing.
2. Token-protected audio and cover endpoints.
3. SOAP controller for play, pause, resume, and stop.
4. Authenticated API routes.
5. Frontend API client and cast state.
6. Player cast button and device panel.
7. Settings entry and error polish.

This sequence keeps the protocol work testable before the UI depends on it.
