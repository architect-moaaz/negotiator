#!/usr/bin/env bash
# Run the Maestro flows on a booted iOS simulator or Android emulator, in Expo Go, against a local
# GhostCart (see README.md here). Usage: apps/mobile/.maestro/run.sh ios|android
set -euo pipefail
cd "$(dirname "$0")"
platform="${1:?usage: run.sh ios|android}"
host="${GHOSTCART_HOST:-$(ipconfig getifaddr en0 2>/dev/null || hostname -I | awk '{print $1}')}"
case "$platform" in
  ios)
    app_id="host.exp.Exponent"
    device="$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)" ;;
  android)
    app_id="host.exp.exponent"
    device="$(adb devices | awk '/emulator-|device$/ && NR>1 {print $1; exit}')" ;;
  *) echo "usage: run.sh ios|android" >&2; exit 2 ;;
esac
[ -n "$device" ] || { echo "No booted $platform device." >&2; exit 1; }
# A new shopper every run, in the ZZ test range (+91 90000 4xxxx).
shopper="90000$(printf '4%04d' $((RANDOM % 10000)))"
exec maestro --device "$device" test . \
  -e APP_ID="$app_id" -e APP_URL="exp://$host:8081" \
  -e CODE="${E2E_LOGIN_CODE:-123456}" -e SHOPPER_PHONE="$shopper" -e SELLER_PHONE=9000003101 \
  --format junit --output "report-$platform.xml"
