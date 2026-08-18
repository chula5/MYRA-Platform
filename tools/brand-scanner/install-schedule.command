#!/bin/bash
# MYRA Brand Watch — install the weekly (Monday 08:00) new-drop check as a launchd job.
# Double-click to install. Remove any time with:
#   launchctl bootout gui/$UID/com.myra.brandwatch
set -e
cd "$(dirname "$0")"
TOOL_DIR="$(pwd)"
PLIST="$HOME/Library/LaunchAgents/com.myra.brandwatch.plist"
PYTHON="$(command -v python3 || echo /usr/bin/python3)"

mkdir -p "$HOME/Library/LaunchAgents" "$TOOL_DIR/logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.myra.brandwatch</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PYTHON}</string>
    <string>${TOOL_DIR}/brand_watch.py</string>
    <string>--check</string>
  </array>
  <key>WorkingDirectory</key><string>${TOOL_DIR}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>8</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${TOOL_DIR}/logs/brandwatch.log</string>
  <key>StandardErrorPath</key><string>${TOOL_DIR}/logs/brandwatch.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID/com.myra.brandwatch" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"

echo ""
echo "Installed. Every watched brand is checked every 3 days."
echo "New drops land as review sheets in: $TOOL_DIR/review/"
echo "Log: $TOOL_DIR/logs/brandwatch.log"
echo ""
echo "Stop it any time with:"
echo "  launchctl bootout gui/\$UID/com.myra.brandwatch"
read -p "Press return to close."
