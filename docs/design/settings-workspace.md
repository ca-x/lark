# Settings workspace

## Scope and acceptance

Reorganize Lark's existing settings for people listening on phones, tablets and
desktop computers. Preserve every preference, role boundary, player theme and
save handler. No backend schema, logo, audio pipeline or desktop-installer change.

- Separate appearance, playback, lyrics and offline storage instead of a single
  long “Playback & appearance” page. Keep account, library, connections and
  administration recognizable.
- Desktop: quiet category rail and bounded reading column. Intermediate widths:
  wrapping categories. Phones and narrow effective widths after text scaling:
  native category picker, without a horizontally hidden menu.
- One labeled panel with category description; search reaches controls across
  categories and reveals collapsed sections before focusing their control.
- Align descriptions and trailing controls; wrap long labels, URLs and action
  groups. Validate 360, 390, 768, 1024, 1440 and 1920px plus phone landscape,
  English labels and enlarged interface settings.
- Preserve keyboard access, visible focus, 44px targets and role filtering.
  Motion only confirms presses, disclosure and selected state. No page entrance
  choreography or layout animation while changing categories.
- On the settings screen, avoid double-scaling the nested desktop header and use
  the compact footer arrangement when enlarged controls reduce usable space.
  Do not change playback behavior or other screens' player layouts.
- Keep the main desktop navigation in the content grid row so the bottom player
  does not obscure the Settings entry in short windows.

## Visual decisions

Retain the selected Lark palette rather than introduce a new brand: `--bg`,
`--panel`, `--panel2`, `--text`, `--muted`, `--accent`. For the default Apple light
palette these represent the existing white/gray surfaces and red accent, not
hardcoded replacement colors. Use the existing app font, 14/16/20px hierarchy,
4/8/12/16/24/32 spacing and 12/16px control/surface radii. A selected rail item
uses a quiet accent wash and clear icon, not a large pill shadow.

```text
Wide                         Compact
Search | Appearance          Category [Appearance v]
       | Short description   Appearance / description
Personal                     [label       control]
  Account    [label control]  [theme previews     ]
  Appearance [theme choices]
  Playback
  Lyrics
  Offline
Connections / Administration
```

Avoid a generic dashboard card grid: option rows are the organizing unit, with
larger surfaces reserved for theme previews, forms and tools. No new font,
dependency, decorative hero or continuously moving settings control.

## Implementation and verification order

1. Add typed category metadata, permission-aware navigation and bilingual copy.
2. Reassign existing controls, unify panel semantics and cross-category search.
3. Add scoped responsive styles and restrained, reduced-motion-aware feedback.
4. Unit/build/lint, browser layout and interaction checks, existing player and Go
   regressions; inspect screenshots and review the complete release diff.
5. Bump the server patch within 0.18.x, regenerate tracked embedded frontend,
   commit/push/tag, wait for CI and verify release assets before publishing.
