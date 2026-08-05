# Zapp Pay Admin Console

Internal back office. Vite + React + TypeScript, deployed to its own Firebase
Hosting site so the admin origin is separate from the marketing pages.

Scope today (ADMIN_CONSOLE_PLAN.md phase D): customer lookup, freeze/reactivate,
clear lockouts, revoke trusted devices, and the role application queue. KYC
review and the float desk are phases E and F.

## How it talks to the backend

Every read and write goes through an `admin*` callable in `functions/src/admin/`.
The console never touches Firestore directly, so `firestore.rules` stays as
closed for admins as it is for customers, and each action carries its own
authorization check and audit entry.

Authority comes from Firebase Auth custom claims (`admin`, `adminRoles`), which
can only be set with `scripts/set-admin-claim.js`. There is deliberately no
callable that grants admin.

## Setup

```bash
cd admin
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

The values come from a **Web** app in the Firebase console (project
`quickpay-485417`) under Project settings → Your apps. They are not secrets —
they ship in the browser bundle — but they are per-project, so they are not
committed.

Grant yourself access, then sign in with that Google account:

```bash
node ../scripts/set-admin-claim.js you@example.com super
```

Custom claims land in the ID token, so a newly granted role only appears once
the token refreshes. The "No access" screen has a re-check button that forces it.

## The build inlines your config — do not skip .env

`import.meta.env` is substituted at **build** time, not runtime. Without the
variables, the `configError` constant folds to a truthy literal, the early
return in `<App>` becomes unconditional, and Rollup eliminates the whole console
as unreachable. The build still succeeds and still emits a plausible bundle —
one that can only ever render "Not configured".

`vite.config.ts` therefore fails the build when the config is missing. If you
ever want that stub deliberately, set `ALLOW_UNCONFIGURED_BUILD=1`.

## App Check

The admin callables run with `enforceAppCheck: true`. Register the admin origin
under Firebase console → App Check with reCAPTCHA Enterprise and put the site
key in `VITE_APPCHECK_SITE_KEY`, or every request comes back unauthorised. The
build warns when the key is absent.

For local development, register a debug token in the App Check console and set
`VITE_APPCHECK_DEBUG=true`. Never set that in a deployed build.

## Deploy

One-time, to create and map the second Hosting site:

```bash
firebase hosting:sites:create zapp-admin
firebase target:apply hosting admin zapp-admin
firebase target:apply hosting public quickpay-485417
```

Then:

```bash
npm run build
firebase deploy --only hosting:admin
```

`firebase.json` serves `admin/dist` with `no-store` and `noindex`, and rewrites
everything to `index.html` for client-side routing.
