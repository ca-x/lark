# Mobile Precision Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the existing mobile default `neon-console` experience into the approved Precision Audio direction while preserving desktop playback behavior.

**Architecture:** Keep the stored mobile theme enum stable and use `neon-console` as the compatibility entry point for the new Precision Audio visual system. Touch only mobile React components, mobile CSS, minimal App routing/wiring, labels, and release documentation. Preserve playback, queue, lyrics, equalizer, sleep timer, offline, network, and radio state logic.

**Tech Stack:** React 19, TypeScript, Vite, Phosphor Icons, vanilla CSS in `frontend/src/mobile.css`, Go backend verification through the existing CI commands.

---

## File Map

- Modify `frontend/src/types/app.ts`: include `radio` in the allowed mobile playback views so radio does not bounce back to Home.
- Modify `frontend/src/i18n.ts`: rename the visible default mobile style label to Precision Audio in Chinese and English.
- Modify `README.md` and `README_ZH.md`: update the mobile style list so docs match the visible product label.
- Modify `frontend/src/components/mobile/MobileMiniPlayer.tsx`: make the whole row expandable and replace previous/next with queue.
- Modify `frontend/src/components/mobile/MobileHomeSurface.tsx`: remove duplicate home tabs, strengthen now playing, add radio shortcut, and reduce equal-weight cards.
- Modify `frontend/src/components/mobile/MobileSoundPanel.tsx`: add focus lifecycle, `aria-modal`, and Precision Audio sheet material.
- Modify `frontend/src/components/player-themes/MobileArtPlayer.tsx`: replace the `neon-console` visual branch with a Precision Audio deck that adapts selected PC player ideas.
- Modify `frontend/src/App.tsx`: wire radio shortcut, mini queue action, queue sheet dialog semantics, and mobile labels.
- Modify `frontend/src/mobile.css`: add Precision Audio tokens and style the mobile shell, bottom nav, home, mini player, full-screen player, queue sheet, and sound sheet.

## Task 1: Compatibility Wiring and Labels

**Files:**
- Modify: `frontend/src/types/app.ts`
- Modify: `frontend/src/i18n.ts`
- Modify: `README.md`
- Modify: `README_ZH.md`

- [ ] **Step 1: Allow the radio view on mobile**

Replace the `MOBILE_PLAYBACK_VIEWS` line in `frontend/src/types/app.ts` with:

```ts
export const MOBILE_PLAYBACK_VIEWS = new Set<View>(["home", "favorites", "library", "radio", "playlists", "albums", "artists", "collection", "settings"]);
```

- [ ] **Step 2: Rename the visible default mobile style**

In `frontend/src/i18n.ts`, replace the Chinese and English `mobileHomePlayerNeonConsole` values:

```ts
mobileHomePlayerNeonConsole: "精密音频",
```

```ts
mobileHomePlayerNeonConsole: "Precision Audio",
```

- [ ] **Step 3: Update README mobile style descriptions**

In `README.md`, replace the mobile style sentence with:

```md
- Mobile player styles include Precision Audio, indiewave, music editor, soft vinyl, stage glass, blue halo, and Smartisan classic.
```

In `README_ZH.md`, replace the matching sentence with:

```md
- 移动端播放样式包括精密音频、独立蓝调、音乐编辑器、柔光唱片、舞台玻璃、蓝色光环和锤子经典。
```

- [ ] **Step 4: Verify labels and routing compile**

Run:

```bash
cd frontend
pnpm lint
```

Expected: `pnpm lint` exits with code 0.

- [ ] **Step 5: Commit compatibility wiring**

Run:

```bash
git add frontend/src/types/app.ts frontend/src/i18n.ts README.md README_ZH.md
git commit -m "fix: align mobile precision audio defaults"
```

Expected: a commit is created and `git status --short` does not show these four files.

## Task 2: Mini Player Row Interaction

**Files:**
- Modify: `frontend/src/components/mobile/MobileMiniPlayer.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/mobile.css`

- [ ] **Step 1: Replace mini player transport shape**

In `frontend/src/components/mobile/MobileMiniPlayer.tsx`, update the icon import and component props:

```ts
import { Pause, Play, Queue, Record } from "@phosphor-icons/react";
```

```ts
labels: {
  play: string;
  pause: string;
  expand: string;
  queue: string;
};
onToggle: () => void;
onExpand: () => void;
onQueue?: () => void;
```

Remove the `onPrevious` and `onNext` props from the type block.

- [ ] **Step 2: Replace the mini player JSX**

Replace the current `return` in `MobileMiniPlayer` with:

```tsx
const expandLabel = title ? `${labels.expand}: ${title}` : labels.expand;

return (
  <div className="mobile-mini-player" data-mobile-theme={theme} data-playing={playing ? "true" : "false"} style={style}>
    <button type="button" className="mobile-mini-main" aria-label={expandLabel} onClick={onExpand}>
      <span className="mobile-mini-art" aria-hidden="true">
        {displayCover ? (
          <img src={displayCover} alt="" loading="eager" decoding="async" onError={() => setFailedCover(displayCover)} />
        ) : (
          <Record weight="fill" />
        )}
      </span>
      <span className="mobile-mini-info">
        <span className="mobile-mini-meta">
          <strong>{title}</strong>
          <span>{artist}</span>
        </span>
        <span className="mobile-mini-progress" aria-hidden="true" />
      </span>
    </button>
    <button type="button" className="mobile-mini-play" aria-label={playing ? labels.pause : labels.play} onClick={onToggle}>
      {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
    </button>
    <button type="button" className="mobile-mini-queue" aria-label={labels.queue} disabled={!onQueue} onClick={onQueue}>
      <Queue weight="bold" />
    </button>
  </div>
);
```

- [ ] **Step 3: Wire the mini queue action in App**

In the `MobileMiniPlayer` call in `frontend/src/App.tsx`, replace the labels and props with:

```tsx
labels={{
  play: t("play"),
  pause: t("pause"),
  expand: t("expandPlayer"),
  queue: queuePanelMode === "radio" ? t("onlineRadio") : t("queue"),
}}
onToggle={() => setPlaying((value) => {
  playUISound(value ? "pause" : "play");
  return !value;
})}
onExpand={() => {
  setLyricsFullScreen(false);
  setMobilePlayerExpanded(true);
}}
onQueue={current || currentRadio || currentNetworkTrack ? toggleQueuePanel : undefined}
```

- [ ] **Step 4: Replace mini player mobile CSS**

In `frontend/src/mobile.css`, replace the `.mobile-mini-player` block inside `@media (max-width:720px)` with:

```css
.mobile-mini-player {
  position:relative;
  min-width:0;
  display:grid;
  grid-template-columns:minmax(0,1fr) 48px 44px;
  align-items:center;
  gap:6px;
  color:var(--text);
}
.mobile-mini-player::before {
  content:'';
  position:absolute;
  inset:-4px;
  z-index:0;
  border-radius:24px;
  background:linear-gradient(180deg, color-mix(in srgb, var(--panel) 98%, transparent), color-mix(in srgb, var(--panel2) 72%, transparent));
  box-shadow:var(--mobile-pa-inner, inset 0 1px 0 rgba(255,255,255,.08));
  pointer-events:none;
}
.mobile-mini-player > * {
  position:relative;
  z-index:1;
}
.mobile-mini-main {
  min-width:0;
  min-height:54px;
  display:grid;
  grid-template-columns:48px minmax(0,1fr);
  align-items:center;
  gap:10px;
  padding:0 4px 0 0;
  border:0;
  border-radius:20px;
  color:inherit;
  background:transparent;
  text-align:left;
  touch-action:manipulation;
}
.mobile-mini-main:active {
  transform:scale(.985);
}
.mobile-mini-art {
  position:relative;
  width:48px;
  min-width:48px;
  height:48px;
  min-height:48px;
  display:grid;
  place-items:center;
  border-radius:16px;
  color:var(--mobile-active-text);
  background:var(--mobile-mini-cover, linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 35%, var(--panel2))));
  background-size:cover;
  background-position:center;
  border:1px solid color-mix(in srgb, var(--text) 12%, transparent);
  overflow:hidden;
}
.mobile-mini-player > button:not(.mobile-mini-main) {
  width:44px;
  min-width:44px;
  height:44px;
  min-height:44px;
  display:grid;
  place-items:center;
  padding:0;
  border-radius:999px;
  color:var(--text);
  background:color-mix(in srgb, var(--panel2) 84%, transparent);
  border:1px solid color-mix(in srgb, var(--line) 86%, transparent);
  touch-action:manipulation;
}
.mobile-mini-player .mobile-mini-play {
  width:48px;
  min-width:48px;
  height:48px;
  min-height:48px;
  color:var(--mobile-active-text);
  background:var(--accent);
  border-color:transparent;
  box-shadow:0 12px 22px color-mix(in srgb, var(--accent) 20%, transparent);
}
.mobile-mini-player[data-mobile-theme='neon-console'] .mobile-mini-queue {
  color:var(--accent);
}
```

Keep the existing `.mobile-mini-info`, `.mobile-mini-meta`, `.mobile-mini-progress`, image, active, focus, and theme-specific rules unless a selector still targets removed previous/next buttons. Replace removed selectors with `.mobile-mini-main`, `.mobile-mini-play`, and `.mobile-mini-queue`.

- [ ] **Step 5: Verify mini player compiles**

Run:

```bash
cd frontend
pnpm lint
pnpm build
```

Expected: both commands exit with code 0.

- [ ] **Step 6: Commit mini player interaction**

Run:

```bash
git add frontend/src/components/mobile/MobileMiniPlayer.tsx frontend/src/App.tsx frontend/src/mobile.css
git commit -m "feat: make mobile mini player expandable"
```

Expected: a commit is created and `git status --short` does not show these three files.

## Task 3: Mobile Home Surface Restructure

**Files:**
- Modify: `frontend/src/components/mobile/MobileHomeSurface.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/mobile.css`

- [ ] **Step 1: Add the radio shortcut prop**

In `MobileHomeSurface` props, add:

```ts
onOpenRadio: () => void;
```

Remove these props from `MobileHomeSurface` because the duplicate tab bar is removed:

```ts
onOpenLibrary: () => void;
onOpenFavorites: () => void;
```

- [ ] **Step 2: Remove duplicate home tabs**

Delete this block from `MobileHomeSurface`:

```tsx
{showSurfaceTabs ? (
  <nav className="mobile-home-tabs" aria-label={t("home")}>
    <button type="button" className="active">
      {t("mobileForYou")}
    </button>
    <button type="button" onClick={onOpenLibrary}>
      {t("library")}
    </button>
    <button type="button" onClick={onOpenFavorites}>
      {t("favorites")}
    </button>
    <button type="button" onClick={onOpenPlaylists}>
      {t("playlists")}
    </button>
  </nav>
) : null}
```

Delete the `showSurfaceTabs` constant.

- [ ] **Step 3: Add Radio to the library shortcut grid**

In `MobileHomeSurface`, replace the playlist shortcut entry in `.mobile-home-library-hub` with four shortcuts:

```tsx
<button type="button" onClick={onOpenAlbums}>
  <MobileCollectionCover src={albumCoverUrl(featuredAlbum)} fallback="album" />
  <span>
    <strong>{t("albums")}</strong>
    <small>{stats ? stats.albums : albums.length} {t("album")}</small>
  </span>
</button>
<button type="button" onClick={onOpenArtists}>
  <MobileCollectionCover src={artistCoverUrl(featuredArtist)} fallback="artist" />
  <span>
    <strong>{t("artists")}</strong>
    <small>{stats ? stats.artists : artists.length} {t("artists")}</small>
  </span>
</button>
<button type="button" onClick={onOpenPlaylists}>
  <MobileCollectionCover fallback="playlist" />
  <span>
    <strong>{t("playlists")}</strong>
    <small>{stats ? stats.playlists : playlists.length} {t("playlists")}</small>
  </span>
</button>
<button type="button" onClick={onOpenRadio}>
  <MobileCollectionCover fallback="radio" />
  <span>
    <strong>{t("onlineRadio")}</strong>
    <small>{t("liveRadio")}</small>
  </span>
</button>
```

Extend `MobileCollectionCover` fallback type:

```ts
fallback: "album" | "artist" | "playlist" | "radio";
```

Use the existing `MusicNotes` icon for `radio` by importing it and changing the fallback render:

```tsx
{fallback === "artist" ? <MicrophoneStage weight="fill" /> : fallback === "playlist" ? <PlaylistIcon weight="fill" /> : fallback === "radio" ? <MusicNotes weight="fill" /> : <Disc weight="fill" />}
```

- [ ] **Step 4: Wire radio shortcut from HomeView**

In `HomeView` props in `frontend/src/App.tsx`, add:

```ts
onOpenRadio: () => void;
```

Pass it into `MobileHomeSurface`:

```tsx
onOpenRadio={onOpenRadio}
```

In the `HomeView` call, add:

```tsx
onOpenRadio={() => {
  setView("radio");
  if (!radioStations.length) void loadRadioStations();
}}
```

Remove `onOpenLibrary` and `onOpenFavorites` from the `MobileHomeSurface` call, but keep them on `HomeView` while desktop content still receives those callbacks.

- [ ] **Step 5: Update home layout CSS**

In `frontend/src/mobile.css`, change the library hub grid to four compact shortcuts:

```css
.mobile-home-library-hub {
  display:grid;
  grid-template-columns:repeat(4, minmax(0, 1fr));
  gap:8px;
}
.mobile-home-library-hub button {
  min-height:102px;
  padding:9px 7px;
  align-content:start;
  justify-items:center;
  text-align:center;
}
.mobile-home-library-hub span {
  justify-items:center;
}
.mobile-home-library-hub strong,
.mobile-home-library-hub small {
  max-width:100%;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
```

Remove mobile `.mobile-home-tabs` visual rules that only supported the deleted duplicate tabs, except theme-specific Smartisan rules that also style other components.

- [ ] **Step 6: Verify home restructuring**

Run:

```bash
cd frontend
pnpm lint
pnpm build
```

Expected: both commands exit with code 0.

- [ ] **Step 7: Commit home surface restructure**

Run:

```bash
git add frontend/src/components/mobile/MobileHomeSurface.tsx frontend/src/App.tsx frontend/src/mobile.css
git commit -m "feat: simplify mobile home surface"
```

Expected: a commit is created and `git status --short` does not show these files.

## Task 4: Precision Audio Full-Screen Player

**Files:**
- Modify: `frontend/src/components/player-themes/MobileArtPlayer.tsx`
- Modify: `frontend/src/mobile.css`

- [ ] **Step 1: Add Precision Audio state variables**

In `MobileArtPlayer`, after `smartisanNeedleAngle`, add:

```ts
const precisionTonearmAngle = 15 + pct * 24;
```

In the `style` object, add:

```ts
"--mobile-pa-tonearm": `${precisionTonearmAngle.toFixed(2)}deg`,
```

- [ ] **Step 2: Replace the neon visual branch**

Replace the `variant === "neon-console"` branch with:

```tsx
{variant === "neon-console" ? (
  <PrecisionAudioVisual cover={coverState.displayUrl} playing={playing} onCoverError={coverState.onCoverError} />
) : variant === "indiewave" ? (
```

- [ ] **Step 3: Add the Precision Audio visual component**

Add this component below `VolumeTicks`:

```tsx
function PrecisionAudioVisual({ cover, playing, onCoverError }: CoverVisualProps & { playing: boolean }) {
  return (
    <div className="mobile-pa-visual">
      <div className="mobile-pa-art-stack">
        <span className="mobile-pa-vinyl" aria-hidden="true"><i /></span>
        <div className="mobile-pa-cover" data-has-cover={cover ? "true" : "false"}>
          {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : <MusicNotes weight="fill" />}
        </div>
      </div>
      <div className="mobile-pa-tonearm" aria-hidden="true">
        <span />
        <i />
      </div>
      <div className="mobile-pa-status" aria-hidden="true">
        <span className={playing ? "mobile-pa-led on" : "mobile-pa-led"} />
        <strong>33</strong>
        <em>RPM</em>
        <div className="mobile-pa-vu">
          {Array.from({ length: 8 }, (_, index) => <i key={index} style={{ "--vu-index": index } as CSSProperties} />)}
        </div>
      </div>
    </div>
  );
}
```

Keep `NeonConsoleVisual` in the file until the CSS migration is complete, then remove it if no references remain.

- [ ] **Step 4: Add Precision Audio CSS**

In `frontend/src/mobile.css`, replace the `neon-console` token block under `.app-shell[data-mobile-theme='neon-console']` with:

```css
.app-shell[data-mobile-theme='neon-console'] {
  color-scheme:dark;
  --bg:#0B0D10;
  --panel:#12161B;
  --panel2:#1A2027;
  --text:#F2EEE6;
  --muted:#AFA79B;
  --accent:#D6B36A;
  --accent2:#D95B55;
  --line:rgba(242,238,230,.10);
  --highlight:#f3d88b;
  --hero:radial-gradient(circle at 50% -18%, rgba(214,179,106,.18), transparent 36%), linear-gradient(180deg, #12161B 0%, #0B0D10 82%);
  --mobile-active-text:#0B0D10;
  --mobile-pa-inner:inset 0 1px 0 rgba(255,255,255,.08);
}
```

Add these rules near the current mobile art visual rules:

```css
.mobile-art-neon-console {
  --mobile-art-phone-bg:#0B0D10;
  --mobile-art-phone-bg-2:#12161B;
  --mobile-art-panel:rgba(242,238,230,.075);
  --mobile-art-panel-strong:rgba(242,238,230,.13);
  --mobile-art-text:#F2EEE6;
  --mobile-art-muted:#AFA79B;
  --mobile-art-accent:#D6B36A;
  --mobile-art-glow:rgba(214,179,106,.24);
}
.mobile-art-neon-console .mobile-art-phone {
  background:
    radial-gradient(circle at 50% 10%, rgba(214,179,106,.16), transparent 30%),
    linear-gradient(180deg, #12161B, #0B0D10);
}
.mobile-pa-visual {
  position:relative;
  min-height:0;
  display:grid;
  place-items:center;
  isolation:isolate;
}
.mobile-pa-art-stack {
  position:relative;
  width:min(286px, 76vw);
  aspect-ratio:1;
  display:grid;
  place-items:center;
}
.mobile-pa-vinyl {
  position:absolute;
  right:-8%;
  width:86%;
  aspect-ratio:1;
  border-radius:50%;
  background:
    radial-gradient(circle, #0c0d0f 0 12%, #272b30 13% 14%, #111418 15% 42%, #050608 43% 100%);
  box-shadow:0 24px 58px rgba(0,0,0,.34), inset 0 0 0 1px rgba(255,255,255,.08);
}
.mobile-pa-vinyl i {
  position:absolute;
  inset:17%;
  border-radius:50%;
  background:var(--mobile-art-cover-image);
  background-size:cover;
  background-position:center;
  filter:saturate(.8) brightness(.72);
}
.mobile-pa-cover {
  position:absolute;
  left:0;
  width:76%;
  aspect-ratio:1;
  display:grid;
  place-items:center;
  overflow:hidden;
  border-radius:18px;
  color:var(--mobile-art-accent);
  background:var(--mobile-art-cover-image);
  background-size:cover;
  background-position:center;
  border:1px solid rgba(242,238,230,.14);
  box-shadow:0 26px 70px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.12);
}
.mobile-pa-cover img {
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  object-fit:cover;
}
.mobile-pa-tonearm {
  position:absolute;
  top:6%;
  right:9%;
  width:76px;
  height:174px;
  transform:rotate(var(--mobile-pa-tonearm, 15deg));
  transform-origin:50% 18px;
  transition:transform .42s cubic-bezier(0.32,0.72,0,1);
}
.mobile-pa-tonearm span {
  position:absolute;
  top:0;
  left:50%;
  width:30px;
  height:30px;
  border-radius:50%;
  background:linear-gradient(145deg, #3c4147, #111418);
  border:1px solid rgba(242,238,230,.14);
  transform:translateX(-50%);
}
.mobile-pa-tonearm i {
  position:absolute;
  top:26px;
  left:50%;
  width:7px;
  height:122px;
  border-radius:999px;
  background:linear-gradient(90deg, #F2EEE6, #777065);
  transform:translateX(-50%);
}
.mobile-pa-status {
  position:absolute;
  right:2%;
  bottom:4%;
  min-width:92px;
  display:grid;
  grid-template-columns:auto auto 1fr;
  align-items:center;
  gap:5px;
  padding:8px;
  border-radius:16px;
  color:var(--mobile-art-muted);
  background:rgba(18,22,27,.78);
  border:1px solid rgba(242,238,230,.1);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
}
.mobile-pa-led {
  width:8px;
  height:8px;
  border-radius:50%;
  background:#4b4f52;
}
.mobile-pa-led.on {
  background:#D6B36A;
  box-shadow:0 0 16px rgba(214,179,106,.46);
}
.mobile-pa-status strong,
.mobile-pa-status em {
  font-size:10px;
  line-height:1;
  font-weight:800;
  letter-spacing:0;
}
.mobile-pa-vu {
  grid-column:1 / -1;
  display:flex;
  align-items:end;
  gap:3px;
  height:22px;
}
.mobile-pa-vu i {
  width:4px;
  height:calc(7px + var(--vu-index) * 1.6px);
  border-radius:999px;
  background:color-mix(in srgb, var(--mobile-art-accent) 62%, rgba(242,238,230,.2));
  opacity:.42;
}
.mobile-art-player[data-playing='true'] .mobile-pa-vinyl {
  animation:mobile-art-spin 9s linear infinite;
}
.mobile-art-player[data-playing='true'] .mobile-pa-vu i:nth-child(2n) {
  opacity:.9;
}
```

- [ ] **Step 5: Remove weak neon-specific rules**

Search and delete rules that still style `.mobile-neon-visual`, `.mobile-neon-record`, and `.mobile-neon-led` when they no longer apply to the default branch:

```bash
rg -n "mobile-neon" frontend/src/mobile.css frontend/src/components/player-themes/MobileArtPlayer.tsx
```

Expected after cleanup: no `mobile-neon-*` selectors remain unless `NeonConsoleVisual` is intentionally still referenced. If no references remain, remove the `NeonConsoleVisual` function from `MobileArtPlayer.tsx`.

- [ ] **Step 6: Verify player compiles**

Run:

```bash
cd frontend
pnpm lint
pnpm build
```

Expected: both commands exit with code 0.

- [ ] **Step 7: Commit full-screen player**

Run:

```bash
git add frontend/src/components/player-themes/MobileArtPlayer.tsx frontend/src/mobile.css
git commit -m "feat: add precision audio mobile player"
```

Expected: a commit is created and `git status --short` does not show these files.

## Task 5: Mobile Sheets, Focus, and Material Polish

**Files:**
- Modify: `frontend/src/components/mobile/MobileSoundPanel.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/mobile.css`

- [ ] **Step 1: Add dialog lifecycle to MobileSoundPanel**

In `frontend/src/components/mobile/MobileSoundPanel.tsx`, add:

```ts
import { useDialogLifecycle } from "../../hooks/useDialogLifecycle";
```

Inside `MobileSoundPanel`, before `return`, add:

```ts
const dialogRef = useDialogLifecycle<HTMLElement>(onClose);
```

Change the root section to:

```tsx
<section
  ref={dialogRef}
  className="mobile-sound-panel"
  role="dialog"
  aria-modal="true"
  aria-labelledby="mobile-sound-title"
  data-enabled={enabled ? "true" : "false"}
>
```

Change the title to:

```tsx
<strong id="mobile-sound-title">{t("mobileSoundEffects")}</strong>
```

Add `data-autofocus` to the close button.

- [ ] **Step 2: Replace the sound orb with a calmer meter**

Replace:

```tsx
<div className="mobile-sound-orb" aria-hidden="true">
  {Array.from({ length: 5 }, (_, index) => <i key={index} />)}
</div>
```

with:

```tsx
<div className="mobile-sound-meter" aria-hidden="true">
  {bands.map((value, index) => (
    <i key={index} style={{ "--band-level": `${Math.max(0.18, Math.min(1, (value + 12) / 24))}` } as React.CSSProperties} />
  ))}
</div>
```

Add `type="button"` to every button in the component.

- [ ] **Step 3: Add queue dialog semantics**

In `RadioQueuePanel`, add a dialog ref:

```ts
const dialogRef = useDialogLifecycle<HTMLDivElement>(onClose);
```

Change the root:

```tsx
<div ref={dialogRef} className="queue-panel radio-queue-panel" role="dialog" aria-modal="true" aria-labelledby="radio-queue-title">
```

Change the title:

```tsx
<strong id="radio-queue-title">{t("onlineRadio")}</strong>
```

Change the close button:

```tsx
<button type="button" data-autofocus aria-label={t("close")} onClick={onClose}>×</button>
```

In `QueuePanel`, add the same pattern:

```ts
const dialogRef = useDialogLifecycle<HTMLDivElement>(onClose);
```

```tsx
<div ref={dialogRef} className="queue-panel" role="dialog" aria-modal="true" aria-labelledby="queue-panel-title">
```

```tsx
<strong id="queue-panel-title">{t("queue")}</strong>
```

```tsx
<button type="button" data-autofocus aria-label={t("close")} onClick={onClose}>×</button>
```

- [ ] **Step 4: Replace mobile sheet CSS material**

In `frontend/src/mobile.css`, replace the mobile sound panel gradient block with:

```css
.mobile-sound-panel {
  position:relative;
  z-index:1;
  width:100%;
  min-height:min(56dvh, 500px);
  display:grid;
  grid-template-rows:auto auto 1fr auto;
  gap:16px;
  padding:10px 18px calc(24px + var(--safe-bottom));
  overflow:hidden;
  border-radius:26px 26px 0 0;
  color:var(--text);
  background:linear-gradient(180deg, color-mix(in srgb, var(--panel) 98%, transparent), color-mix(in srgb, var(--panel2) 94%, transparent));
  border:1px solid color-mix(in srgb, var(--line) 92%, transparent);
  border-bottom:0;
  box-shadow:0 -26px 76px rgba(0,0,0,.38), var(--mobile-pa-inner, inset 0 1px 0 rgba(255,255,255,.08));
  animation:mobile-queue-sheet .28s cubic-bezier(0.32,0.72,0,1);
}
.mobile-sound-head button,
.mobile-sound-presets button {
  color:var(--text);
  background:color-mix(in srgb, var(--panel2) 86%, transparent);
  border:1px solid color-mix(in srgb, var(--line) 88%, transparent);
  backdrop-filter:none;
}
.mobile-sound-head button.active,
.mobile-sound-presets button.active {
  color:var(--mobile-active-text);
  background:var(--accent);
  border-color:transparent;
  box-shadow:0 12px 26px color-mix(in srgb, var(--accent) 18%, transparent);
}
.mobile-sound-meter {
  min-height:178px;
  display:flex;
  align-items:end;
  justify-content:center;
  gap:8px;
  padding:22px 12px;
  border-radius:22px;
  background:rgba(242,238,230,.045);
  border:1px solid color-mix(in srgb, var(--line) 90%, transparent);
}
.mobile-sound-meter i {
  width:12px;
  height:calc(34px + 120px * var(--band-level));
  max-height:144px;
  border-radius:999px;
  background:linear-gradient(180deg, #F2EEE6, var(--accent));
  opacity:.76;
  transform-origin:bottom;
}
.mobile-sound-panel[data-enabled='false'] .mobile-sound-meter i {
  transform:scaleY(.32);
  opacity:.34;
}
```

Remove `.mobile-sound-orb` rules and `@keyframes mobile-sound-pulse`.

- [ ] **Step 5: Verify sheets compile**

Run:

```bash
cd frontend
pnpm lint
pnpm build
```

Expected: both commands exit with code 0.

- [ ] **Step 6: Commit sheet polish**

Run:

```bash
git add frontend/src/components/mobile/MobileSoundPanel.tsx frontend/src/App.tsx frontend/src/mobile.css
git commit -m "feat: polish mobile playback sheets"
```

Expected: a commit is created and `git status --short` does not show these files.

## Task 6: Responsive Polish and Reduced Motion

**Files:**
- Modify: `frontend/src/mobile.css`

- [ ] **Step 1: Add reduced motion coverage for new Precision Audio selectors**

Extend the existing `@media (prefers-reduced-motion:reduce)` block with:

```css
.mobile-pa-vinyl,
.mobile-pa-vu i,
.mobile-sound-meter i {
  animation:none !important;
  transition:none !important;
}
```

- [ ] **Step 2: Add small viewport constraints**

In the `@media (max-width:420px)` section, add:

```css
.mobile-pa-art-stack {
  width:min(254px, 76vw);
}
.mobile-pa-status {
  right:0;
  bottom:0;
  transform:scale(.92);
  transform-origin:right bottom;
}
.mobile-home-library-hub {
  grid-template-columns:repeat(2, minmax(0, 1fr));
}
.mobile-home-library-hub button {
  min-height:82px;
  grid-template-columns:44px minmax(0,1fr);
  align-items:center;
  justify-items:start;
  text-align:left;
}
.mobile-home-library-hub span {
  justify-items:start;
}
```

- [ ] **Step 3: Check for stale removed selectors**

Run:

```bash
rg -n "mobile-home-tabs|mobile-neon|mobile-sound-orb|mobile-mini-previous|mobile-mini-next" frontend/src
```

Expected: no matches for removed selectors. If `mobile-home-tabs` appears only in comments or deleted theme CSS, remove those lines.

- [ ] **Step 4: Verify responsive polish**

Run:

```bash
cd frontend
pnpm lint
pnpm build
```

Expected: both commands exit with code 0.

- [ ] **Step 5: Commit responsive polish**

Run:

```bash
git add frontend/src/mobile.css
git commit -m "style: polish mobile precision audio responsiveness"
```

Expected: a commit is created and `git status --short` does not show `frontend/src/mobile.css`.

## Task 7: Final Verification, Commit Hygiene, Push, and Tag

**Files:**
- Verify all changed files
- Create release tag `v0.8.6` if no newer tag exists

- [ ] **Step 1: Run full frontend verification**

Run:

```bash
cd frontend
pnpm lint
pnpm build
```

Expected: both commands exit with code 0.

- [ ] **Step 2: Run backend verification**

Run:

```bash
cd backend
go mod verify
go test ./...
go vet ./...
```

Expected: all commands exit with code 0.

- [ ] **Step 3: Inspect final git state**

Run:

```bash
git status --short --branch
git log --oneline -8
```

Expected: branch is ahead of `origin/main`; only the pre-existing untracked `--full-page` may remain untracked.

- [ ] **Step 4: Start local frontend for manual mobile checks**

Run:

```bash
cd frontend
pnpm dev --host 127.0.0.1
```

Expected: Vite prints a local URL. Use browser responsive viewports 360x740, 390x844, 430x932, short height below 740px, and landscape mobile.

Manual states to check:

- Home with no current song.
- Home with song playing.
- Mini player row tap expands the full-screen player.
- Mini player queue button opens queue without expanding player.
- Full-screen Precision Audio player shows artwork, tonearm, VU/status, progress, actions, and safe touch targets.
- Swipe down or back collapses full-screen player.
- Lyrics opens and returns to player.
- Queue sheet traps focus and Escape closes it.
- Sound sheet traps focus and Escape closes it.
- Radio view remains on mobile after opening from Home shortcut and Library.
- Long Chinese and English song titles truncate without overlap.
- Reduced motion leaves player usable.

- [ ] **Step 5: Confirm release tag candidate**

Run:

```bash
git fetch --tags origin
git tag --sort=-version:refname | sed -n '1,5p'
```

Expected before tagging: latest tag is `v0.8.5`. If a newer tag appears, choose the next patch version after that newer tag.

- [ ] **Step 6: Push branch**

Run:

```bash
git push origin main
```

Expected: push succeeds.

- [ ] **Step 7: Create and push release tag**

Run:

```bash
git tag -a v0.8.6 -m "v0.8.6"
git push origin v0.8.6
```

Expected: tag push succeeds and the repository's `v*` tag workflows start.

## Self-Review Checklist

- Spec coverage: radio mobile bounce, visible Precision Audio label, default `neon-console` compatibility, full-row mini expansion, queue action, duplicate home tabs removal, artwork-forward home, PC player effect adaptation, sheet dialog semantics, reduced motion, lint/build, backend verification, push, and tag are covered.
- Scope control: no backend API changes, no desktop player redesign, no new UI framework, no new mobile theme enum value.
- Type consistency: `MobileHomePlayerStyle` stays unchanged; `MobileArtPlayerVariant` stays unchanged; `onOpenRadio` is added only to Home mobile wiring; mini player removes previous/next from the compact row but full-screen controls keep them.
- Risk containment: each task has its own verification and commit.
