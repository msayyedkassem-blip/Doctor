#!/usr/bin/env bash
# Unit tests for the Android app's address parsing, on a plain JVM — no
# emulator, no device, no Android SDK needed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/build/test"
rm -rf "$OUT" && mkdir -p "$OUT"
javac -nowarn -d "$OUT" \
  "$HERE/java/com/smileclinic/app/ServerAddress.java" \
  "$HERE/test/ServerAddressTest.java" 2>&1 | grep -v "JAVA_TOOL_OPTIONS" || true
java -cp "$OUT" ServerAddressTest 2>&1 | grep -v "JAVA_TOOL_OPTIONS"
