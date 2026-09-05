# Desktop listening workspace

## Direction

A music library with restrained navigation, album artwork and readable data, drawing on Roon's library presentation and familiar music-app controls. Preserve all 21 interface palettes and 11 desktop player materials.

## Palette

Use the existing semantic background, panel, text, muted and accent tokens. Avoid hardcoded page colors and animated navigation decoration. Sidebar uses the canvas tone; content and player use the panel tone.

## Typography

Keep the configured user font. Page titles 26px, sections 21px, song titles 14px and secondary metadata 12px. Chinese uses normal tracking. Song title and artist form one centered group; album, quality, time and controls are centered in their own columns.

## Components

One global search field with Ctrl/Cmd+K. Space controls playback when focus is outside editable/interactive elements. Menus and modal panels manage focus and support Escape. Copy failures retain a selectable URL.

## Layout

208px sidebar, 28px content gutters, 100px playback dock. Narrower desktop windows use a compact icon rail. Table header and row columns share one token. Virtual row height follows the existing 64px calculation.

## Depth

Use separators and panel tones for application chrome. Preserve individual player imagery and materials. Album cards use artwork as their surface, without nested framed cards.

## Constraints

Do not reuse centered icon-button alignment for text without an explicit layout rule. Do not show success before clipboard writes resolve. Only container-targeted key events may activate an album gallery. Do not animate navigation borders continuously.

## Responsive verification

Check all palettes at normal and wide desktop sizes, all players at 1280px/short-screen sizes, and all primary pages and overlays. Recheck all eight mobile themes after changing shared components. The browser regression command verifies real built song rows, their header and play buttons.

## Maintenance

Desktop rules live in desktop-experience.css behind the complement of the mobile viewport query. Keep mobile-specific overrides in mobile-experience.css. New song-table cells use the shared column definition instead of separately tuned padding or widths.
