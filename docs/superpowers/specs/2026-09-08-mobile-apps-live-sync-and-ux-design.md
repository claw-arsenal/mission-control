# Mobile Applications: live sync, cached state, and UX overhaul — design

**Date:** 2026-09-08
**Status:** Approved for implementation (autonomous goal; decisions recorded here for review)
**Audit:** `docs/mobile-apps-audit-2026-09-08.md`

## Goal

The browser reflects the database the moment it changes, shows last-known data instantly and offline, never loses the operator's place, and the two pages become fast, navigable and pleasant to work in every day.

## Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Where does "instant" come from? | Typed PostgreSQL notifications forwarded over one shared SSE connection. No client polling except as a fallback while a report job is running. | The database is already the contract between web, worker and monitor. |
| Does opening a page still sync the stores? | It asks for a *cheap* freshness check. The live store call respects the normal dedupe window; the report check reuses a freshness row younger than five minutes. Manual Refresh keeps forcing. | The review monitor already syncs every 60 s. Page opens should not double that or hold the UI in a syncing state. |
| Where is the client cache? | One module-level store shared by both pages, persisted to `localStorage`, hydrated before the first request. | Instant back navigation, instant reload, readable offline. IndexedDB is not needed at this data size. |
| How much reloads on a change? | Only the slice the event names: reviews → core payload plus a review delta; reports or job → the reports slice; app → the list. | Ends the full-reload-per-notification problem. |
| Do reviews reset on a change? | No. New rows are fetched by `fetchedSince` and held behind a "N new reviews" control until the operator asks for them. Loaded pages and scroll position are kept. | Product principle: preserve reading position. |
| Visual language | Keep the dashboard theme tokens and shadcn controls. The overhaul is information architecture, interaction, feedback and motion, not a new look. | `PRODUCT.md`: preserve the existing style. |
| Where do filters live? | In the URL search params of the detail page. | Reload, back, and shared links preserve context. |
| What does the list show per app? | Facts only: new reviews in 7 days, negative in 7 days, last checked, sync health, report freshness. No rating. | Data-honesty rule: a single headline rating in a list is ambiguous. |

## Server design

### `lib/mobile-apps/change-events.ts` — the change vocabulary

One deep module owns what a change is and how it travels.

```ts
type ChangeKind = "reviews" | "listing" | "reports" | "job" | "app";
type MobileAppsChange = {
  kind: ChangeKind;
  appId: string | null;        // null = affects every app (global worker pass)
  listingId?: string;
  store?: "apple" | "google";
  jobId?: string;
  jobStatus?: "queued" | "running" | "success" | "partial" | "failed" | "skipped";
  inserted?: number;           // reviews: rows newly inserted
  at: string;                  // ISO time of publication
};
publishChange(sql, change): Promise<void>   // pg_notify('mobile_apps_change', json)
parseChange(payload: string): MobileAppsChange | null   // tolerates the legacy {appId} shape → kind "reviews"
coalesceChanges(changes): MobileAppsChange[]            // one per (kind, appId, listingId); latest wins
```

Emitters: `syncListing` (kind `listing` after the listing row updates; `reviews` when `inserted > 0`), `syncApp` no longer sends its own untyped notify; the worker publishes `job` on claim and on finish and `reports` per Google listing after rollups; the app routes publish `app` on create and delete. The database trigger keeps its own `{appId}` notify; `parseChange` maps it to `reviews`. PostgreSQL deduplicates identical payloads inside one transaction, which bounds trigger fan-out during CSV imports.

### Stream route

Forwards typed events as `event: change` with an `id:` and a `retry: 3000` directive. The 500 ms window now coalesces with `coalesceChanges`. Adds `event: hello` carrying `{ serverTime }` so clients can set watermarks from the server clock.

### Detail route

Accepts `include=core,reports` (default both). `core` is app, listings, summary, trend, sync runs, freshness. `reports` is rollups, breakdowns, traffic sources, file index. Adds `asOf` (server time) to the response.

### Ensure-fresh route

Body gains `force` (default `false`) and `reportMaxAgeSeconds` (default 300). With `force: false` the live sync uses the normal dedupe window. When every Google listing's stored freshness row was checked within the max age and is not `stale`/`unknown`, the GCS listing is skipped and the stored verdict returned. Manual Refresh in the UI still calls `/sync` with `force: true`.

### Reviews route

Adds `responded=true|false`, `fetchedSince=<iso>` (rows whose `fetched_at` is after the mark), and `format=csv` (same filters, at most 5 000 rows, `text/csv` attachment). Rows now include `fetched_at`. The response carries `asOf`.

### List route

Each app gains `facts`: `reviewsLast7d`, `negativeLast7d`, `lastCheckedAt`, `syncFailed` (any listing's latest run failed), `reportsStatus` (worst stored freshness among Google listings, or `not_configured`). Computed in SQL in the existing query.

## Client design

### `lib/mobile-apps/client/live-store.ts` — the deep module

Framework-free. Everything both pages need sits behind one interface; hooks are thin adapters.

```ts
createMobileAppsStore(deps: {
  fetchJson(url, init?): Promise<unknown>;
  openStream(url, on: { hello, change, open, error }): () => void;   // adapter over EventSource
  storage: { load(): Snapshot | null; save(s: Snapshot): void };      // adapter over localStorage
  now(): number;
  online(): boolean;                                                  // navigator.onLine
})
```

State (one snapshot, subscribable): `connection: "connecting" | "live" | "reconnecting" | "offline"`, `list: { apps, loadedAt, error, loading }`, `apps[id]: { core, reports, loadedAt, refreshing, refreshingReports, job, error, coreRev, reportsRev, reviewsRev, pendingReviews }`.

Behaviour:

- **Hydration.** Constructed from `storage.load()`; the first render is the last-known snapshot with `loadedAt`, so pages never skeleton when a cache exists.
- **One connection**, opened lazily by the first subscriber and kept across navigations. `error` → `reconnecting`; `open` after an error → revalidate everything mounted. `online`/`offline` window events and `visibilitychange` (hidden > 60 s) revalidate.
- **Event routing.** `reviews`/`listing` → reload core for that app (or all mounted apps when `appId` is null) and bump `reviewsRev`; `reports` → reload the reports slice and bump `reportsRev`; `job` → update `job` on the app, and on a terminal status reload reports; `app` → reload the list.
- **Request discipline.** Per-app, per-slice AbortControllers; a superseded response is discarded. Failures keep the last data and set `error`; a failed request while `online()` is false sets `connection = "offline"`.
- **Job fallback.** While an app has a non-terminal job and no event arrived for 10 s, poll `reports/status` every 5 s.
- **Persistence.** `save()` after every successful load, debounced 250 ms. Payload: list, and per app the core plus the report series without breakdowns and files (bounded). On quota errors it retries without reports, then gives up silently.

Hooks: `useMobileAppsList()`, `useMobileAppDetail(appId)`, `useLiveConnection()`. `useMobileAppReviews(appId, filters)` keeps its own pages; it subscribes to `reviewsRev` and on change fetches `fetchedSince=<watermark>` for the current filters, exposing `pending` (count and rows). `showPending()` prepends them (newest sort) or reloads page one (other sorts). Watermarks come from `asOf` on responses.

Deletion test: removing the store puts connection handling, caching, routing and job polling back into two hooks and a page, as today. It earns its keep. The interface is the test surface: store tests use fake `fetchJson`, `openStream`, `storage`.

## UI design

### List `/mobile-apps`

Header carries the live status pill (Live · Reconnecting · Offline, showing data from HH:MM) and Add app. A toolbar offers name search and sort (name, most new reviews, last checked). Cards show icon, name, store badges and a facts row, plus a report-freshness pill for Google and a red "sync failed" badge when the latest run failed. Skeletons appear only when there is no cache. Errors keep the cards and show a retry banner.

### Detail `/mobile-apps/[id]`

URL state: `store`, `tab`, `rating`, `q`, `sort`, `range`, `needsReply`.

- **Masthead** (sticky, compresses on scroll): icon, name, store segmented control, status line (Live · checked 2 m ago / Refreshing… / Offline · data from 10:32), Refresh, and an overflow menu (Export reviews CSV, Open in store, Remove app with confirmation).
- **Facts strip**: stored written reviews, negative, needs reply (no response and ≤ threshold), reply rate; each with its source badge.
- **Tabs** (Radix, URL-synced, lazily mounted, crossfade unless reduced motion): **Reviews** (default), **Ratings**, **Reports** (Google only), **Insights**.
  - *Reviews*: filter bar (rating chips, Needs reply, range 7d/30d/90d/all, search, sort); a sticky "N new reviews" control that appears with a spring and inserts rows highlighted on acceptance; infinite loading via IntersectionObserver with a manual fallback; "New" dot on rows fetched since the last visit (`localStorage` per app); keyboard: `/` search, `j`/`k` move, `o` open in store, `t` translate, `c` copy, `r` refresh, `1`–`5` rating filter, `Esc` clear.
  - *Ratings*: store score card, trend chart with a visually hidden data table, By country limited to eight rows with Show all.
  - *Reports*: Play reports open by default; freshness pill plus job timeline (queued → running since → finished/failed with message); Refresh reports.
  - *Insights*: AI digest and store metadata cards.
- **Feedback**: one `aria-live="polite"` region announces refresh results, connection changes and new-review counts. Failures render next to the affected section with a retry. No success toasts; toasts only for actions with no visible target (export started, app removed).
- **Accessibility**: 40 px minimum targets on touch, 12 px minimum text, all buttons typed, icon-only controls labelled, focus rings from the global rule, reduced-motion honoured through `useReducedMotion`.
- **Performance**: charts and the reports tab are `next/dynamic` chunks; tab panes mount on first visit only; review rows are memoised.

## Error handling

- Load failure with cache → keep content, show an inline banner with time of the cached data and Retry.
- Load failure without cache → empty state with the error and Retry.
- Stream failure → status pill turns to Reconnecting; after 30 s without success and `navigator.onLine === false`, Offline.
- Report job failure → job timeline shows the message; freshness pill turns to Refresh failed.

## Testing

- `change-events.test.ts`: parse legacy and typed payloads, coalescing.
- `stream-route.test.ts` (extend): coalesced typed events, ids, hello.
- `detail-route.test.ts` (extend): `include` slices, `asOf`.
- `ensure-fresh-route.test.ts` (extend): default no force, max-age reuse, explicit force.
- `reviews-route.test.ts` (extend): `responded`, `fetchedSince`, CSV.
- `live-store.test.ts`: hydration, routing per kind, superseding, offline transition, reconnect revalidation, job fallback, persistence bounds.
- `use-mobile-app-reviews.test.tsx`: pending delta, accept, page preservation.
- Component tests: list facts and sort, detail tabs and URL sync, new-reviews control, keyboard shortcuts.
- Manual: preview harness at `tests/previews/mobile-apps.tsx` updated for typed events and offline toggling; 390 px and 1366 px, both themes, reduced motion.

## Out of scope

Replying to reviews from the dashboard, a service worker for full offline navigation, push notifications, per-user server-side preferences, and changes to store polling cadence beyond the existing settings.
