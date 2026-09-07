# Skill modules and review alerts

Settings → Modules separates the saved enable preference from availability.
Documents, Metrics and Mobile Applications require the installed `mission-control`
skill to advertise their corresponding capability in `manifest.json`.
Missing or disabled skills hide the module from navigation and gate its routes;
Settings shows the reason. Installing/restoring the skill resumes a saved enabled
preference. Disabling a module preserves its data. New optional modules start off.

Discovery uses the configured OpenClaw workspace, `~/.openclaw/skills`, configured
`skills.load.extraDirs`, and optional `MISSION_CONTROL_SKILLS_DIRS` (the platform's
path delimiter separates directories). `OPENCLAW_HOME`, `OPENCLAW_CONFIG_PATH` and
`OPENCLAW_WORKSPACE` are supported. Workspace skills take precedence. Discovery
reads metadata; it does not execute arbitrary skill entrypoints or load UI code
from a skill. New integrations still need a trusted entry in the module registry.

## Setup

1. Install/update `mission-control` on the server and enable Mobile Applications.
2. Configure App Store Connect and/or Google Play credentials as usual.
3. For email, install `email-calendar-m365-outlook`, run its `python3 scripts/status.py`
   and complete `python3 scripts/auth.py login` if required. Mission Control invokes
   its `scripts/mail.py send` directly, using its configured email template and
   credential vault. No additional Microsoft token is stored in Mission Control.
4. For Telegram, use the default OpenClaw Telegram bot, or set
   `MOBILE_REVIEW_TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_TOKEN` in server `secrets.env`.
   Add the bot to destination groups/channels or initiate a direct chat first.
5. Open Settings → Notifications → Mobile app review alerts. Choose recipients,
   a maximum star rating, and monitoring interval. Inspect the example message,
   then save to authorize automatic alerts. Each email recipient receives a
   separate message. Bot tokens and Outlook credentials never reach the browser.
6. Restart the existing service supervisor to pick up its new `mobile-reviews`
   service, or run `npm run mobile:reviews:watch` independently. For cron use
   `npm run mobile:reviews:once`. The Settings heartbeat shows whether it is running.

For container deployments, run the review worker as a separate process/container
using the same image and database. Mount the installed skills, store keys and
Outlook vault into its user's home. The image includes Python 3 and the TypeScript
path configuration needed by the worker; the default image command runs the web
server, so the worker must also be started.

No actual message is sent merely by viewing settings. Channels default off.
The catalog's `mobile-apps/notifications-status.js --json` reads monitor and delivery
status with an admin session. Recipient configuration remains in the UI.

## Timing and delivery semantics

The resident worker checks even with all browser tabs closed. It requests a
60-second interval by default, extends it for large paginated Google feeds, and
backs off after provider errors. Heavy reports keep their own background worker.
Written reviews, official ratings and published report dates remain distinct.

New review inserts notify connected browsers and transactionally create an outbox
entry per configured destination. Only reviews submitted after the latest settings
save qualify; initial history, repeat imports, edits to an existing review, unknown
submission dates and ratings outside the filter do not send new alerts. Each save
starts a new settings revision and cancels pending alerts from the previous one.
A delivery already in progress may finish. Disabling monitoring/module pauses work.

Workers coordinate using PostgreSQL advisory locks on reserved connections.
Successful recipients are retained when another destination fails. Configuration
and explicit rate-limit failures retry with a bounded backoff; unknown send results
and interrupted sends become `uncertain`. Verify Sent Items or the Telegram chat
before a manual resend. Exactly-once delivery cannot be guaranteed across a remote
provider and PostgreSQL, so uncertain sends are never automatically repeated.

Review submission is not the same as publication. Google documents publication
delays and a 200-read/app/hour review API quota. Apple's documented webhooks cover
build/app lifecycle and TestFlight feedback, so customer reviews use polling.
Provider propagation and publication delays cannot be removed by Mission Control.

- [Google ratings and reviews](https://support.google.com/googleplay/android-developer/answer/138230?hl=en)
- [Google review API ordering, history and quotas](https://developers.google.com/android-publisher/reply-to-reviews)
- [Apple webhook event coverage](https://developer.apple.com/help/app-store-connect/manage-your-team/manage-webhooks/)
- [Telegram message delivery API](https://core.telegram.org/bots/api#sendmessage)

## Validation

Run `npm run typecheck`, lint the changed files, and `npm test`.
Set `MOBILE_REVIEWS_TEST_DATABASE_URL` to a disposable PostgreSQL database to run
the module and review-monitor integration tests. Each suite owns a unique schema.
They cover reversible toggles, missing skills, permissions, stale settings saves,
transactional enqueue, duplicate suppression, parallel workers, retries, uncertain
sends, polling cadence and provider backoff. Adapters are mocked; tests send no
real email or Telegram messages.
