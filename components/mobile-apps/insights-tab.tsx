"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SentimentDigest } from "@/components/mobile-apps/sentiment-digest";
import { AppMetaCard, GoogleDetailsCard } from "@/components/mobile-apps/app-meta-cards";
import type { StoreKey } from "@/components/mobile-apps/store-score-card";
import type { Listing, ReportBreakdown, ReportPoint } from "@/lib/mobile-apps/detail-data";

type Digest = { summary_md: string; created_at: string };

/** AI digest plus the store's own metadata. Loads its digest on first mount only. */
export function InsightsTab({ appId, store, listing, breakdowns, installs, onAnnounce }: {
  appId: string;
  store: StoreKey;
  listing: Listing | undefined;
  breakdowns: ReportBreakdown[];
  installs: ReportPoint[];
  onAnnounce?: (text: string) => void;
}) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDigest = useCallback(async () => {
    try {
      const res = await fetch(`/api/mobile-apps/${appId}/digest`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok && json.digests?.[0]) setDigest(json.digests[0]);
    } catch {
      /* The digest is optional; the panel offers Generate. */
    }
  }, [appId]);
  useEffect(() => { void loadDigest(); }, [loadDigest]);

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/mobile-apps/${appId}/digest`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed");
      await loadDigest();
      onAnnounce?.("Digest generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate digest");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-(--section-gap) lg:grid-cols-3">
      <div className="lg:col-span-1">
        <SentimentDigest summaryMd={digest?.summary_md ?? null} createdAt={digest?.created_at ?? null} busy={busy} onGenerate={() => void generate()} />
      </div>
      <div className="flex flex-col gap-(--section-gap) lg:col-span-2">
        {store === "apple" && listing?.store_metadata ? <AppMetaCard store={store} meta={listing.store_metadata} /> : null}
        {store === "google" ? <GoogleDetailsCard breakdowns={breakdowns} installs={installs} /> : null}
        {store === "apple" && !listing?.store_metadata ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted-foreground">Store metadata appears after the first successful App Store check.</p>
        ) : null}
      </div>
    </div>
  );
}
