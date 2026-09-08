# Mobile Applications audit — 8 September 2026

Scope: the Mobile Applications module end to end. Pages `/mobile-apps` and `/mobile-apps/[id]`, their client hooks, the eleven API route handlers under `app/api/mobile-apps`, the sync library, the report worker, the review monitor, the change stream, and the schema. Evidence is source inspection plus the existing test suites. No live store credentials were exercised.

The module's data pipeline is sound: heavy work is worker-owned, jobs are locked and heart-beaten, freshness is a stored contract, and every metric carries a source label. What is missing is the last hop. Changes reach PostgreSQL promptly, but the browser learns about them late, reloads far more than it needs to, and forgets everything on navigation.

## Why updates are not real-time

| # | Finding | Effect | Where |
| --- | --- | --- | --- |
| R1 | Opening an app forces a live store sync and five Google Cloud Storage listings before the "checking stores" state clears. The background review monitor already polls every store every 60 seconds by default, so the page-open sync duplicates it. | Every visit spends 2–30 s in a syncing state and consumes store API quota; nothing new is learned that the monitor would not have found. | `hooks/use-mobile-app-detail.ts` `start()`, `app/api/mobile-apps/[id]/ensure-fresh/route.ts` (`force: true`, `checkOfficialReportFreshness` per listing) |
| R2 | Change notifications carry only `{appId}`. The client cannot tell a new review from a finished report job, so every notification reloads the whole detail payload (reports, up to 500 breakdown rows, the file index) and resets the reviews list to page one. | A single new review costs a full reload; a worker import costs a full reload every 500 ms; the operator's reading position and loaded pages are lost. | `app/api/mobile-apps/stream/route.ts`, `lib/mobile-apps/sync.ts` (`pg_notify`), `lib/mobile-apps/report-worker.ts` `notifyChange`, `hooks/use-mobile-app-detail.ts` `invalidate` |
| R3 | Each detail mount opens its own EventSource; the list page has none. Nothing is cached across navigation or reloads. | The list never updates while open; going back to the list shows skeletons; a reload or a dropped network shows nothing instead of the last known data. | `hooks/use-mobile-app-detail.ts`, `components/mobile-apps/mobile-apps-client.tsx` |
| R4 | The stream's `error` event is ignored and there is no revalidate on `online`, focus, or tab visibility. | A dead connection looks live; a laptop that sleeps wakes with stale data and no indication. | `hooks/use-mobile-app-detail.ts` |
| R5 | The detail payload is monolithic. Play report series, breakdowns and file index load even on the App Store view and even when the reports section is collapsed (its default). | Slow first paint on Google apps; wasted work on every reload from R2. | `app/api/mobile-apps/[id]/route.ts` |
| R6 | Report job progress is visible only as queued/running via 5 s polling; job completion also arrives over the stream, so the two race and both trigger reloads. | Operators cannot tell a 10 s job from a 10 min one. | `hooks/use-mobile-app-detail.ts` `pollReportJob` |
| R7 | Store, rating, search, sort and the open reports section live in component state only. | Reload, back navigation and shared links drop the operator's context, contrary to the product principle "preserve the user's current app, filters, and reading position". | `components/mobile-apps/app-detail-client.tsx`, `components/mobile-apps/reviews-stream.tsx` |

Not a defect, but a limit to state plainly in the UI: the stores themselves are not real-time. The Play Reviews API surfaces new reviews within about a day, App Store Connect within hours, and Play Console CSV exports lag by a day or more. "Real-time" for this module means the browser reflects the database the instant it changes, and the database reflects the stores as fast as their APIs and quotas allow.

## UI and UX findings

- One long column. Score card, metadata, reports, reviews and charts stack vertically; on a phone the reviews are several screens down and the store switch is in the header, far from the content it changes.
- Refresh feedback is a toast, and success toasts fire on every manual refresh. Failures appear in a banner at the top even when the failing section is off-screen.
- The Play reports section is collapsed by default and shows a placeholder explaining that it is collapsed.
- Reviews reset on every change (R2). There is no "new reviews" affordance, no unread marker, no needs-reply filter, no date range, no export, no keyboard support, and no infinite loading.
- The list page shows only store badges. It gives no sense of activity, sync health or report freshness, and has no search or sort.
- Accessibility: charts have no text alternative; many controls use 10–11 px text and 24–28 px targets; status is announced only visually; several buttons lack `type`; the "By country" list is unbounded.
- Motion: pulses and spins are gated behind `motion-safe`, which is right, but there is no transition for tab or content changes, and new content pops in with no orientation cue.
- Performance: recharts is bundled into the detail route's first load; the whole detail tree re-renders on every store change; nothing is lazy.

## What already works and is kept

- Worker ownership of heavy ETL, the advisory lock, heartbeats and stale-job reaping.
- The freshness contract (`fresh / refreshing / stale / failed / unknown / not_configured`) and its ordering.
- Source labelling on every number and the rule that the list page shows no rating.
- Abort-on-supersede in the detail and review hooks, and cached content staying visible through failures.
- The preview harness under `tests/previews/mobile-apps.tsx`.

The redesign that addresses these findings is in `docs/superpowers/specs/2026-09-08-mobile-apps-live-sync-and-ux-design.md`.
