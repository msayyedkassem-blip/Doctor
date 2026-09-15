# Souk Mobile App — Building the APK

This guide explains how to build an Android APK for the Souk mobile app when working from an Android phone or without local Android development tools.

## Quick Start (Recommended)

The fastest and most reliable way is to use **GitHub Actions**:

### Step-by-Step Instructions

#### 1. Create an Expo Auth Token
- Go to https://expo.dev/settings/tokens
- Click **Create a token**
- Name it `GitHub Actions` (or similar)
- **Copy the token** — you'll need it in the next step

#### 2. Add the Token to GitHub Secrets
- Go to your repository on GitHub: https://github.com/msayyedkassem-blip/doctor
- Click **Settings** (top-right, below your profile icon)
- On the left sidebar, click **Secrets and variables** → **Actions**
- Click **New repository secret**
- Name: `EAS_TOKEN`
- Value: Paste the token you copied in Step 1
- Click **Add secret**

#### 3. Trigger the Build
- Go to your repository: https://github.com/msayyedkassem-blip/doctor
- Click the **Actions** tab
- On the left, click **Build APK with EAS**
- Click **Run workflow**
- Choose the profile:
  - `preview` → Creates an APK (preview/development)
  - `production` → Creates an AAB (for Google Play Store)
- Click **Run workflow**

#### 4. Download the APK
- The workflow will start and show progress
- Wait 10–30 minutes for the build to complete
- Once done, go to https://expo.dev/
- Sign in with your Expo account
- Click your **Souk** project
- Go to **Builds** → **Android**
- Find the most recent build (with today's timestamp)
- Click **Download** to get the APK

#### 5. Install on Your Phone
- Transfer the APK file to your Android phone (e.g., via email, cloud storage, or USB)
- On your phone, open the file manager
- Tap the APK file
- Tap **Install**
- Allow the installation when prompted
- The app will appear on your home screen or in the app drawer

---

## The Old Way (Not Recommended)

If you tried the Expo web interface and got "EAS project not configured" errors, that's a known issue with monorepo projects. The GitHub Actions workflow avoids this problem entirely.

If you want to try the web interface:
- Go to https://expo.dev/
- Sign in with your Expo account
- Click your **Souk** project
- Click **Build from GitHub**
- Look for the **Details** page (a link or tab near "Build from GitHub")
- Make sure the **root directory** or **base directory** is set to `souk/apps/mobile`
- Then start a build

This approach is less reliable for monorepos, so the GitHub Actions method is preferred.

---

## Troubleshooting

### "EAS_TOKEN secret not found"
- Verify you created the secret in GitHub Settings (step 2)
- Confirm the name is exactly `EAS_TOKEN` (case-sensitive)

### "Build failed — auth error"
- Regenerate your Expo token at https://expo.dev/settings/tokens
- Update the GitHub secret with the new token

### "Build stuck or taking too long"
- Builds can take 15–30 minutes on the first run
- If it's been more than 45 minutes, go to https://expo.dev/ and check the build status
- Restart by triggering the workflow again

### "Downloaded APK won't install"
- Confirm your phone allows installation from unknown sources:
  - Go to **Settings** → **Security** (or **Apps**)
  - Enable **Install from unknown sources** or **Allow installation of apps from unknown sources**
- Retry tapping the APK file to install

---

## Architecture Note

The Souk app uses an **offline-first** architecture:
- It loads the catalogue from three sources in order:
  1. The server (if available)
  2. A cached copy on your phone
  3. A snapshot bundled into the APK

This means the app works even if the server is down. The API server address defaults to `http://10.0.2.2:3100` on an Android emulator, or can be set in the app's **Settings** tab to your server's actual address.

For development:
```bash
pnpm --filter @souk/mobile start          # Metro dev server; scan QR with Expo Go
pnpm --filter @souk/mobile web            # Web version for quick testing
pnpm --filter @souk/mobile snapshot http://localhost:3100  # Update bundled catalogue
```

---

## Questions?

If you hit an issue not covered here, check:
- The app's **README.md** in this folder
- The EAS documentation: https://docs.expo.dev/eas-update/introduction/
- Your Expo project dashboard: https://expo.dev/
