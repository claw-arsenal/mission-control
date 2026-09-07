# Metrics review and usage guide

Reviewed 7 September 2026. Scope: the supplied 12-definition export, Metrics dashboard, editor, import/export, query execution, and definition storage. The supplied JSON contains definitions and SQL, not measured result rows.

## Changes that matter most

| Priority | Finding | Implemented change |
| --- | --- | --- |
| High | Return rates were plotted with supporting player counts on one axis; recent signup groups had unequal observation time. | Plot the two percentages only. Keep counts in Table. Include only signup periods with a full 28-day observation window. |
| High | Labels inferred abandonment, Android usage, or played games from weaker evidence. | Rename these to rooms without a recorded end, non-iOS mobile devices, and rooms created. Explain populations and limitations. |
| High | Refreshes discarded good results; overlapping requests could show an older response for a new selection. | Cancel obsolete work, guard late responses, retain successful results during refresh failures, and provide retry actions. |
| High | Import could partially save or silently skip errors; updates used several statements. | Validate the complete file and SQL before writing, use a workspace-scoped transaction, and show add/update/skip counts. Save individual definitions atomically. |
| High | The server timeout probe did not limit the actual metric query. | Apply a session limit before the query, retain a client timeout, and destroy timed-out connections. Rotate the pool on password changes. |
| Medium | Missing values became zero; increases were always presented as good. | Preserve missing values, use percentage-point changes for rates, and store explicit higher/lower/neutral interpretation. |
| Medium | Charts and controls lacked enough explanation and usable fallback views. | Add keyboard/touch help, full definitions, labeled legends, all-column tables, CSV export, readable palettes, and reduced-motion behavior. |
| Medium | All metrics loaded together and saved date ranges were overridden. | Respect saved ranges. Limit concurrent queries. The current workspace also includes a persistent focused view and on-demand metric selection. |

## Revised definitions

| Metric | What it measures | Interpretation constraint |
| --- | --- | --- |
| Session platform mix | Share of sessions grouped by reported device string. | Sessions are not unique people; platform classification is a heuristic. |
| Top non-iOS mobile devices | Top 15 device labels by sessions, with distinct players per label. | More than 50 sessions required. One player may use several devices. |
| Active players by country | Distinct players per country across the selected range. | Top 10 only; missing countries excluded. This is not daily active users or a global unique total. |
| New-player return rate | Share of eligible signup cohorts with a session on days 1-7 and 1-28. | Day 0 excluded. Cumulative return, not exact-day retention. Both rates use the same mature cohort. |
| Rooms created and ended | Rooms grouped by creation date and those with an end timestamp. | A room need not represent a played game. End counts can change retrospectively. |
| New registrations | New non-PRIVATE player records and the subset with a referrer. | Excluding PRIVATE is not proof that every remaining account is human. |
| Registration method mix | All-history non-PRIVATE player records by registration method. | This query does not use the dashboard time range. |
| Referral share of registrations | Registrations with a referrer divided by registrations in that period. | Referral attribution does not establish incremental growth or causality. |
| Active players and sessions | Distinct players and session count within each time bucket. | Do not sum distinct player counts across buckets to infer whole-range unique players. |
| Room variant mix | Created rooms by detailed variant. | Room creation is not completed gameplay. |
| Rooms without a recorded end | Share of created rooms that currently lack an end timestamp. | Includes in-progress rooms and missing records; does not prove abandonment. |
| Okey penalty reasons | Recorded penalty events by reason. | Penalties are events, not distinct affected players or an exposure-adjusted rate. |

All definitions contain a short description, category, longer interpretation notes, value format, trend direction, and KPI aggregation. Open **Details**, then **SQL query** for the full SQL. Missing values remain unavailable. Percentage SQL values use the 0-100 scale: 25 displays as 25%, and a move from 20% to 25% is +5 percentage points.

## Simpler dashboard, 7 September follow-up

- **Focus / Show all** sits beside **New metric**. Focus starts with four cards, with existing explicit selections preserved. **Choose metrics** edits the selection. Mode and selection are saved in this browser.
- Search stays visible. **Filters** reveals category and dashboard range controls; a single-category catalog does not show an unnecessary category selector. Active filters remain visible when the panel closes. **Reset filters** restores saved ranges and clears search/category filters. Empty search results offer matching metrics outside Focus when available.
- Two columns on desktop, one on phones. Cards emphasize the chart and range. **Details** holds the definition, card range, table view, SQL, and query timings. Long category charts initially show six entries; expansion shows up to fifteen, and the table retains every returned row.
- Change labels explicitly say **Improved**, **Worsened**, **Up**, **Down**, or **No change**. The neutral badge no longer uses the theme's tinted background, which looked green in the live theme. Labels and icons share a semantic color. Chart/legend colors identify series independently of whether a change is favorable.
- Card ranges and chart/table choices survive temporarily hiding a card with search, category, or Focus. The inherited range option now names the actual dashboard/saved range instead of the card override.
- Failed connection checks retain the last known data cutoff, so cached trends keep the same completeness interpretation. Errors and retry actions remain visible.

Validation: the full workspace suite passed 286 tests (25 PostgreSQL-dependent tests skipped). After adding the cutoff regression, all 45 focused Metrics tests passed (5 PostgreSQL tests skipped). Final ESLint and the production build, including TypeScript, passed. Browser checks used local sample data at 1366, 390, and 320px: keyboard switch/filter/chooser controls, light/dark colors, matching chart legends, tables, initial query failures, cached refresh failures, recovery, and horizontal overflow. No browser errors or warnings were reported. This follow-up changes local code; deployment and live-definition reconciliation remain separate work.

## Import the new export

Use `metrics-export-2026-09-07-improved.json` with the updated Metrics module. The original download remains unchanged.

1. Open **Metrics options**, then **Import metrics**, and choose the revised JSON.
2. Review every add, skip, or update. Enable updating existing matches when replacing the original definitions.
3. Confirm the reviewed import. All definition writes commit together, or none do.

The `replaces` field maps new names to the original names. Existing names are matched without case sensitivity. Ambiguous duplicates are rejected rather than updated arbitrarily. A read-only inspection during this review found both original and renamed definitions on the live page (24 total). Those duplicates need reconciliation before a replacement import. No live definitions were edited or deleted during this review.

The old importer does not understand the new metadata or replacement behavior and can append another set. Deploy the updated module before relying on these import features. Its schema setup adds the metadata columns to the existing PostgreSQL metrics table.

## Architecture

The Metrics definition module owns the import/export contract and metadata validation. The store module owns workspace-scoped persistence and transactional import matching. The query hook owns request lifetime, bounded concurrency, caching, and refresh state. Presentation helpers keep numeric and CSV behavior consistent between charts and tables. These modules concentrate policy behind small interfaces, improving locality and allowing storage behavior to be tested through a real database rather than mocked SQL strings.

## Validation

- Complete workspace suite: 276 tests passed across 59 files with the Metrics and mobile-report PostgreSQL fixtures enabled. An additional concurrent-pool check passed afterward.
- TypeScript and ESLint passed. Next.js production build completed successfully.
- Real PostgreSQL tests cover metadata persistence, renamed imports, skipped matches, transaction rollback after a late conflict, SQL validation before writes, and workspace isolation.
- Hook tests cover late responses and retaining cached data on refresh failure. Numeric, CSV, date-window, and SQL guard tests cover interpretation and binding behavior.
- Browser checks used the real Metrics components with explicitly labeled local sample data at 390px and desktop widths. Checked light/dark palettes, horizontal overflow, keyboard help, supporting-count tables, failed refreshes, and recovery. This is targeted accessibility verification, not a WCAG certification.
- The revised return-rate SQL was executed as an unsaved, read-only preview on the connected database using the monthly window. It succeeded with 11 rows and all six expected columns. The draft was discarded. Other revised definitions passed schema and SQL binding checks; their full production results were not independently reconciled against source records.

## Remaining priorities

1. Reconcile the duplicate live definitions before importing replacements. Do not infer which duplicate to delete automatically.
2. Profile the busiest queries with the database owner. Review indexes for PlayerSession `(player_id, start)` and date-filter columns using actual query plans before adding indexes. No database index changes were made.
3. Replace buffered MySQL results with a genuinely bounded retrieval strategy if large arbitrary queries are common. The current 50,000-row return cap applies after retrieval and is not a memory bound.
4. Add a real replication watermark if operators need database freshness guarantees. `MAX(PlayerSession.start)` is only the latest observed session, not proof that every table is current.
5. If these metrics become decision-critical, maintain small SQL fixtures for cohort eligibility and source-population reconciliation, including database timezone conventions.

The timeout implementation follows the official [MySQL session variable documentation](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html) and [MariaDB statement timeout documentation](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/query-optimizations/aborting-statements).
