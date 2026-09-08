"use client";

import { useState } from "react";
import { IconBrandApple, IconBrandGooglePlay, IconStarFilled } from "@tabler/icons-react";
import { RatingDistribution } from "@/components/mobile-apps/rating-distribution";
import { SourceBadge } from "@/components/mobile-apps/source-badge";
import { countryName, flagEmoji } from "@/lib/mobile-apps/country-codes";
import { selectRatingMeasurement } from "@/lib/mobile-apps/rating-source";
import { relativeTime } from "@/lib/mobile-apps/client/format";
import { formatDate } from "@/lib/format-date";
import type { Listing, Summary, SyncRun } from "@/lib/mobile-apps/detail-data";
import { cn } from "@/lib/utils";

export type StoreKey = "apple" | "google";

export const STORE_META: Record<StoreKey, { label: string; Icon: typeof IconBrandApple }> = {
  apple: { label: "App Store", Icon: IconBrandApple },
  google: { label: "Google Play", Icon: IconBrandGooglePlay },
};

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function Stars({ n, size = "size-4" }: { n: number | null; size?: string }) {
  const count = Math.max(0, Math.min(5, Math.round(n ?? 0)));
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={n == null ? "No rating" : `${n.toFixed(1)} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <IconStarFilled key={i} className={`${size} ${i < count ? "text-warning" : "text-foreground/15"}`} aria-hidden />
      ))}
    </span>
  );
}

const COUNTRY_PREVIEW = 8;

export function StoreScoreCard({
  store,
  summary,
  listing,
  run,
  negativeThreshold,
  now,
}: {
  store: StoreKey;
  summary: Summary | undefined;
  listing: Listing | undefined;
  run: SyncRun | undefined;
  negativeThreshold: number;
  /** Reference time for relative labels; omit to skip the "checked" age. */
  now?: number;
}) {
  const { label, Icon } = STORE_META[store];
  const counts: [number, number, number, number, number] = [
    summary?.r1 ?? 0, summary?.r2 ?? 0, summary?.r3 ?? 0, summary?.r4 ?? 0, summary?.r5 ?? 0,
  ];
  const total = summary?.total ?? 0;
  const failed = run?.status === "failed";
  const isApple = store === "apple";
  const [picked, setPicked] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { territories, selected, selectedEntry: selEntry, fromReport, writtenOnly, sourceCopy, label: headlineLabel, avg: headlineAvg, count: headlineCount } =
    selectRatingMeasurement(store, listing, picked);
  const shownTerritories = showAll ? territories : territories.slice(0, COUNTRY_PREVIEW);
  const warnings = !isApple ? asStringArray(run?.report_warnings) : [];
  const checked = now == null ? null : relativeTime(listing?.last_synced_at ?? null, now);

  return (
    <div className="min-w-0 w-full surface-card p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-md font-semibold">
          <Icon className="size-4" aria-hidden />
          {label}
        </h2>
        <span className={cn("flex items-center gap-1.5 text-xs", failed ? "text-danger-fg" : "text-muted-foreground")} title={run?.error_message ?? undefined}>
          <span className={cn("size-1.5 rounded-full", failed ? "bg-danger" : "bg-success")} aria-hidden />
          {failed ? "Last check failed" : checked ? `Checked ${checked}` : "Not checked yet"}
        </span>
      </div>

      {failed && run?.error_message ? (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger-fg">{run.error_message}</p>
      ) : null}
      {warnings.length > 0 ? (
        <div className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning-fg">
          <span className="font-medium">Reports:</span> {warnings.join(" · ")}
        </div>
      ) : null}

      <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
        {isApple
          ? "Checked through the App Store Connect API. A brand-new review can take a few hours to appear in Apple’s API after it is posted."
          : "Checked through the Play Reviews API, which returns roughly the last 7 days. New reviews usually appear within a day; older reviews come from the monthly Play Console exports."}
      </p>

      <div className="mt-5">
        <p className="mb-2 flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {selEntry && !writtenOnly ? <span className="text-base leading-none" aria-hidden>{flagEmoji(selected)}</span> : null}
          <span className="text-muted-foreground" title={sourceCopy.helperText}>{headlineLabel}</span>
          {isApple ? (
            <SourceBadge kind="official-api" title="Apple iTunes Lookup — official public Apple endpoint." />
          ) : fromReport ? (
            <SourceBadge kind="csv" title="Google Play Console ratings CSV export — delayed (daily/monthly), not a live API." />
          ) : (
            <SourceBadge kind="derived" title="Average of stored written reviews — Google exposes no live global store rating via API." />
          )}
        </p>
        <div className="flex items-end gap-4">
          <output aria-label="Selected rating" className="figure text-3xl leading-none">
            {headlineAvg != null ? headlineAvg.toFixed(1) : "—"}
          </output>
          <div className="pb-0.5">
            <Stars n={headlineAvg} size="size-4" />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {isApple
                ? headlineAvg != null
                  ? `official · ${headlineCount?.toLocaleString() ?? "—"} ratings`
                  : "no rating from the App Store API yet"
                : writtenOnly
                  ? headlineAvg != null
                    ? `from ${headlineCount?.toLocaleString() ?? "—"} written reviews only · not a store-wide rating`
                    : "no stored written reviews yet"
                  : headlineAvg != null
                    ? `official per-country average · Play Console ratings report${listing?.rating_as_of ? ` · as of ${formatDate(listing.rating_as_of)}` : ""}`
                    : "No official rating is available for this country."}
            </p>
          </div>
        </div>
        {!isApple && fromReport ? (
          <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted-foreground">
            Google’s API exposes no store-wide rating. This is the official per-country average from the latest Play Console ratings report; pick a country below to switch.
          </p>
        ) : null}
      </div>

      {territories.length > 0 ? (
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="eyebrow">By country</p>
            <span className="text-xs text-muted-foreground">{writtenOnly ? "written reviews by country" : "official rating + written reviews"}</span>
            {isApple ? (
              <SourceBadge kind="official-api" title="Ratings: Apple iTunes Lookup. Written counts: App Store Connect API. Both official." />
            ) : fromReport ? (
              <SourceBadge kind="csv" label="API + CSV" title="Ratings: Play Console ratings CSV export (delayed). Written counts: Play Reviews API + monthly review CSVs." />
            ) : (
              <SourceBadge kind="official-api" title="Written-review counts from the Play Reviews API + monthly review CSVs." />
            )}
          </div>
          <ul className="space-y-0.5" aria-label="Rating by country">
            {shownTerritories.map((t) => {
              const active = t.territory === selected;
              return (
                <li key={t.territory}>
                  <button
                    type="button"
                    onClick={() => setPicked(t.territory)}
                    aria-pressed={active}
                    className={cn("flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-(--dur-fast) pointer-coarse:min-h-10", active ? "bg-accent" : "hover:bg-surface-hover")}
                  >
                    <span className="text-base leading-none" aria-hidden>{flagEmoji(t.territory)}</span>
                    <span className="min-w-0 flex-1 truncate text-left text-foreground/85">{countryName(t.territory)}</span>
                    <span className="hidden sm:inline-flex"><Stars n={t.avg} size="size-3" /></span>
                    <span className="w-9 text-right font-semibold tabular-nums">{t.avg != null ? t.avg.toFixed(1) : "—"}</span>
                    <span className="w-24 text-right text-xs text-muted-foreground tabular-nums sm:w-28">
                      {isApple && t.count != null ? `${t.count.toLocaleString()} ratings` : ""}
                      {isApple && t.count != null && t.review_count != null ? " · " : ""}
                      {t.review_count != null ? `${t.review_count.toLocaleString()} written` : isApple && t.count != null ? "" : "—"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {territories.length > COUNTRY_PREVIEW ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="mt-2 inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-surface-hover">
              {showAll ? "Show fewer countries" : `Show all ${territories.length} countries`}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="eyebrow">Written review breakdown</p>
            {isApple ? (
              <SourceBadge kind="official-api" title="App Store Connect API customerReviews — official, last ~500 per storefront." />
            ) : (
              <SourceBadge kind="official-api" label="API + CSV" title="Play Reviews API (last ~7 days) + monthly Play Console review CSV exports." />
            )}
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {total.toLocaleString()} stored
            {summary && summary.negative > 0 ? ` · ${summary.negative} at ${negativeThreshold}★ or lower` : ""}
          </p>
        </div>
        <RatingDistribution counts={counts} />
        {!isApple ? (
          <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
            Written reviews come from downloaded Play Console review exports plus the latest Reviews API refresh. Rating-only feedback is not included here.
          </p>
        ) : null}
      </div>
    </div>
  );
}
