#!/bin/sh
# Test-only, for homologation on the AVD (docs/validation/mobile-1.4.md): the emulator can't aim its camera at the
# desktop's QR, so this reads the QR from a screenshot of Settings › Devices and hands its text to the debug app, which
# scans it like a camera frame (PairLinkForHomologation). A release build ignores it. Needs a debug build installed, the
# AVD running, Java 17+ and the Gradle cache (zxing core, the app's dependency).
#
#   tools/homologation/pair-avd.sh desktop-devices.png
set -eu
shot="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$(dirname "$0")"
jar=$(find "${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2/files-2.1/com.google.zxing/core" -name 'core-*.jar' ! -name '*sources*' | sort | tail -1)
[ -n "$jar" ] || { echo "zxing core not in the Gradle cache: build the app once first" >&2; exit 1; }
java="${JAVA_HOME:+$JAVA_HOME/bin/}java"
link=$("$java" -cp "$jar" QrDecode.java "$shot")
case "$link" in
  oxespace://pair\?*) ;;
  *) echo "not an OXESpace pairing QR" >&2; exit 1 ;;
esac
adb="${ANDROID_HOME:-${LOCALAPPDATA:-}/Android/Sdk}/platform-tools/adb"
# The link holds the one-time code: it goes straight to the app and is never printed or saved here.
"$adb" shell am start -n com.oxespace.mobile/.MainActivity --es pair_link "'$link'" > /dev/null
echo "handed to the app; confirm on the computer that both show the same 6-character code"
