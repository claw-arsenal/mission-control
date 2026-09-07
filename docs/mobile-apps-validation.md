# Mobile Applications reliability changes

Report jobs now own ingestion, chart rebuilds, completion, and freshness in that order. The worker reserves one PostgreSQL connection for its advisory lock and claims only the job it is about to process. A listing target stays limited to that listing. Manual requests are polled every five seconds; the scheduled refresh cadence remains thirty minutes by default.

Each report generation commits as one transaction. An interrupted download leaves the previous metrics available. A successful metric replacement removes rows that disappeared from the new export. Streams enforce the configured byte limit, handle split encoding headers, and close when parsing or consumption stops.

The app-detail resource owns loading, refresh, notifications, polling, cancellation, and errors. Review pagination cancels requests when filters change. Cached content remains visible during refresh and failures. Country selection keeps the country, value, and source together; a country without an official rating displays no rating.

## Database repair

Older writes passed serialized JSON directly to a PostgreSQL JSON parameter. postgres.js could serialize that string again, leaving a JSON string where calculations expected an object or array. New writes explicitly bind text before casting to JSON.

On first module initialization, `json_storage_v1` repairs these legacy values transactionally. The migration records completion in `mobile_apps_migrations`, tolerates malformed legacy strings, and queues one incremental chart rebuild if raw report metrics changed. Subsequent initializations skip the repair. The module's cleanup handler owns the migration table too.

Deploy the web process and report worker together. Stop the old worker before starting the updated processes so it cannot write the old JSON representation after the repair. Normal database backups should be in place before deployment. This repository change has not been deployed to a live environment.

## Validation

Verified on 7 September 2026: all 224 tests across 43 files passed, including nine tests against PostgreSQL 15.18. Type checking, lint, and the production build passed; the build emitted no warnings. `npm audit` reported zero known vulnerabilities. Browser validation used the fixtures described below.

Run the normal checks with `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.

For the real PostgreSQL tests, set `MOBILE_REPORTS_TEST_DATABASE_URL` to a disposable PostgreSQL 15+ database and run `npm run test:mobile-reports:postgres`. The suite creates and removes a uniquely named schema; it verifies locking, concurrent enqueue deduplication, sequential claims, transactional imports, rollups, empty generations, freshness ordering, and legacy JSON repair. Without that variable, these database tests are skipped.

Run `npm run preview:mobile-apps` and open `http://127.0.0.1:4173/tests/previews/mobile-apps.html` for local dashboard and document-editor fixtures. The preview intercepts its requests locally and uses no store credentials or database. Controls exercise theme changes, narrow layouts, connection failure and recovery, country selection, and report refresh.

Browser checks covered a 390px viewport, light and dark themes, keyboard country selection, error recovery with cached content, reduced-motion report refresh, and editor formatting/undo. The preview is a fixture test; live Google Play/App Store credentials and production infrastructure were not exercised.

## Dependency updates

Security updates include Next.js, Google Cloud Storage, ZIP handling, and Tiptap 3. The editor disables duplicate StarterKit extensions, preserves toolbar updates, and loads external documents without emitting an edit. The lockfile also updates vulnerable transitive packages.

Two scoped overrides remain: DOMPurify 3.4.15+ for Monaco's pinned sanitizer, and UUID 11.1.1+ for gaxios's older UUID dependency. The latter calls the compatible CommonJS `v4()` interface. Revisit these overrides when the upstream dependency ranges include patched versions.

Dynamic filesystem paths used by the file manager, runtime identity/skills readers, and service/system controls are intentionally excluded from build tracing. Those files belong to the running OpenClaw installation; they are not bundled application assets.
