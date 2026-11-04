#!/usr/bin/env bash
# shot.sh <transport_id> <out> [width]
# Screenshots the phone and writes a downscaled JPEG to <out> (default 540 px
# wide, or AWD_SHOT_WIDTH): about a tenth of the full PNG's bytes, so each
# viewing costs a fraction of the context. Prints the path and the scale from
# image pixels to device pixels, for taps.
# Without ImageMagick, ffmpeg or sips it keeps the full PNG (scale 1).
# `shot.sh <id> <out> full` keeps the full PNG, for reading small text.
set -uo pipefail
TID="$1"; OUT="$2"; WIDTH="${3:-${AWD_SHOT_WIDTH:-540}}"
tmp=$(mktemp "${TMPDIR:-/tmp}/awd-shot.XXXXXX.png")
trap 'rm -f "$tmp"' EXIT
adb -t "$TID" exec-out screencap -p > "$tmp" || { echo "screencap failed" >&2; exit 1; }
[ -s "$tmp" ] || { echo "screencap returned nothing (screen off or secure window?)" >&2; exit 1; }
# The PNG's own width, from its IHDR chunk (bytes 17-20, big-endian).
full=$(od -An -tu1 -j16 -N4 "$tmp" | awk '{ print $1*16777216 + $2*65536 + $3*256 + $4 }')

keep_full() { mv "$tmp" "$OUT"; echo "$OUT scale 1 (full ${full}px PNG)"; exit 0; }
case "$WIDTH" in full) keep_full ;; ''|*[!0-9]*) WIDTH=540 ;; esac
[ "${full:-0}" -gt "$WIDTH" ] || keep_full

if command -v magick >/dev/null 2>&1; then magick "$tmp" -resize "${WIDTH}x" -quality 80 "jpg:$OUT"
elif command -v convert >/dev/null 2>&1; then convert "$tmp" -resize "${WIDTH}x" -quality 80 "jpg:$OUT"
elif command -v ffmpeg >/dev/null 2>&1; then ffmpeg -loglevel error -y -i "$tmp" -vf "scale=${WIDTH}:-2" -q:v 4 -f mjpeg "$OUT"
elif command -v sips >/dev/null 2>&1; then sips -s format jpeg --resampleWidth "$WIDTH" "$tmp" --out "$OUT" >/dev/null
else keep_full
fi || keep_full
awk -v f="$full" -v w="$WIDTH" -v o="$OUT" 'BEGIN { printf "%s scale %.3f (device = image x scale)\n", o, f / w }'
