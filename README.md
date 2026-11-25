# Expense

A personal shared-expense tracker for two people (and their phones). Groups, friends, settle up, a Splitwise-style
layout, no limits on how many expenses you add. Works offline and syncs automatically through your own Supabase project.

## Features

- Groups, friends and non-group expenses; settle up from a group or a friend
- Each person signs in once per phone. "You" always means the person holding the phone,
  so one phone shows "you owe Wasiq" while the other shows "Papa owes you"
- Syncs automatically: on open, after every change, when the app returns to the foreground and every few seconds while open
- Works offline: changes are kept on the phone and uploaded when the connection is back (an "Offline" chip shows meanwhile)
- Two phones adding expenses at the same time never overwrite each other (each record syncs on its own, newest edit wins)
- Edit and delete expenses and payments, notes, search, activity feed, dark/light theme, JSON backup and restore
- Amounts are stored as whole paise, so there are no rounding errors
- Android APK built by GitHub Actions (Capacitor)

## Set up sync (one time, about 10 minutes)

1. Create a free project at [supabase.com](https://supabase.com). Wait until it finishes starting.
2. **Authentication → Users → Add user → Create new user.** Create one user for each person (email + password) and tick
   **Auto Confirm User**.
3. **SQL Editor → New query.** Open `supabase/setup.sql`, replace the two example emails with the two real ones,
   paste it in and press **Run**. It creates the table and makes sure only those two emails can read or write anything.
4. **Authentication → Sign In / Providers → Email:** switch off **Allow new users to sign up** so nobody else can create an account.
5. **Project Settings → API:** copy the **Project URL** and the **anon public** key.
   Paste them into the app's sign-in screen the first time, or put them in `js/config.js` so the phones never ask.
   The anon key is meant to be public. **Never** use the `service_role` key anywhere in this app.
6. Sign in on each phone with its own email and password. The first time, the app asks for your name
   (this is what the other person sees).

Free projects can be paused after about a week without any activity. You use the app daily, so this should not happen,
but if it does, un-pause the project from the Supabase dashboard.

## Run it

```bash
npm run dev      # serves the folder at http://localhost:8080 (needs python3)
npm test         # unit tests (Node 20+, nothing to install)
```

Any static host works (Vercel, GitHub Pages, Netlify…): publish the repository root.

## Android

`.github/workflows/build-android-apk.yml` runs the tests, copies the web app into a Capacitor project and uploads a
debug APK as a build artifact (Actions → latest run → Artifacts). Locally: `npm install && npm run android:sync`.

## Layout

```
index.html            app shell
css/styles.css        theme + layout
js/logic.js           pure money logic (splits, balances, debt simplification), unit tested
js/store.js           local-first store: tombstones, "still to upload" tracking, per-user storage
js/auth.js            Supabase email + password sign-in (plain fetch)
js/sync.js            pull / push with Supabase, retries, offline handling
js/config.js          your project URL + anon key (optional)
js/model.js           derived data for the screens
js/ui/                views, forms (sheets), helpers
js/app.js             sign-in flow, routing, actions
supabase/setup.sql    table, newest-edit-wins rule and security policies
tests/                node:test unit tests
```

Other backends are possible: only `js/auth.js` and `js/sync.js` talk to the server.

## Push notifications (Android app)

When one of you adds, edits or deletes an expense or a payment, the other person's phone gets a notification
("Papa added “WiFi Bill” in “Home Expenses” · You owe ₹250.00"), even when the app is closed.

Parts: the app registers the phone's Firebase token → a database trigger fires on every change → the `notify`
Edge Function sends the push through Firebase Cloud Messaging.

1. **Firebase** (console.firebase.google.com): create a project (Analytics off) → add an **Android app** with package
   name `com.wroxtaaar.splits` (the app is called Expense; the id stays the same so Firebase and installs keep working) → download `google-services.json` and commit it as `firebase/google-services.json`
   (it is not secret). Then Project settings → **Service accounts** → *Generate new private key*. Keep that file private.
2. **Supabase → SQL Editor**: run `supabase/push.sql`, then run this with your own random `SECRET`:
   `insert into push_config (id, url, secret) values (1, 'https://<project>.supabase.co/functions/v1/notify', 'SECRET') on conflict (id) do update set url = excluded.url, secret = excluded.secret;`
3. **Supabase → Edge Functions → Deploy a new function** named `notify`: paste `supabase/functions/notify/index.ts`,
   turn **Verify JWT off**, deploy.
4. **Edge Functions → Secrets**: add `PUSH_SECRET` (the same `SECRET`) and `FIREBASE_SERVICE_ACCOUNT` (the whole
   contents of the private key file from step 1). Optional: `CURRENCY` (default ₹).
5. Rebuild the APK, install it, open it and allow notifications. Account → Notifications shows the status.
