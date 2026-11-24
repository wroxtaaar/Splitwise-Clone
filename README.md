# Splitwise Clone

A responsive, browser-based expense-sharing app inspired by the familiar Splitwise workflow.

## Included in this first version

- Dashboard with amounts owed, amounts you owe, and net balance
- Create groups and add friends
- Add shared expenses with equal or custom splits
- Choose who paid, date, and optional group
- View recent expense activity
- View net balances and record settlements
- Responsive layout for desktop and Android/mobile browsers
- Demo data on first visit; app data is saved in the browser using localStorage

## Deploy

This is a static HTML app. It can be deployed directly on Vercel with:
- Framework preset: Other
- Build command: leave empty
- Output directory: leave as default (or `.` if Vercel requires a value)
- Install command: leave empty

Every push to the connected production branch will trigger a Vercel deployment.

## Current limitations

This is an initial frontend prototype. Data is stored only in the current browser on the current device. It does not yet have accounts, cloud sync, invitations, or a shared database. Clearing browser storage will clear the locally saved demo data.

## Run locally

Open `index.html` in a browser. No package installation or build step is required.
