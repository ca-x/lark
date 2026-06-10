# Terminal Shell UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop-only Terminal Shell UI that shares playback state with the existing app while keeping the Standard UI and its interactions intact.

**Architecture:** Build `TerminalShell` as an independent React surface under `frontend/src/components/terminal/`. `App.tsx` owns the interface mode switch and passes existing playback/data callbacks into the shell. The Standard UI remains mounted behind the shell overlay so the current audio element and handlers are not recreated.

**Tech Stack:** React 19, TypeScript, Vite, plain CSS, existing API service and app state.

---

### Task 1: Interface Mode Boundary

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/UserMenu.tsx`
- Modify: `frontend/src/i18n.ts`

- [x] **Step 1: Add interface mode helpers**

Add `standard | shell` local state in `App.tsx`, persisted to `lark.interface-mode`. Treat shell as desktop-only with an effective mode check: `mobileViewport ? "standard" : interfaceMode`.

- [x] **Step 2: Add personal menu entry**

Extend `UserMenu` with optional `onOpenShellMode`. When present, render a `>_ Shell Mode` menu item below Profile and above Logout. Do not add a main-navigation item.

- [x] **Step 3: Add copy keys**

Add localized keys for `shellMode`, `enterShellMode`, `standardUI`, and `switchToStandardUI` in both dictionaries.

### Task 2: Persistent Audio Node

**Files:**
- Modify: `frontend/src/App.tsx`

- [x] **Step 1: Keep the existing audio element mounted**

Keep the Standard UI app shell mounted while Terminal Shell is active, but hide it behind the shell overlay with CSS. This preserves the current `<audio>` node and all event handlers unchanged.

- [x] **Step 2: Avoid duplicate media elements**

Do not add another audio element in Terminal Shell. Terminal Shell only calls existing playback callbacks.

### Task 3: Terminal Shell Surface

**Files:**
- Create: `frontend/src/components/terminal/TerminalShell.tsx`
- Create: `frontend/src/components/terminal/TerminalShell.css`
- Modify: `frontend/src/App.tsx`

- [x] **Step 1: Build shell layout**

Create a full-viewport shell with top tabs, high-density content panels, and a two-line bottom player. Tabs: Home, Search, Library, Favorites, Queue, Console.

- [x] **Step 2: Add terminal theme presets**

Add Shell-only terminal presets from the final theme IDs: `operator`, `dusk`, `phosphor`, `ashgray`, and `embers`. Switching these must not modify the Standard UI site theme.

- [x] **Step 2b: Persist shell preferences**

Persist `terminal_shell_theme` through the existing `/api/me/preferences` user preference JSON so the setting is scoped per user and stored in the database.

- [x] **Step 3: Build shell views**

Implement Home, Search, Library Songs/Albums, Favorites Songs/Albums, Queue, Console, and a Lyrics overlay. Search calls `api.songsPage` directly; playback and favorites use callbacks from `App.tsx`.

- [x] **Step 4: Add keyboard controls**

Support `1-6`, `/`, Space, Left/Right seek, Up/Down volume, `N/P`, `F`, `j/k`, Enter, `L`, Esc, and Shift+Esc. Ignore playback shortcuts while typing in inputs.

- [x] **Step 5: Add exit routes**

Render `[Standard UI]` in the shell header, `[UI]` in the shell player, and a full Console action that all call `onExit`.

### Task 4: Verification

**Files:**
- Build artifacts only

- [x] **Step 1: Run lint**

Run `pnpm -C frontend lint`. Expected: exit code 0.

- [x] **Step 2: Run production build**

Run `pnpm -C frontend build`. Expected: TypeScript and Vite build pass.

- [x] **Step 3: Review git diff**

Confirm the diff does not modify existing Standard UI player behavior; the existing audio node remains mounted in the Standard UI while Shell is active.
