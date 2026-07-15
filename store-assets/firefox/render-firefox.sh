#!/bin/zsh
# Renders store-assets/firefox/src/*.html to PNGs at AMO screenshot size.
# AMO has no marquee/small tile slots, so this is screenshots only.
set -e
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC="$(cd "$(dirname "$0")/src" && pwd)"
OUT="$(cd "$(dirname "$0")" && pwd)"

shot() { # name width height
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$2,$3" \
    --screenshot="$OUT/$1.png" "file://$SRC/$1.html" 2>/dev/null
  echo "rendered $1.png ($2x$3)"
}

shot ff-shot1-hero    1280 800
shot ff-shot2-labels  1280 800
shot ff-shot3-setup   1280 800
shot ff-shot4-privacy 1280 800
