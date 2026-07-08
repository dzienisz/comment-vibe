#!/bin/zsh
# Renders store-assets/src/*.html to PNGs at exact Chrome Web Store sizes.
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

shot shot1-hero      1280 800
shot shot2-labels    1280 800
shot shot3-rewrite   1280 800
shot shot4-languages 1280 800
shot shot5-privacy   1280 800
shot tile-small       440 280
shot tile-marquee    1400 560
