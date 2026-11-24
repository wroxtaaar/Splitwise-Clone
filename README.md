# Splits

A personal shared-expense tracker: groups, friends, uneven splits and settle up. Mobile-first, works offline,
and can sync between your own devices. No accounts, no build step, no dependencies to run it.

## Features

- Groups, friends and non-group expenses
- Four split types: equally, exact amounts, percentages, shares (always add up to the paise)
- Group balances are simplified to the fewest payments; non-group balances stay pairwise
- Settle up from a group or a friend; a payment spreads across the groups where the money is actually owed
- Edit and delete expenses and payments, notes, search, activity feed
- Dark and light themes (follows the system, or choose in Account)
- Works offline (localStorage + service worker); JSON backup and restore
- Optional sync across devices through Firebase Realtime Database (per-record merge, so two devices
  adding expenses at the same time don't overwrite each other)
- Android APK built by GitHub Actions (Capacitor)

## Run it

```bash
npm run dev      # serves the folder at http://localhost:8080 (needs python3)
npm test         # unit tests for the money logic (Node 20+, no installs)
```

Any static host works (Vercel, GitHub Pages, Netlify…): publish the repository root.

## Sync between devices (optional, one-time setup)

1. Create a Firebase project and a **Realtime Database**; copy its URL.
2. In **Rules**, publish:
   ```json
   { "rules": { "spaces": { "$code": { ".read": true, ".write": true } } } }
   ```
3. On the first device: **Account → Sync** → paste the URL → **Create new space**. Note the code.
4. On other devices: paste the same URL and code → **Join with code**.

There is no login: anyone with the database URL **and** the code can read and change that space. The code is
random and 8 characters long, so keep both private and don't store anything sensitive in the app.

## Android

`.github/workflows/build-android-apk.yml` runs the tests, copies the web app into a Capacitor project and
uploads a debug APK as a build artifact. Locally: `npm install && npm run android:sync`.

## Layout

```
index.html          app shell
css/styles.css      theme + layout
js/logic.js         pure money logic (splits, balances, debt simplification) — unit tested
js/store.js         local-first store with tombstones, persisted to localStorage
js/sync.js          Firebase REST + EventSource sync
js/model.js         derived data for the screens
js/ui/              views, forms (sheets), helpers
js/app.js           routing, actions, boot
tests/              node:test unit tests
```

Amounts are stored as integer paise, so there are no floating-point errors.
