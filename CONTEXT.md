# Mission Control

An operational dashboard for managing OpenClaw agents and their work. Mobile Applications brings store feedback and official reports into the operator's workflow.

## Mobile Applications language

**Tracked app**: A mobile application an operator monitors. It can have one listing in each supported store.

**Listing**: A tracked app's presence in a particular store, identified by its store identifier and default country.

**Written review**: Feedback that includes a review record from a store. Its average covers fetched reviews and can differ from the store's rating across all ratings.
_Avoid_: Store rating, total ratings

**Country rating**: The official rating for one country or storefront, accompanied by its source and observation date. A country with written reviews may have no official rating.

**Official report**: A published Google Play Console export for a month and reporting dimension. Publication can lag behind the current day.

**Report generation**: A particular published revision of an official report. A later generation can change or remove previously published values.

**Report sync job**: A request to process official reports for a listing, tracked app, store, or all tracked apps. Queued work is waiting; running work is actively being processed.

**Report freshness**: Whether all available official report generations have been processed and the corresponding charts are ready. Unknown, unconfigured, failed, and refreshing states do not establish freshness.
_Avoid_: Live data, today's data

**Change**: A typed notification that Mobile Applications data moved, published on the database's change channel and forwarded to open browsers. Its kind says what moved: reviews, listing, reports, job, or app. A change names what to re-read; it never carries the data itself.
_Avoid_: Event, invalidation, refresh signal

**Live status**: Whether a browser is receiving changes right now: live, connecting, reconnecting, or offline. It describes the connection, not the age of the data, which is stated separately as the time the data was read.
_Avoid_: Online, connected, real-time

**New reviews**: Reviews stored since the reader's view was built. They wait behind a control instead of entering the list, so the reader's position and loaded pages survive. A review counts as new only when its content changed, not when a routine check re-read it.

**App facts**: The per-app counts on the list: reviews and negative reviews in the last seven days, when the stores were last checked, whether the last check failed, and report freshness. Facts are counts and states, never a rating.

**Detail slice**: A named part of an app's detail payload. `core` is the app, its listings, summary, trend and sync history; `reports` is the Play Console series, breakdowns and file index. A change re-reads only the slices it affects.

## Boards language

**Board**: A Kanban workspace of lists and tickets. Views: Kanban, List, Grid, Calendar.

**List**: A column on a board that tickets move through. A list can be **collapsed** into a slim rail that still accepts drops; collapsed lists are remembered per board in the browser.
_Avoid_: Column (in user-facing copy; the code type is still `Column`)

**Ticket**: A unit of work on a board; shown as a **card** on the Kanban view.

**Quick add**: The inline composer at the foot of a list that creates a title-only ticket. Enter saves and keeps composing; Details opens the full ticket editor.

**Card density**: A reader preference (comfortable or compact) for how much each card shows; compact hides descriptions and tags.

**Progressive reveal**: Rendering a long list in pages of 25 cards as the reader scrolls towards its end. It is a rendering strategy, not a fetch: the board is fully loaded.
_Avoid_: Pagination, infinite scroll (both imply fetching)
