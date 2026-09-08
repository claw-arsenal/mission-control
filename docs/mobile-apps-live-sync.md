# Mobile Applications: how updates reach the screen

Audit: `docs/mobile-apps-audit-2026-09-08.md`. Design: `docs/superpowers/specs/2026-09-08-mobile-apps-live-sync-and-ux-design.md`.

## The path a change takes

A sync, the report worker, or the database trigger publishes a typed change on the `mobile_apps_change` channel. The stream route parses it, collapses a burst into one change per kind, app, listing and job, and forwards it to every open browser with an id and a reconnect delay. The client store routes the change to the slice it names.

| Change kind | Published by | The browser re-reads |
| --- | --- | --- |
| `reviews` | a listing sync that inserted rows; the `app_reviews` trigger | the core slice, plus a review delta |
| `listing` | a listing sync, after the listing row is written | the core slice |
| `reports` | the worker, per Google listing, after rollups | the reports slice if it is held |
| `job` | the job queue on enqueue, the worker on claim and finish | the job state; on a terminal status, the reports slice |
| `app` | adding or removing a tracked app | the app list |

The legacy `{appId}` payload from the database trigger is still understood and read as a `reviews` change, so a partially deployed system keeps working.

## What the browser holds

One store serves both pages. It hydrates from `localStorage` before the first request, so a reload or a return from the list shows the last known data immediately rather than a skeleton. It keeps one change stream open across navigation, supersedes in-flight requests per app and per slice, and revalidates when the stream reconnects, when the browser comes back online, and when a hidden tab is shown again after a minute.

Failures keep the last data on screen and explain themselves next to what failed, with the time the data was read and a retry. A report job that stops emitting changes for ten seconds falls back to polling its status every five.

The cache stores the app list and, per app, the core payload and the report series. Breakdowns and the file index are not persisted, and a quota failure retries without the reports before giving up silently.

## Cost of opening a page

Opening an app asks for a freshness check rather than forcing one. The live store call respects the normal dedupe window, and a stored report-freshness verdict younger than five minutes is reused instead of listing the bucket again. Manual Refresh still forces both. The background review monitor already polls every store on its own cadence, so a page open no longer duplicates that work.

Opening an app reads the core slice only. The Play Console series, breakdowns and file index load on the first visit to the Reports section.

## Limits worth stating

The stores are not real-time and this does not change that. The Play Reviews API surfaces a new review within about a day, App Store Connect within hours, and Play Console exports lag by a day or more. What is now immediate is the hop from the database to the screen.

A missed notification is not fatal: reconnecting, coming back online, and returning to a hidden tab all revalidate.

## Verification

Verified on 8 September 2026 against the repository, not a deployment.

- `npm test`: 395 passed and 25 skipped across 81 files. The run covers the whole repository, so it includes work outside this module.
- Against a disposable PostgreSQL 15.19 database, with `MOBILE_REPORTS_TEST_DATABASE_URL` and `MOBILE_REVIEWS_TEST_DATABASE_URL` set, the normally skipped database suites also run: **417 passed, 5 skipped across 82 files**, and all 248 Mobile Applications tests pass. This exercised the new list-facts query, review upserts, the job ledger, the worker, rollups and freshness against a real server.
- `npm run typecheck` and `npm run lint`: no errors.
- `npm run build`: compiled successfully; both Mobile Applications routes render on demand as before.
- New suites: `lib/mobile-apps/change-events.test.ts`, `lib/mobile-apps/client/live-store.test.ts`, `lib/mobile-apps/list-route.test.ts`, `lib/mobile-apps/list-facts-postgres.test.ts`, `components/mobile-apps/mobile-apps-client.test.tsx`, `components/mobile-apps/app-detail-client.test.tsx`, plus extended stream, detail, ensure-fresh, reviews, worker and review-hook suites.
- The fixture preview (`npm run preview:mobile-apps`, then `http://127.0.0.1:4173/tests/previews/mobile-apps.html`) now publishes typed changes, drops and restores the connection, injects new reviews, and switches between the list and the detail page. It uses no credentials and no database.

Live store credentials, the deployed worker, and a full screen-reader pass were not exercised here. The database checks used a throwaway container, not the project's own database.

## Migration notes

`fetched_at` on `app_reviews` now advances only when a review's rating, title, body or developer response changed. Existing rows keep their current value; the first sync after deployment will not mark unchanged reviews as new.

No schema migration is required. The change channel, the freshness table and the job ledger are unchanged.
