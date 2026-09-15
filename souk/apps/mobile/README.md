# Souk — mobile app

React Native (Expo SDK 52) for Android and iOS, sharing pricing and
compliance logic with the website through `@souk/core`.

## Running it

```bash
pnpm --filter @souk/mobile start        # Metro; scan the QR with Expo Go
pnpm --filter @souk/mobile web          # in a browser, for a quick look
```

The app reads its server address from **Réglages** inside the app, falling
back to the build-time default in `app.json` (`extra.apiUrl`). On an Android
emulator the host machine is `10.0.2.2`, not `localhost`.

## Offline behaviour

The catalogue loads from three sources, in order:

1. the server (`GET /api/catalogue`),
2. the last successful response, cached on the device,
3. `assets/catalogue-snapshot.json`, bundled into the build.

(3) is why a freshly sideloaded APK shows a real catalogue before any server
exists. Refresh it before each build:

```bash
pnpm --filter @souk/mobile snapshot http://localhost:3100
```

## Building an APK

**Quick start:** See [BUILD_INSTRUCTIONS.md](./BUILD_INSTRUCTIONS.md) for a step-by-step guide using GitHub Actions (recommended for mobile users).

If you're building locally with the CLI:

```bash
npx eas login                 # your Expo account, free tier
npx eas build -p android --profile preview
```

The `preview` profile produces an installable **APK**; `production` produces
an **AAB** for Google Play. The build finishes with a download link.

### Local builds are currently blocked

`./gradlew assembleRelease` fails in this repository with:

```
[CXX1210] react-native-screens/android/CMakeLists.txt release|arm64-v8a
        : No compatible library found
```

What is established:

- The Android SDK, NDK 26.1.10909125, CMake and JDK 21 are all present and
  the build reaches the native compile stage, so the toolchain is not the
  problem.
- `com.facebook.react:react-android:0.76.9` downloads correctly (a 130 MB
  AAR) and **does** publish the prefab modules `reactnative`, `jsi`,
  `hermestooling` and `jsctooling` that `react-native-screens` links against.
- Despite that, the prefab directory AGP prepares for `react-native-screens`
  is empty, so CMake finds nothing to link.
- The failure is identical with `newArchEnabled` true and false.
- Adding a root-level `dependencySubstitution` from the legacy
  `com.facebook.react:react-native` coordinate to `react-android` — the usual
  fix when library modules live outside the Gradle build directory, as they
  do under a hoisted monorepo — did not populate the prefab either.

The remaining suspect is the interaction between the hoisted `node_modules`
at the workspace root and autolinked Gradle subprojects resolving their
prefab dependencies. EAS sidesteps it, which is why it is the documented
path rather than a workaround left half-applied here.

## Architecture note

`newArchEnabled` is **false**. The app uses no Fabric-only APIs, and the old
architecture is fully supported in SDK 52 with fewer native build moving
parts. Revisit before the New Architecture becomes mandatory.
