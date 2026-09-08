"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { IconBulb, IconChartBar, IconFileAnalytics, IconMessage } from "@tabler/icons-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { StoreConfigBanner } from "@/components/mobile-apps/store-config-banner";
import { ReviewsStream, DEFAULT_REVIEW_FILTERS, type ReviewFilters, type ReviewRange, type ReviewSort } from "@/components/mobile-apps/reviews-stream";
import { StoreScoreCard, type StoreKey } from "@/components/mobile-apps/store-score-card";
import { AppMasthead } from "@/components/mobile-apps/app-masthead";
import { FactsStrip } from "@/components/mobile-apps/facts-strip";
import { InsightsTab } from "@/components/mobile-apps/insights-tab";
import { SourceBadge } from "@/components/mobile-apps/source-badge";
import { useAnnouncer } from "@/components/mobile-apps/announcer";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useModules } from "@/components/modules/modules-provider";
import { useMobileAppDetail } from "@/hooks/use-mobile-app-detail";
import { useUrlState } from "@/hooks/use-url-state";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useNow } from "@/hooks/use-now";
import { clockTime } from "@/lib/mobile-apps/client/format";
import type { TrendMarker, TrendPoint } from "@/components/mobile-apps/rating-trend";

const RatingTrend = dynamic(() => import("@/components/mobile-apps/rating-trend").then((m) => m.RatingTrend), {
  ssr: false,
  loading: () => <div className="h-44 rounded-lg bg-muted motion-safe:animate-pulse" aria-hidden />,
});
const PlayReportsCard = dynamic(() => import("@/components/mobile-apps/play-reports-card").then((m) => m.PlayReportsCard), {
  ssr: false,
  loading: () => <div className="h-72 surface-card motion-safe:animate-pulse" aria-hidden />,
});

export { StoreScoreCard } from "@/components/mobile-apps/store-score-card";

type Tab = "reviews" | "ratings" | "reports" | "insights";
const TABS: Array<{ value: Tab; label: string; Icon: typeof IconMessage; googleOnly?: boolean }> = [
  { value: "reviews", label: "Reviews", Icon: IconMessage },
  { value: "ratings", label: "Ratings", Icon: IconChartBar },
  { value: "reports", label: "Reports", Icon: IconFileAnalytics, googleOnly: true },
  { value: "insights", label: "Insights", Icon: IconBulb },
];

type UrlState = { store: string; tab: string; rating: number; q: string; sort: string; range: string; needsReply: boolean };
const URL_DEFAULTS: UrlState = { store: "", tab: "reviews", rating: 0, q: "", sort: "newest", range: "all", needsReply: false };
const EMPTY: never[] = [];

export function AppDetailClient({ appId }: { appId: string }) {
  return <AppDetail key={appId} appId={appId} />;
}

function AppDetail({ appId }: { appId: string }) {
  const router = useRouter();
  const { ready, isEnabled } = useModules();
  const enabled = ready && isEnabled("mobile-apps");
  useEffect(() => {
    if (ready && !isEnabled("mobile-apps")) router.replace("/settings#modules");
  }, [ready, isEnabled, router]);

  const detail = useMobileAppDetail(appId, enabled);
  const { data, loading, syncing, refreshingReports, loadingReports, reportsLoaded, error, refreshKey, loadedAt, job, newReviews, connection, load, refreshNow, refreshGoogleReports, ensureReports, acknowledgeReviews, removeApp } = detail;
  const now = useNow(30_000).getTime();
  const reduceMotion = useReducedMotion();
  const { announce, region } = useAnnouncer();
  const [url, setUrl] = useUrlState(URL_DEFAULTS);

  const app = data?.app ?? null;
  const listings = data?.listings ?? EMPTY;
  const summary = data?.summary ?? EMPTY;
  const trend = data?.trend ?? EMPTY;
  const syncRuns = data?.syncRuns ?? EMPTY;
  const negativeThreshold = data?.negativeThreshold ?? 3;
  const reports = data?.reports;

  const availableStores = useMemo(
    () => listings.map((l) => l.store).filter((s): s is StoreKey => s === "apple" || s === "google"),
    [listings],
  );
  const store: StoreKey = availableStores.includes(url.store as StoreKey) ? (url.store as StoreKey) : availableStores.includes("google") ? "google" : availableStores[0] ?? "google";
  const tab: Tab = (["reviews", "ratings", "reports", "insights"] as Tab[]).includes(url.tab as Tab) ? (url.tab as Tab) : "reviews";
  const visibleTabs = TABS.filter((t) => !t.googleOnly || store === "google");
  const activeTab: Tab = visibleTabs.some((t) => t.value === tab) ? tab : "reviews";

  // The Reports tab reads the heavy slice; it is fetched on first visit only.
  useEffect(() => { if (activeTab === "reports" && enabled && app) void ensureReports(); }, [activeTab, enabled, app, ensureReports]);

  const filters: ReviewFilters = useMemo(() => ({
    rating: Number(url.rating) || 0,
    q: String(url.q),
    sort: (["newest", "oldest", "lowest", "highest"] as ReviewSort[]).includes(url.sort as ReviewSort) ? (url.sort as ReviewSort) : DEFAULT_REVIEW_FILTERS.sort,
    range: (["7d", "30d", "90d", "all"] as ReviewRange[]).includes(url.range as ReviewRange) ? (url.range as ReviewRange) : DEFAULT_REVIEW_FILTERS.range,
    needsReply: Boolean(url.needsReply),
  }), [url]);
  const setFilters = useCallback((patch: Partial<ReviewFilters>) => setUrl(patch), [setUrl]);

  const storeSummary = summary.find((s) => s.store === store);
  const listing = listings.find((l) => l.store === store);
  const facts = {
    total: storeSummary?.total ?? 0,
    negative: storeSummary?.negative ?? 0,
    responded: storeSummary?.responded ?? 0,
    needsReply: storeSummary?.needs_reply ?? 0,
  };

  const trendData: TrendPoint[] = useMemo(() => trend.filter((t) => t.store === store).map((t) => ({ day: t.day, avg: t.avg, count: t.count })), [trend, store]);
  // Release marker on the trend chart only where we have a real release date.
  const trendMarkers: TrendMarker[] = useMemo(() => {
    const meta = listings.find((l) => l.store === store)?.store_metadata;
    if (store === "apple" && meta?.currentVersionReleaseDate) return [{ day: meta.currentVersionReleaseDate, label: meta.version ? `v${meta.version}` : "Update" }];
    return [];
  }, [listings, store]);

  const lastCheckedAt = useMemo(() => listings.map((l) => l.last_synced_at).filter(Boolean).sort().at(-1) ?? null, [listings]);
  const storeAppIds = useMemo(() => Object.fromEntries(listings.map((l) => [l.store, l.store_app_id])) as Record<string, string>, [listings]);
  const storeUrls = useMemo(() => ({
    apple: storeAppIds.apple ? `https://apps.apple.com/${listings.find((l) => l.store === "apple")?.country ?? "us"}/app/id${storeAppIds.apple}` : undefined,
    google: storeAppIds.google ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(storeAppIds.google)}` : undefined,
  }), [storeAppIds, listings]);
  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ format: "csv", store, sort: filters.sort });
    if (filters.rating) params.set("rating", String(filters.rating));
    if (filters.q) params.set("q", filters.q);
    if (filters.needsReply) { params.set("responded", "false"); params.set("maxRating", String(negativeThreshold)); }
    return `/api/mobile-apps/${appId}/reviews?${params}`;
  }, [appId, store, filters, negativeThreshold]);

  // Announce outcomes once, in one live region, instead of stacking toasts.
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (error && error !== lastError.current) announce(error);
    lastError.current = error;
  }, [error, announce]);
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && !syncing && !error) announce("Stores re-checked");
    wasSyncing.current = syncing;
  }, [syncing, error, announce]);
  const lastConnection = useRef(connection);
  useEffect(() => {
    if (lastConnection.current !== connection) {
      if (connection === "offline") announce("Connection lost. Showing the last available data.");
      else if (connection === "live" && lastConnection.current !== "connecting" && lastConnection.current !== "idle") announce("Live updates restored");
    }
    lastConnection.current = connection;
  }, [connection, announce]);

  const refresh = useCallback(() => { void refreshNow(); }, [refreshNow]);
  const goTab = useCallback((value: Tab) => setUrl({ tab: value }), [setUrl]);
  useKeyboardShortcuts(useMemo(() => ({
    r: refresh,
    "[": () => { const i = visibleTabs.findIndex((t) => t.value === activeTab); goTab(visibleTabs[(i - 1 + visibleTabs.length) % visibleTabs.length].value); },
    "]": () => { const i = visibleTabs.findIndex((t) => t.value === activeTab); goTab(visibleTabs[(i + 1) % visibleTabs.length].value); },
  }), [refresh, visibleTabs, activeTab, goTab]), Boolean(app) && activeTab !== "reviews");

  async function remove() {
    try {
      await removeApp();
      toast.success(`Removed ${app?.name ?? "app"}`);
      router.push("/mobile-apps");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the app");
      throw e;
    }
  }

  const [showShortcuts, setShowShortcuts] = useState(false);
  useKeyboardShortcuts(useMemo(() => ({ "?": () => setShowShortcuts((v) => !v), "shift+?": () => setShowShortcuts((v) => !v) }), []), Boolean(app));

  return (
    <>
      <PageHeader page={app?.name ?? "App"} crumbs={[{ label: "Mobile Apps", href: "/mobile-apps" }]} />
      {region}

      <div className="min-h-0 flex-1 overflow-y-auto page-x py-5 md:py-6">
        {!app ? (
          loading ? (
            <div role="status" aria-label="Loading app details" className="mx-auto max-w-6xl space-y-5">
              <div className="flex items-center gap-4">
                <div className="size-14 rounded-2xl bg-muted motion-safe:animate-pulse" />
                <div className="space-y-2"><div className="h-6 w-48 rounded bg-muted motion-safe:animate-pulse" /><div className="h-3 w-32 rounded bg-muted motion-safe:animate-pulse" /></div>
              </div>
              <div className="h-24 surface-card motion-safe:animate-pulse" />
              <div className="h-72 surface-card motion-safe:animate-pulse" />
            </div>
          ) : (
            <div className="mx-auto max-w-6xl rounded-xl border border-dashed border-line-strong px-4 py-12 text-center">
              <p className="text-sm font-medium">App details are unavailable.</p>
              {error ? <p className="mt-1 text-xs text-danger-fg">{error}</p> : null}
              <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>Try again</Button>
            </div>
          )
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-(--section-gap)">
            <AppMasthead
              app={app}
              stores={availableStores}
              store={store}
              onStoreChange={(s) => setUrl({ store: s })}
              connection={connection}
              loadedAt={loadedAt}
              lastCheckedAt={lastCheckedAt}
              syncing={syncing}
              now={now}
              onRefresh={refresh}
              exportHref={exportHref}
              storeUrls={storeUrls}
              onRemove={remove}
            />

            {error ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
                <p className="min-w-0 flex-1 break-words">
                  <span className="text-danger-fg">{error}</span>
                  {loadedAt ? <span className="text-muted-foreground"> Showing data from {clockTime(loadedAt, now)}.</span> : null}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>Try again</Button>
              </div>
            ) : null}

            <StoreConfigBanner />

            <FactsStrip
              store={store}
              total={facts.total}
              negative={facts.negative}
              needsReply={facts.needsReply}
              responded={facts.responded}
              negativeThreshold={negativeThreshold}
              needsReplyActive={filters.needsReply}
              onShowNeedsReply={() => setUrl({ tab: "reviews", needsReply: !filters.needsReply })}
            />

            <Tabs value={activeTab} onValueChange={(v) => goTab(v as Tab)}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line">
                <TabsList variant="line" className="-mb-px h-10 gap-0 pb-0" aria-label="App sections">
                  {visibleTabs.map(({ value, label, Icon }) => (
                    <TabsTrigger key={value} value={value} className="h-10 flex-none px-3 text-sm after:bottom-0">
                      <Icon className="size-4" aria-hidden />
                      {label}
                      {value === "reviews" && newReviews > 0 && activeTab !== "reviews" ? (
                        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-info-soft px-1.5 text-2xs font-semibold tabular-nums text-info-fg">{newReviews}</span>
                      ) : null}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <button type="button" onClick={() => setShowShortcuts((v) => !v)} aria-expanded={showShortcuts} className="hidden h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground md:inline-flex">
                  <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-2xs">?</kbd> Shortcuts
                </button>
              </div>
              {showShortcuts ? (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-xs sm:grid-cols-4">
                  {[["/", "Search reviews"], ["j / k", "Next / previous review"], ["o", "Open review in store"], ["t", "Translate review"], ["c", "Copy review"], ["n", "Show new reviews"], ["1–5", "Toggle star filter"], ["r", "Refresh stores"], ["[ / ]", "Switch section"], ["Esc", "Clear filters"]].map(([key, what]) => (
                    <div key={key} className="flex items-center gap-2"><dt><kbd className="rounded border border-line bg-surface-1 px-1 font-mono text-2xs">{key}</kbd></dt><dd className="text-muted-foreground">{what}</dd></div>
                  ))}
                </dl>
              ) : null}

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${activeTab}:${store}`}
                  role="tabpanel"
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -2 }}
                  transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-3 outline-none"
                >
                  {activeTab === "reviews" ? (
                    <ReviewsStream
                      appId={appId}
                      store={store}
                      refreshKey={refreshKey}
                      storeAppIds={storeAppIds}
                      negativeThreshold={negativeThreshold}
                      filters={filters}
                      onFiltersChange={setFilters}
                      onAnnounce={announce}
                      onRefresh={refresh}
                      announcedNew={newReviews}
                      onNewShown={acknowledgeReviews}
                    />
                  ) : activeTab === "ratings" ? (
                    <div className="grid gap-(--section-gap) lg:grid-cols-5">
                      <div className="lg:col-span-3">
                        <StoreScoreCard store={store} summary={storeSummary} listing={listing} run={syncRuns.find((x) => x.store === store)} negativeThreshold={negativeThreshold} now={now} />
                      </div>
                      <section className="surface-card p-4 lg:col-span-2" aria-label="Review ratings over time">
                        <div className="mb-3">
                          <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold">Review ratings over time</h2>
                            <SourceBadge kind="derived" title="Daily average computed from stored written reviews — not the official store rating." />
                          </div>
                          <p className="text-xs text-muted-foreground">Average of stored written reviews per day, not the store rating</p>
                        </div>
                        <RatingTrend data={trendData} markers={trendMarkers} />
                      </section>
                    </div>
                  ) : activeTab === "reports" ? (
                    <PlayReportsCard
                      installs={reports?.installs ?? []}
                      crashes={reports?.crashes ?? []}
                      storePerformance={reports?.store_performance ?? []}
                      trafficSources={reports?.traffic_sources ?? []}
                      files={reports?.files ?? []}
                      breakdowns={reports?.breakdowns ?? []}
                      freshness={data?.freshness?.googleReports ?? null}
                      job={job}
                      now={now}
                      loading={loadingReports || (!reportsLoaded && !reports?.installs?.length)}
                      onRefresh={() => { void refreshGoogleReports().then((r) => { if (r?.ok) announce(r.message); }); }}
                      refreshing={refreshingReports}
                    />
                  ) : (
                    <InsightsTab appId={appId} store={store} listing={listing} breakdowns={reports?.breakdowns ?? []} installs={reports?.installs ?? []} onAnnounce={announce} />
                  )}
                </motion.div>
              </AnimatePresence>
            </Tabs>
          </div>
        )}
      </div>
    </>
  );
}
