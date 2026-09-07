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
