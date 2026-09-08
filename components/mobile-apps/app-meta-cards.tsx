"use client";

import { SourceBadge } from "@/components/mobile-apps/source-badge";
import { STORE_META, Stars, type StoreKey } from "@/components/mobile-apps/store-score-card";
import { countryName } from "@/lib/mobile-apps/country-codes";
import { formatDate } from "@/lib/format-date";
import type { AppMetadata, ReportBreakdown, ReportPoint } from "@/lib/mobile-apps/detail-data";

function formatBytes(bytes: number | null): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function MetaFact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium text-foreground/90">{value}</dd>
    </div>
  );
}

/** Official app metadata from the store (Apple iTunes Lookup). Real, no-auth facts. */
export function AppMetaCard({ store, meta }: { store: StoreKey; meta: AppMetadata }) {
  const size = formatBytes(meta.fileSizeBytes);
  const facts: Array<{ label: string; value: string; title?: string }> = [];
  if (meta.version) facts.push({ label: "Version", value: meta.version });
  if (meta.currentVersionReleaseDate)
    facts.push({ label: "Updated", value: formatDate(meta.currentVersionReleaseDate), title: meta.releaseNotes ?? undefined });
  if (meta.releaseDate) facts.push({ label: "First released", value: formatDate(meta.releaseDate) });
  if (size) facts.push({ label: "Size", value: size });
  if (meta.primaryGenre) facts.push({ label: "Category", value: meta.primaryGenre });
  if (meta.contentRating) facts.push({ label: "Age rating", value: meta.contentRating });
  if (meta.formattedPrice) facts.push({ label: "Price", value: meta.formattedPrice });
  if (meta.minimumOsVersion) facts.push({ label: "Min OS", value: meta.minimumOsVersion });
  if (meta.languages.length > 0)
    facts.push({ label: "Languages", value: String(meta.languages.length), title: meta.languages.join(", ") });
  if (meta.sellerName) facts.push({ label: "Seller", value: meta.sellerName });
  if (facts.length === 0) return null;

  const storeLabel = STORE_META[store].label;
  return (
    <section className="w-full surface-card p-5 sm:p-6" aria-label="App details">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="eyebrow">App details</h2>
          <SourceBadge kind="official-api" title="Apple iTunes Lookup — official public Apple endpoint." />
        </div>
        <span className="text-xs text-muted-foreground">{storeLabel} · official store metadata</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {facts.map((f) => (
          <MetaFact key={f.label} label={f.label} value={f.value} title={f.title} />
        ))}
      </dl>
      {meta.currentVersionAvg != null ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">This version:</span>
          <Stars n={meta.currentVersionAvg} size="size-3" />
          <span className="font-semibold tabular-nums">{meta.currentVersionAvg.toFixed(1)}</span>
          {meta.currentVersionCount != null ? <span>· {meta.currentVersionCount.toLocaleString()} ratings</span> : null}
          {meta.releaseNotes ? <span className="ml-auto max-w-[60%] truncate" title={meta.releaseNotes}>“{meta.releaseNotes}”</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function asMetricsObj(v: unknown): Record<string, number | null> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, number | null>;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, number | null>) : {};
    } catch {
      return {};
    }
  }
  return {};
}
function pickMetric(m: Record<string, number | null>, ...keys: string[]): number | null {
  for (const k of keys) if (typeof m[k] === "number") return m[k] as number;
  return null;
}
const INSTALL_METRIC_KEYS = ["active_device_installs", "current_device_installs", "total_user_installs", "daily_device_installs", "daily_user_installs"];

/** Top dimension values for an installs breakdown, ranked by install volume. */
function topInstallBreakdown(breakdowns: ReportBreakdown[], dimension: string, n: number): Array<{ label: string; value: number | null }> {
  return breakdowns
    .filter((b) => b.report === "installs" && b.dimension === dimension && b.dimension_value && b.dimension_value !== "overview")
    .map((b) => ({ label: b.dimension_value, value: pickMetric(asMetricsObj(b.metrics), ...INSTALL_METRIC_KEYS) }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, n);
}

/**
 * Google Play details derived ONLY from Play Console install reports we already
 * ingest. Google exposes no catalog-metadata endpoint (size, age rating,
 * category, price) like Apple's iTunes Lookup, so we never fabricate those.
 */
export function GoogleDetailsCard({ breakdowns, installs }: { breakdowns: ReportBreakdown[]; installs: ReportPoint[] }) {
  const topVersion = topInstallBreakdown(breakdowns, "app_version", 1)[0]?.label ?? null;
  const languages = breakdowns.filter((b) => b.report === "installs" && b.dimension === "language" && b.dimension_value && b.dimension_value !== "overview");
  const topDevices = topInstallBreakdown(breakdowns, "device", 5);
  const topOs = topInstallBreakdown(breakdowns, "os_version", 4);
  const topCountries = topInstallBreakdown(breakdowns, "country", 5);
  const lastInstalls = installs.length ? asMetricsObj(installs[installs.length - 1].metrics) : {};
  const activeInstalls = pickMetric(lastInstalls, "active_device_installs", "current_device_installs", "total_user_installs");

  const facts: Array<{ label: string; value: string; title?: string }> = [];
  if (topVersion) facts.push({ label: "Top version", value: topVersion });
  if (activeInstalls != null) facts.push({ label: "Active installs", value: activeInstalls.toLocaleString() });
  if (languages.length > 0)
    facts.push({ label: "Languages", value: String(languages.length), title: languages.map((l) => l.dimension_value).join(", ") });
  if (topCountries.length > 0)
    facts.push({ label: "Top country", value: countryName(topCountries[0].label) });

  const chips: Array<{ title: string; items: string[] }> = [];
  if (topDevices.length > 0) chips.push({ title: "Top devices", items: topDevices.map((d) => d.label) });
  if (topOs.length > 0) chips.push({ title: "Android versions", items: topOs.map((o) => o.label) });
  if (topCountries.length > 0) chips.push({ title: "Top countries", items: topCountries.map((c) => countryName(c.label)) });

  if (facts.length === 0 && chips.length === 0) return null;

  return (
    <section className="w-full surface-card p-5 sm:p-6" aria-label="App details">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="eyebrow">App details</h2>
          <SourceBadge kind="csv" label="CSV-derived" title="Derived from Google Play Console install CSV exports — Google has no catalog-metadata API." />
        </div>
        <span className="text-xs text-muted-foreground">Google Play · derived from Play Console install reports</span>
      </div>
      {facts.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {facts.map((f) => (
            <MetaFact key={f.label} label={f.label} value={f.value} title={f.title} />
          ))}
        </dl>
      ) : null}
      {chips.length > 0 ? (
        <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
          {chips.map((c) => (
            <div key={c.title}>
              <p className="mb-1.5 text-xs text-muted-foreground">{c.title}</p>
              <div className="flex flex-wrap gap-1">
                {c.items.map((it) => (
                  <span key={it} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-foreground/80">{it}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <p className="mt-4 max-w-prose text-xs leading-relaxed text-muted-foreground">
        Google’s API exposes no catalog metadata (size, age rating, category, price) the way Apple’s does. These facts are derived from the install reports you’ve downloaded.
      </p>
    </section>
  );
}
