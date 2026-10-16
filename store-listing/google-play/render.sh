#!/usr/bin/env bash
# Render the Google Play graphics for both Zapp Pay apps with headless Chrome.
#   ./render.sh                    # both apps, every frame
#   ./render.sh merchant           # one app
#   ./render.sh customer shot-3    # one frame (shot-1…shot-7, feature, icon)
# Pages: src/customer.html, src/merchant.html → out/customer/, out/merchant/.
# Chrome writes 24-bit PNG (no alpha), which is what Play wants for
# screenshots and the feature graphic. The script prints size + alpha per file.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

# frame  css-width css-height scale  output-name
CUSTOMER=(
  "shot-1  540 960 2 phone-1-home"
  "shot-2  540 960 2 phone-2-scan"
  "shot-3  540 960 2 phone-3-pin"
  "shot-4  540 960 2 phone-4-agent-topup"
  "shot-5  540 960 2 phone-5-send"
  "shot-6  540 960 2 phone-6-insights"
  "shot-7  540 960 2 phone-7-languages"
  "feature 1024 500 1 feature-graphic"
  "icon    512 512 1 icon-512"
)
MERCHANT=(
  "shot-1  540 960 2 phone-1-dashboard"
  "shot-2  540 960 2 phone-2-receive-qr"
  "shot-3  540 960 2 phone-3-payment-received"
  "shot-4  540 960 2 phone-4-counter-code"
  "shot-5  540 960 2 phone-5-agent-commission"
  "shot-6  540 960 2 phone-6-payroll"
  "shot-7  540 960 2 phone-7-payout"
  "feature 1024 500 1 feature-graphic"
  "icon    512 512 1 icon-512"
)

PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

render_app() {
  local app="$1" only="${2:-}"
  local -a frames
  if [[ "$app" == customer ]]; then frames=("${CUSTOMER[@]}"); else frames=("${MERCHANT[@]}"); fi
  local out="$HERE/out/$app"
  mkdir -p "$out"
  for row in "${frames[@]}"; do
    read -r frame w h scale name <<<"$row"
    [[ -n "$only" && "$only" != "$frame" ]] && continue
    local png="$out/$name.png"
    rm -f "$png"
    # Chrome sometimes crashes during teardown after writing the file (exit 2),
    # so judge success by the screenshot existing, not by the exit code.
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
      --user-data-dir="$PROFILE" \
      --force-device-scale-factor="$scale" --window-size="$w,$h" \
      --virtual-time-budget=1500 \
      --screenshot="$png" "file://$HERE/src/$app.html#$frame" >/dev/null 2>&1 || true
    if [[ ! -s "$png" ]]; then echo "FAILED $app/$name.png" >&2; exit 1; fi
    echo "$(sips -g pixelWidth -g pixelHeight -g hasAlpha "$png" | awk 'NR>1{printf "%s ", $2}') $app/$name.png"
  done
}

case "${1:-all}" in
  all) render_app customer; render_app merchant ;;
  customer|merchant) render_app "$1" "${2:-}" ;;
  *) echo "usage: $0 [customer|merchant] [frame]" >&2; exit 1 ;;
esac
