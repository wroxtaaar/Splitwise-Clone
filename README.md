# Splitwise Clone

A responsive Splitwise-inspired expense-sharing app for a small, shared group.

## Features

- Create groups and friends
- Add expenses with equal or custom splits
- Record settlements and calculate balances
- Mobile-friendly Groups, Friends, Activity, and Account screens
- Local caching for quick loading and offline viewing
- Automatic cross-device sync using a shared code and Firebase Realtime Database
- No app login, signup, password, or approval flow
- Android APK build through GitHub Actions

## Enable automatic sync (one-time setup)

The app uses Firebase Realtime Database's REST and realtime streaming endpoints. No Firebase SDK, app account, or authentication is used.

1. Open the [Firebase Console](https://console.firebase.google.com/) and create a project.
2. In **Build → Realtime Database**, create a database. Choose a region and copy its database URL (for example, `https://your-project-default-rtdb.firebaseio.com` or the `.firebasedatabase.app` format).
3. Open the Realtime Database **Rules** tab and use these rules:

```json
{
  "rules": {
    "spaces": {
      "$sharedCode": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

4. Publish the rules.
5. Open the app on the first device → **Account** → paste the database URL → **Save database URL** → **Create a new shared space**.
6. Copy the generated shared code.
7. On every other device, open **Account**, enter the same database URL and shared code, then tap **Join with code**.

After joining, expense, group, friend, and settlement changes are sent to the shared database and streamed to connected devices. Each device also keeps a local copy so it can display the last synced data while offline. Live updates require an internet connection.

### Important note about the no-auth setup

These rules deliberately allow public read/write access under the `spaces` path because this app has no authentication, as requested. The shared code is a locator, not a secure password. Anyone who obtains the database URL and a space code can read or change that space. Do not use this setup for sensitive or financial-account credentials.

## Deploy

This is a static HTML app and deploys to Vercel from the connected GitHub branch. Every push to `main` triggers a deployment.

## Android

The repository includes a GitHub Actions workflow that builds a debug APK and uploads it as an Actions artifact. Install the APK on each Android device, then join the same shared space code.

## Local development

Open `index.html` in a browser. Cloud sync requires an HTTPS-hosted app and a Firebase Realtime Database configured as described above.
