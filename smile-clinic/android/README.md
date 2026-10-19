# Smile Clinic for Android

A signed APK that opens the clinic server in a full-screen app, with a launcher
icon and no browser bars.

The prebuilt APK is at **`dist/smile-clinic.apk`**. You do not need Android
Studio, Gradle, or any of this folder to use it — only to rebuild it.

## Two ways to run

On first launch the app asks one question: **where should this phone keep its
records?**

**On this phone.** The whole clinic — database included — runs inside the app.
No computer, no Wi-Fi, no internet. SQLite compiled to WebAssembly holds the
records in the app's own storage, and the same route code the server runs answers
the app's requests inside a Web Worker. Everything is bundled in the APK, so it
works the moment it is installed.

*The catch:* until it joins a clinic, that phone's records live on it alone, and
a lost phone takes them with it — so take backups (Settings → Where the records
are kept).

**Joining a clinic.** A phone in this mode can be joined to a clinic computer
and still keep working with that computer switched off. On the computer:
**Settings → Devices → + Add a device**, which shows a six-character code. On
the phone: **Settings → Clinic → Keeping devices in step**, enter the computer's
address and the code, and tap **Join this clinic**. Everything comes across, and
from then on each device sends what it has and takes what it is missing whenever
they can reach each other.

Two things happen on joining, both on purpose: the phone asks you to **sign in
again** (the temporary administrator it invented for itself is stood down in
favour of the clinic's real staff accounts), and file numbers it issued while
alone are **stamped with the device's letter** — `P-0001` becomes `P-B-0001` —
so they cannot collide with the clinic's own `P-0001`.

**On a clinic computer.** The classic setup: the phone is a window onto a server
running elsewhere, and every device connecting to it sees the same records.
Needs that computer switched on and the same Wi-Fi.

The choice can be changed later from the back-button menu.

## Arabic

The app is fully available in Arabic, laid out right-to-left. Pick the language
on the sign-in screen or in **Settings → Language**; it is remembered on that
phone. Patient names, notes and message text are never translated — they are
shown exactly as typed.

## Licensing

If the build carries a licence public key (`server/licence-public.txt` at build
time), the phone enforces the same rule as the computer: a free trial, then
read-only until a code is entered. A phone that has joined a clinic takes on
the clinic's licence at the first sync, with nothing to type.

A build without that file enforces nothing, which is what an APK built straight
from a fresh checkout does.

## What the app adds over a browser

In server mode the computer does the work and this is the window onto it. Over
simply opening the address in Chrome, it adds:

- a launcher icon and no browser chrome
- the server address is remembered, and **checked before it is accepted** — a
  typo is caught at setup rather than becoming a blank screen
- **WhatsApp links leave the app** and open the real WhatsApp, so the messaging
  feature works
- **CSV exports go to the phone's Downloads**, instead of silently doing nothing
- a real error screen when the clinic computer is off, with "Try again" and
  "Change address"
- back navigates the app's own history; at the first screen it offers Reload,
  Change server address and Close

In server mode, **updating the server updates every phone** — you only reinstall
the APK when the wrapper changes. In on-this-phone mode the app *is* the whole
thing, so a new APK is how it gets updated.

## Installing it

1. Copy `smile-clinic.apk` to the phone (USB, email to yourself, or a shared
   folder).
2. Open it. Android will say the app is from an unknown source — allow it for
   whichever app you are installing from. That prompt is normal for any APK not
   from the Play Store.
3. Open **Smile Clinic** and choose where records should live.
   - *On this phone* — nothing else to do. Sign in as `admin@clinic.local` with
     the password `changeme`, then change it immediately under the ⋯ menu.
   - *On a clinic computer* — enter the address shown by `npm run address`, for
     example `192.168.1.42:4000`. Typing just the IP works; port 4000 is assumed.
     The phone must be on the same Wi-Fi and the clinic app must be running.

## Rebuilding

```bash
./android/build.sh      # builds and signs dist/smile-clinic.apk
./android/test.sh       # unit tests for the address parsing, no device needed
```

Requirements: a JDK (17 or newer) and the Android SDK with one platform and
**build-tools 35 or newer**. The build script finds the SDK at `$ANDROID_HOME`,
`~/Android/Sdk`, `~/Library/Android/sdk` or `/opt/android-sdk`.

No Gradle and no AndroidX: the app uses only the Android framework, so the build
is `aapt2` → `javac` → `d8` → `zipalign` → `apksigner` and nothing is downloaded.

Two things that will waste your afternoon if you do not know them, both handled
in `build.sh`:

- **build-tools 34 and older cannot dex anonymous inner classes.** They fail with
  `NullPointerException: Cannot invoke "String.length()"`, which names no useful
  cause. The build script refuses to run on those versions and says why.
- **A modern JDK compiles `"a" + b` with `invokedynamic`**, which does not exist
  on Android. `-XDstringConcat=inline` forces the old form.

## Signing

`smile-clinic.keystore` is committed on purpose and is **not a secret**. Its only
job is to let an updated APK install over the previous one — Android rejects an
update signed with a different key. Anyone distributing this beyond their own
clinic should generate their own key and keep it private:

```bash
keytool -genkeypair -keystore my.keystore -alias mykey \
        -keyalg RSA -keysize 2048 -validity 10950
```

Then point `KEYSTORE` and `STOREPASS` in `build.sh` at it. Note that switching
keys means uninstalling the old app on every phone before installing the new one.

## Layout

```
AndroidManifest.xml                      permissions, theme, cleartext policy
java/com/smileclinic/app/
  MainActivity.java                      mode choice, setup, WebView, errors
  AssetServer.java                       serves the bundled app from the APK
  ServerAddress.java                     address parsing — no Android imports,
                                         so it is unit testable on a plain JVM
assets/web/                              the bundled app (generated by build.sh)
res/                                     icons, colours, theme, network config
test/ServerAddressTest.java              the tests run by ./android/test.sh
build.sh                                 the whole build
dist/smile-clinic.apk                    the signed result
```

### Why the app is served from a made-up https address

The bundled app loads from `https://appassets.androidplatform.net/`, answered
from inside the APK by `AssetServer`. That is not decoration: the storage the
on-phone database needs is offered only to a secure context, and a `file://`
page is not one. Giving the bundled files a proper https origin — served
entirely from the APK, never from a network — is what lets the database exist
at all.

## Limits worth knowing

- **Android only.** iPhones cannot install APKs; on iOS use Safari → Share →
  Add to Home Screen, which gives the same icon and full-screen behaviour.
- **Plain HTTP on the local network.** The app permits cleartext because the
  clinic server has no certificate. Traffic never leaves the clinic's network.
  Putting the server on the public internet would need HTTPS and a rebuild.
- **No Play Store.** Distributed by copying the file. Updates are installed the
  same way, and install over the top as long as the signing key matches.
