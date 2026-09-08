# Mobile Applications live sync and UX — implementation plan

Spec: `docs/superpowers/specs/2026-09-08-mobile-apps-live-sync-and-ux-design.md`. Each task is test-first; run `npm test -- <file>` for the unit under work, and `npm run typecheck && npm run lint && npm test` at the end of each phase.

## Phase 1 — server change vocabulary and cheaper reads

1. `lib/mobile-apps/change-events.ts` + test: types, `publishChange`, `parseChange` (legacy `{appId}` → `reviews`), `coalesceChanges`.
2. Emit typed changes: `sync.ts` (`listing`, `reviews` with `inserted`), `report-worker.ts` (`job` on claim/finish, `reports` per Google listing), `app/api/mobile-apps/route.ts` (`app` on POST/DELETE). Update existing tests that assert on `pg_notify`.
3. Stream route: `hello`, ids, `retry`, coalescing. Extend `stream-route.test.ts`.
4. Detail route: `include` slices, `asOf`. Extend `detail-route.test.ts`.
5. Ensure-fresh: `force` default false, `reportMaxAgeSeconds` reuse of stored freshness. Extend `ensure-fresh-route.test.ts`.
6. Reviews route: `responded`, `fetchedSince`, `fetched_at`, `asOf`, `format=csv`. Extend `reviews-route.test.ts`.
7. List route: `facts` per app. Extend `routes.test.ts`.

## Phase 2 — client store

8. `lib/mobile-apps/client/live-store.ts` + `live-store.test.ts`: hydration, subscribe/snapshot, list and app loading, event routing, superseding, connection state, online/visibility revalidation, job fallback polling, persistence bounds.
9. Browser adapters: `lib/mobile-apps/client/browser-deps.ts` (fetchJson, EventSource stream, localStorage storage) and a singleton `getMobileAppsStore()`.
10. Hooks: rewrite `use-mobile-app-detail.ts`, add `use-mobile-apps-list.ts`, `use-live-connection.ts`; rewrite `use-mobile-app-reviews.ts` with delta/pending. Update hook tests.

## Phase 3 — UI

11. Shared pieces: `live-status-pill.tsx`, `announcer.tsx` (aria-live), `keyboard-shortcuts.ts` hook, `use-url-state.ts`.
12. List page: toolbar (search, sort), facts row, freshness pill, cached/offline banner, skeleton only without cache. Test.
13. Detail page shell: masthead, facts strip, URL-synced tabs with lazy panes and crossfade, overflow menu (export, open in store, remove app). Test.
14. Reviews tab: filter bar, new-reviews control, infinite load, "New" dots, keyboard shortcuts, compact review card. Test.
15. Ratings, Reports (job timeline, open by default), Insights panes. Dynamic-import charts.
16. Preview harness: typed events, offline toggle, new-review injection.

## Phase 4 — verification and docs

17. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
18. Update `CONTEXT.md` (Change, Live status, New reviews, Facts), `docs/mobile-apps-validation.md`, `PRODUCT.md` anti-reference wording, memory notes.
