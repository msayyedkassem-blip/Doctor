#!/usr/bin/env bash
#
# Makes Smile Clinic start by itself and stay running on a Mac.
#
#   ./scripts/install-mac.sh          install and start
#   ./scripts/install-mac.sh remove   stop and uninstall
#
# Uses launchd, macOS's own service manager: the app starts when you log in,
# restarts if it ever crashes, and needs no terminal window left open.
set -euo pipefail

LABEL="com.smileclinic.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4000}"

if [ "${1:-}" = "remove" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Smile Clinic will no longer start automatically."
  exit 0
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js is not installed. Get it from https://nodejs.org and run this again." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/logs"

cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--no-warnings</string>
    <string>$ROOT/server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
    <key>DATA_DIR</key><string>$ROOT/data</string>
    <key>QUIET</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT/logs/clinic.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/clinic.error.log</string>
</dict>
</plist>
PLIST_END

# Replace any previous copy before loading the new one.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo
  echo "Smile Clinic is installed and running."
else
  echo
  echo "Installed, but it has not answered yet. Check $ROOT/logs/clinic.error.log" >&2
fi

# The LAN address is what phones and other clinic computers connect to.
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
echo
echo "  On this Mac:            http://localhost:$PORT"
[ -n "$IP" ] && echo "  On phones / other PCs:  http://$IP:$PORT"
echo
echo "It now starts on its own every time you log in."
echo "To stop it permanently:  ./scripts/install-mac.sh remove"
