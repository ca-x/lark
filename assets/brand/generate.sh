#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source="$root/assets/brand/lark-issue-9.png"
public="$root/frontend/public"

printf '%s  %s\n' 'fc113df9dcd055b1e8fdab10022149516c91574fd04f3872c0e6d84692ab2916' "$source" | sha256sum --check

bounds="$(magick "$source" -alpha extract -threshold 3% -format '%@' info:)"
dimensions="${bounds%%+*}"
side="${dimensions%x*}"
height="${dimensions#*x}"
if (( height > side )); then side="$height"; fi
normalization=(-crop "$bounds" +repage -background none -gravity center -extent "${side}x${side}")

resize() {
  magick "$source" "${normalization[@]}" -filter Lanczos -resize "${1}x${1}" -depth 8 -strip -define png:color-type=6 -define png:exclude-chunks=date,time "$2"
}

resize 512 "$public/logo.png"
cp "$public/logo.png" "$public/android-chrome-512x512.png"
cp "$public/logo.png" "$root/desktop/resources/icon.png"
resize 192 "$public/android-chrome-192x192.png"
resize 180 "$public/apple-touch-icon.png"
resize 32 "$public/favicon-32x32.png"
resize 16 "$public/favicon-16x16.png"
cp "$public/favicon-32x32.png" "$root/desktop/resources/tray.png"
magick "$source" "${normalization[@]}" -filter Lanczos -depth 8 -strip -define icon:auto-resize=48,32,16 "$public/favicon.ico"
