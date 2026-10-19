#!/usr/bin/env bash
#
# Builds and signs the Smile Clinic APK.
#
#   ./android/build.sh
#
# Needs a JDK and the Android SDK (build-tools and one platform). Set
# ANDROID_HOME if the SDK is not at ~/Android/Sdk or /opt/android-sdk.
# No Gradle, no AndroidX, no third-party dependencies: the app uses only the
# Android framework, so the whole build is four commands and a signature.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/build"
DIST="$HERE/dist"

# --- locate the SDK ---------------------------------------------------------
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
for candidate in "$SDK" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" /opt/android-sdk; do
  if [ -n "$candidate" ] && [ -d "$candidate/platforms" ]; then SDK="$candidate"; break; fi
done
if [ -z "${SDK:-}" ] || [ ! -d "$SDK/platforms" ]; then
  echo "Android SDK not found. Install it, or set ANDROID_HOME." >&2
  exit 1
fi

BUILD_TOOLS="$(ls -1d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)"
PLATFORM="$(ls -1d "$SDK"/platforms/android-* 2>/dev/null | sort -V | tail -1)"
[ -n "$BUILD_TOOLS" ] || { echo "No build-tools in $SDK" >&2; exit 1; }

# d8 in build-tools 34 and earlier crashes on anonymous inner classes with an
# unhelpful NullPointerException. Fail with an explanation rather than let
# someone spend an afternoon on it.
BT_MAJOR="$(basename "$BUILD_TOOLS" | cut -d. -f1)"
if [ "$BT_MAJOR" -lt 35 ] 2>/dev/null; then
  echo "build-tools $(basename "$BUILD_TOOLS") is too old: its dexer fails on" >&2
  echo "anonymous inner classes. Install a newer one, for example:" >&2
  echo "    sdkmanager \"build-tools;36.0.0\"" >&2
  exit 1
fi
[ -n "$PLATFORM" ] || { echo "No platform in $SDK" >&2; exit 1; }
ANDROID_JAR="$PLATFORM/android.jar"

echo "SDK:         $SDK"
echo "build-tools: $(basename "$BUILD_TOOLS")"
echo "platform:    $(basename "$PLATFORM")"

rm -rf "$OUT"
mkdir -p "$OUT/res" "$OUT/gen" "$OUT/classes" "$OUT/dex" "$DIST"

# --- 0. the app itself, bundled so the phone needs no computer --------------
# Regenerate the phone's copy of the shared code first, so the APK can never
# ship a stale one.
(cd "$HERE/.." && node --no-warnings scripts/build-local.js)
ASSETS="$HERE/assets"
rm -rf "$ASSETS"
mkdir -p "$ASSETS"
cp -R "$HERE/../public/." "$ASSETS/web/"
echo "==> bundled the web app ($(du -sh "$ASSETS/web" | cut -f1))"

# --- 1. resources -----------------------------------------------------------
echo "==> compiling resources"
"$BUILD_TOOLS/aapt2" compile --dir "$HERE/res" -o "$OUT/res/resources.zip"

echo "==> linking resources"
"$BUILD_TOOLS/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$HERE/AndroidManifest.xml" \
  -A "$ASSETS" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code "$(grep -o 'versionCode="[0-9]*"' "$HERE/AndroidManifest.xml" | grep -o '[0-9]*')" \
  "$OUT/res/resources.zip"

# --- 2. java ----------------------------------------------------------------
echo "==> compiling java"
find "$HERE/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
# Piping javac through a filter would hide its exit status, so capture instead:
# a build that cannot compile must stop here, not produce an empty APK.
# -XDstringConcat=inline is essential: a modern JDK compiles "a" + b with
# invokedynamic against StringConcatFactory, which does not exist on Android
# and makes d8 fail with an unhelpful NullPointerException.
if ! javac -source 8 -target 8 -nowarn \
  -XDstringConcat=inline \
  -bootclasspath "$ANDROID_JAR" \
  -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" \
  @"$OUT/sources.txt" > "$OUT/javac.log" 2>&1; then
  grep -v "bootstrap class path" "$OUT/javac.log" >&2 || true
  echo "Java compilation failed." >&2
  exit 1
fi

if [ -z "$(find "$OUT/classes" -name '*.class' -print -quit)" ]; then
  echo "Compilation produced no classes." >&2
  exit 1
fi

# --- 3. dex -----------------------------------------------------------------
echo "==> converting to dex"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$BUILD_TOOLS/d8" --lib "$ANDROID_JAR" --min-api 24 --output "$OUT/dex" @"$OUT/classes.txt"

# --- 4. package -------------------------------------------------------------
echo "==> packaging"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -X "$OUT/unsigned.apk" classes.dex)

"$BUILD_TOOLS/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

# --- 5. sign ----------------------------------------------------------------
# The keystore is committed on purpose and is NOT a secret: it exists so an
# updated APK installs over the previous one instead of being rejected as a
# different app. Anyone publishing this beyond their own clinic should generate
# their own key and keep it private.
KEYSTORE="$HERE/smile-clinic.keystore"
STOREPASS="smileclinic"
if [ ! -f "$KEYSTORE" ]; then
  echo "==> creating a signing key"
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" -storepass "$STOREPASS" -keypass "$STOREPASS" \
    -alias smileclinic -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Smile Clinic, OU=Clinic, O=Smile Clinic, L=, S=, C=" >/dev/null 2>&1
fi

echo "==> signing"
"$BUILD_TOOLS/apksigner" sign \
  --ks "$KEYSTORE" --ks-pass "pass:$STOREPASS" --key-pass "pass:$STOREPASS" \
  --ks-key-alias smileclinic \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$DIST/smile-clinic.apk" \
  "$OUT/aligned.apk"

"$BUILD_TOOLS/apksigner" verify --print-certs "$DIST/smile-clinic.apk" | head -4

SIZE="$(du -h "$DIST/smile-clinic.apk" | cut -f1)"
echo
echo "Built $DIST/smile-clinic.apk ($SIZE)"
