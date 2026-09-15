# Enable receipt reading

Receipt reading uses the secured ReceiptMind service. Google sign-in identifies
the account for scan limits; it does not require Google Drive storage access.
The app reads a selected receipt automatically after authentication.

## Why this build cannot read receipts

The `Receipt sign-in is not configured` error means the JavaScript build is
missing a valid `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Retrying or taking a new
photo cannot fix it. The native Google sign-in library also cannot run in Expo Go.

## 1. Register Google sign-in

In [Google Cloud Console](https://console.cloud.google.com/), choose the Google
project for ReceiptMind and configure Google Auth Platform branding, audience,
and a test user if the app is in testing.

Create OAuth clients in that same project:

- **Web application:** copy its public client ID. This is needed on both mobile
  platforms so the backend can verify sign-in. No client secret is needed.
- **Android:** register package `com.shameem.receiptmind` and the SHA-1 fingerprint
  of the certificate signing the APK you install. Obtain the EAS certificate
  fingerprint with `npx eas-cli credentials --platform android`. Copy the Android
  client ID. Play Store installs require the Play app-signing certificate too.
- **iOS, if testing iPhone:** register bundle ID `com.shameem.receiptmind` and copy
  the iOS client ID. The app config derives its native URL scheme automatically.

See the library's [registration guide](https://react-native-google-signin.github.io/docs/setting-up/get-config-file)
and [Expo native-build requirement](https://react-native-google-signin.github.io/docs/setting-up/expo).

## 2. Configure the app build

For local development, copy `.env.example` to `.env` if `.env` does not exist.
Fill these with the real public client IDs from step 1:

```dotenv
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=
# Also required for iPhone builds:
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=
```

For EAS builds, add the same variables to the project's EAS environment matching
the build profile: `preview` for preview builds or `development` for development
builds. Use plaintext visibility for these public identifiers. A local `.env`
alone is not a substitute for configuring the EAS build environment.
See [EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

## 3. Configure the receipt service

Set the Worker's `GOOGLE_WEB_CLIENT_ID` to exactly the app's
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Follow the
[manual deployment runbook](backend/receiptmind-worker/DEPLOYMENT.md) to provision
its secrets, scan guard, pricing and scan allowance, and enable scans when ready.
The checked-in Worker defaults have an empty audience and scans disabled;
they do not establish the deployed Worker's current settings.

## 4. Build and install

For an Android APK that runs without Metro:

```powershell
npx eas-cli build --platform android --profile preview
```

Install the APK from the completed build onto the phone and open ReceiptMind.
For iPhone, use `--platform ios --profile preview`; Apple signing and a registered
test device are required. Production builds require both platform client IDs
and the legal-page URLs validated by `app.config.ts`.

Select a receipt, complete Google sign-in when needed, then review the extracted
items. Google sign-in does not grant Drive access unless you separately connect
Drive in Settings. Check an image and a PDF on a physical device before release.
