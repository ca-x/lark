# Lark logo

The logo comes from [issue #9](https://github.com/ca-x/lark/issues/9), supplied by @czyt and adopted on 2026-10-29.

- Original attachment: <https://github.com/user-attachments/assets/410bd516-ef9c-4d80-b3c4-a2d20ec9d053>
- Unmodified source: `lark-issue-9.png` (1254 × 1254, RGBA).
- SHA-256: `fc113df9dcd055b1e8fdab10022149516c91574fd04f3872c0e6d84692ab2916`.

The bird, music notes and record are not redrawn or AI-generated. Generated variants crop the nearly transparent outer padding using 3% alpha bounds, center the artwork on a transparent square and resize with Lanczos filtering. This restores the previous logo's visible footprint without enlarging interface slots; the original source remains unchanged. The source lives outside `frontend/public` so the full-resolution attachment is not bundled into the server.

With ImageMagick 7 installed, regenerate the web/PWA/favicons and desktop/tray assets from the repository root:

```bash
bash assets/brand/generate.sh
```

`frontend/public/logo.png`, the 512px Android icon and `desktop/resources/icon.png` are identical. The 32px favicon and desktop tray icon are identical. The ICO contains 16px, 32px and 48px variants. Rebuild the frontend after regeneration to update `backend/web/dist`.
