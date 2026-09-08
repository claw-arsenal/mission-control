"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconDeviceMobile, IconSearch } from "@tabler/icons-react";
import { useModules } from "@/components/modules/modules-provider";
import { AddAppDialog } from "@/components/mobile-apps/add-app-dialog";
import { AppCard } from "@/components/mobile-apps/app-card";
import { StoreConfigBanner } from "@/components/mobile-apps/store-config-banner";
import { LiveStatus } from "@/components/mobile-apps/live-status";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMobileAppsList, useLiveConnection } from "@/hooks/use-mobile-apps-list";
import { useNow } from "@/hooks/use-now";
import type { AppSummary } from "@/lib/mobile-apps/client/live-store";
import { clockTime } from "@/lib/mobile-apps/client/format";

type Sort = "activity" | "name" | "checked";
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "activity", label: "Most new reviews" },
  { value: "name", label: "Name" },
  { value: "checked", label: "Recently checked" },
];

function sortApps(apps: AppSummary[], sort: Sort): AppSummary[] {
  const out = [...apps];
  if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "checked") out.sort((a, b) => (b.facts?.lastCheckedAt ?? "").localeCompare(a.facts?.lastCheckedAt ?? ""));
  else out.sort((a, b) => (b.facts?.reviewsLast7d ?? 0) - (a.facts?.reviewsLast7d ?? 0) || (b.facts?.negativeLast7d ?? 0) - (a.facts?.negativeLast7d ?? 0) || a.name.localeCompare(b.name));
  return out;
}

export function MobileAppsClient() {
  const router = useRouter();
  const { ready, isEnabled } = useModules();
  const enabled = ready && isEnabled("mobile-apps");
  useEffect(() => {
    if (ready && !isEnabled("mobile-apps")) router.replace("/settings#modules");
  }, [ready, isEnabled, router]);

  const { apps, loading, error, loadedAt, reload } = useMobileAppsList(enabled);
  const { connection } = useLiveConnection(enabled);
  const now = useNow(30_000).getTime();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [sort, setSort] = useState<Sort>("activity");

  const visible = useMemo(() => sortApps(deferredQuery ? apps.filter((a) => a.name.toLowerCase().includes(deferredQuery)) : apps, sort), [apps, deferredQuery, sort]);
  const hasCache = apps.length > 0 || loadedAt != null;
  const showSkeleton = loading && !hasCache;

  return (
    <>
      <PageHeader
        page="Mobile Apps"
        actions={
          <div className="flex items-center gap-2">
            <LiveStatus connection={connection} loadedAt={loadedAt} now={now} className="hidden sm:inline-flex" />
            <AddAppDialog onAdded={() => void reload()} />
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto page-x py-5 md:py-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-(--section-gap)">
          <StoreConfigBanner />

          {error ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
              <p className="min-w-0 flex-1 break-words">
                <span className="font-medium text-danger-fg">Could not refresh the list.</span> {error}
                {loadedAt ? <span className="text-muted-foreground"> Showing data from {clockTime(loadedAt, now)}.</span> : null}
              </p>
              <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>Try again</Button>
            </div>
          ) : null}

          {hasCache || showSkeleton ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter apps"
                  aria-label="Filter apps by name"
                  className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-sm outline-none transition-shadow duration-(--dur-fast) focus:ring-2 focus:ring-ring/40"
                />
              </div>
              <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
                <SelectTrigger className="h-9 w-44" aria-label="Sort apps">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {visible.length === apps.length ? `${apps.length} ${apps.length === 1 ? "app" : "apps"}` : `${visible.length} of ${apps.length}`}
              </span>
            </div>
          ) : null}

          {showSkeleton ? (
            <div role="status" aria-label="Loading apps" className="surface-card divide-y divide-line overflow-hidden">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="size-11 rounded-xl bg-muted motion-safe:animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-40 rounded bg-muted motion-safe:animate-pulse" />
                    <div className="h-3 w-24 rounded bg-muted motion-safe:animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : apps.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong py-16 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-surface-2">
                <IconDeviceMobile className="size-6 text-muted-foreground" aria-hidden />
              </div>
              <h2 className="mt-4 text-md font-semibold">Track your first app</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Add an App Store or Google Play listing. Reviews, ratings and official reports appear here and update as the stores publish them.
              </p>
              <div className="mt-4">
                <AddAppDialog onAdded={() => void reload()} />
              </div>
            </div>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No app matches “{query.trim()}”.</p>
          ) : (
            <div className="surface-card divide-y divide-line overflow-hidden">
              {visible.map((a) => <AppCard key={a.id} app={a} now={now} />)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
