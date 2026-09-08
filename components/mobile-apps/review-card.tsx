"use client";

import { forwardRef, memo, useState } from "react";
import {
  IconStarFilled,
  IconBrandApple,
  IconBrandGooglePlay,
  IconLanguage,
  IconExternalLink,
  IconCopy,
} from "@tabler/icons-react";
import { formatDate } from "@/lib/format-date";
import { toAlpha2, territoryToLanguage, countryName } from "@/lib/mobile-apps/country-codes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type ReviewRow = {
  id: string;
  store: string;
  author: string | null;
  rating: number | null;
  title: string | null;
  body: string | null;
  app_version: string | null;
  country: string | null;
  language?: string | null;
  submitted_at: string | null;
  store_response: string | null;
  fetched_at?: string | null;
};

function Stars({ n }: { n: number | null }) {
  const count = Math.max(0, Math.min(5, Math.round(n ?? 0)));
  return (
    <span className="inline-flex items-center gap-px" role="img" aria-label={n == null ? "No star rating" : `${count} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <IconStarFilled key={i} className={i < count ? "size-3.5 text-warning" : "size-3.5 text-foreground/15"} aria-hidden />
      ))}
    </span>
  );
}

/** Best-effort link to the review on the store. Per-review deep links aren't
 * public, so this opens the app's reviews page on the right storefront. */
export function storeUrl(review: ReviewRow, storeAppId: string | null): string | null {
  if (!storeAppId) return null;
  if (review.store === "apple") {
    const cc = toAlpha2(review.country) ?? "us";
    return `https://apps.apple.com/${cc}/app/id${storeAppId}?see-all=reviews`;
  }
  const hl = (review.language || "en").toLowerCase();
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(storeAppId)}&hl=${hl}&showAllReviews=true`;
}

export function reviewClipboardText(review: ReviewRow): string {
  const store = review.store === "apple" ? "App Store" : "Google Play";
  return [
    `${review.rating ?? "?"}/5 · ${store}${review.country ? ` · ${countryName(review.country)}` : ""}${review.submitted_at ? ` · ${formatDate(review.submitted_at)}` : ""}`,
    review.title,
    review.body,
    review.author ? `— ${review.author}` : null,
  ].filter(Boolean).join("\n");
}

type Props = {
  review: ReviewRow;
  storeAppId?: string | null;
  /** Arrived after the operator last looked at this app. */
  isNew?: boolean;
  /** Just accepted from the "new reviews" control. */
  highlight?: boolean;
  negativeThreshold?: number;
};

export const ReviewCard = memo(forwardRef<HTMLElement, Props>(function ReviewCard({ review, storeAppId, isNew = false, highlight = false, negativeThreshold = 3 }, ref) {
  const StoreIcon = review.store === "apple" ? IconBrandApple : IconBrandGooglePlay;
  const [expanded, setExpanded] = useState(false);
  const [translated, setTranslated] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [translating, setTranslating] = useState(false);

  const source = review.language?.toLowerCase() || territoryToLanguage(review.country) || "en";
  const canTranslate = source !== "nl";
  const url = storeUrl(review, storeAppId ?? null);
  const negative = review.rating != null && review.rating <= negativeThreshold;
  const needsReply = negative && !review.store_response;

  const originalBody = review.body ?? "";
  const shownBody = translated && !showOriginal ? translated : originalBody;
  const long = shownBody.length > 280;

  async function translate() {
    if (translated) {
      setShowOriginal((v) => !v);
      return;
    }
    setTranslating(true);
    try {
      const text = [review.title, review.body].filter(Boolean).join("\n\n");
      const res = await fetch("/api/mobile-apps/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, source }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Translation failed");
      setTranslated(json.text as string);
      setShowOriginal(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Translation failed");
    } finally {
      setTranslating(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reviewClipboardText(review));
      toast.success("Review copied");
    } catch {
      toast.error("Could not copy. Select the text instead.");
    }
  }

  return (
    <article
      ref={ref}
      tabIndex={-1}
      data-review-id={review.id}
      data-new={isNew ? "" : undefined}
      aria-label={`${review.rating ?? "Unrated"} star review${review.title ? `: ${review.title}` : ""}`}
      className={cn(
        "group/review relative -mx-2 rounded-lg px-2 py-4 outline-none transition-colors duration-(--dur-base) ease-(--ease-out) focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
        highlight && "bg-info-soft",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Stars n={review.rating} />
        {isNew ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-info-fg">
            <span className="size-1.5 rounded-full bg-info" aria-hidden />New
          </span>
        ) : null}
        {needsReply ? (
          <span className="rounded-full bg-warning-soft px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-warning-fg">Needs reply</span>
        ) : null}
        {review.title ? (
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{review.title}</h3>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <time className="shrink-0 text-xs text-muted-foreground" dateTime={review.submitted_at ?? undefined}>
          {formatDate(review.submitted_at)}
        </time>
      </div>

      {shownBody ? (
        <p className={cn("mt-1.5 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-foreground/85", !expanded && long && "line-clamp-4")}>
          {shownBody}
        </p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
        {long ? (
          <button type="button" onClick={() => setExpanded((v) => !v)} className="inline-flex h-8 items-center rounded-md px-1.5 text-xs font-medium text-primary transition-colors hover:bg-surface-hover">
            {expanded ? "Show less" : "Read more"}
          </button>
        ) : null}
        {canTranslate ? (
          <button
            type="button"
            data-action="translate"
            onClick={() => void translate()}
            disabled={translating}
            className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-primary transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            <IconLanguage className="size-3.5" aria-hidden />
            {translating ? "Translating…" : translated ? (showOriginal ? "Show Dutch" : "Show original") : "Translate to Dutch"}
          </button>
        ) : null}
        <button type="button" data-action="copy" onClick={() => void copy()} className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground">
          <IconCopy className="size-3.5" aria-hidden />
          Copy
        </button>
        {url ? (
          <a
            href={url}
            data-action="open"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <IconExternalLink className="size-3.5" aria-hidden />
            View in store
          </a>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <StoreIcon className="size-3.5" aria-hidden />
        <span className="sr-only">{review.store === "apple" ? "App Store" : "Google Play"}</span>
        {review.author ? <span className="font-medium text-foreground/70">{review.author}</span> : null}
        {review.app_version ? <span>v{review.app_version}</span> : null}
        {review.country ? <span title={countryName(review.country)}>{countryName(review.country)}</span> : null}
      </div>

      {review.store_response ? (
        <div className="mt-2.5 rounded-lg bg-surface-2 px-3 py-2.5">
          <div className="mb-1 eyebrow">Developer response</div>
          <p className="max-w-prose whitespace-pre-wrap text-xs leading-relaxed text-foreground/75">{review.store_response}</p>
        </div>
      ) : null}
    </article>
  );
}));
