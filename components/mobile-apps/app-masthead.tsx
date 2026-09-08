"use client";

import { useState } from "react";
import { IconDotsVertical, IconDownload, IconExternalLink, IconRefresh, IconTrash } from "@tabler/icons-react";
import { AppIcon } from "@/components/mobile-apps/app-card";
import { LiveStatus } from "@/components/mobile-apps/live-status";
import { STORE_META, type StoreKey } from "@/components/mobile-apps/store-score-card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Connection } from "@/lib/mobile-apps/client/live-store";
import { relativeTime } from "@/lib/mobile-apps/client/format";
import { cn } from "@/lib/utils";

type Props = {
  app: { name: string; icon_url: string | null };
  stores: StoreKey[];
  store: StoreKey;
  onStoreChange: (store: StoreKey) => void;
  connection: Connection;
  loadedAt: string | null;
  lastCheckedAt: string | null;
  syncing: boolean;
  now: number;
  onRefresh: () => void;
  exportHref: string;
  storeUrls: Partial<Record<StoreKey, string>>;
  onRemove: () => Promise<void>;
};

export function AppMasthead({ app, stores, store, onStoreChange, connection, loadedAt, lastCheckedAt, syncing, now, onRefresh, exportHref, storeUrls, onRemove }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const checked = relativeTime(lastCheckedAt, now);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <AppIcon app={app} size="size-12 sm:size-14" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl" title={app.name}>{app.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{stores.length > 0 ? stores.map((s) => STORE_META[s].label).join(" · ") : "No store listings"}</span>
            {syncing ? (
              <span className="inline-flex items-center gap-1 text-foreground/70"><IconRefresh className="size-3 motion-safe:animate-spin" aria-hidden /> checking the stores</span>
            ) : checked ? (
              <span title={`Store review APIs last checked ${new Date(lastCheckedAt!).toLocaleString()}. Apple and Google publish new reviews on their own delay.`}>· stores checked {checked}</span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {stores.length > 1 ? (
          <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5" role="group" aria-label="Store">
            {stores.map((val) => {
              const { label, Icon } = STORE_META[val];
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => onStoreChange(val)}
                  aria-pressed={store === val}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-(--dur-fast) ease-(--ease-out) pointer-coarse:h-10",
                    store === val ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}

        <LiveStatus connection={connection} loadedAt={loadedAt} refreshing={syncing} now={now} />

        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={syncing} title="Re-check the App Store and Google Play review APIs now (r)">
          <IconRefresh className={cn("size-3.5", syncing && "motion-safe:animate-spin")} aria-hidden />
          <span className="hidden sm:inline">{syncing ? "Refreshing" : "Refresh"}</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="More actions">
              <IconDotsVertical className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <a href={exportHref} download>
                <IconDownload className="size-4" aria-hidden /> Export reviews as CSV
              </a>
            </DropdownMenuItem>
            {stores.filter((s) => storeUrls[s]).map((s) => (
              <DropdownMenuItem key={s} asChild>
                <a href={storeUrls[s]} target="_blank" rel="noreferrer">
                  <IconExternalLink className="size-4" aria-hidden /> Open in {STORE_META[s].label}
                </a>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
              <IconTrash className="size-4" aria-hidden /> Remove app
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {app.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the tracked app, its stored reviews, ratings history and imported reports from Mission Control. The store listings themselves are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Keep</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (event) => {
                event.preventDefault();
                setRemoving(true);
                try { await onRemove(); setConfirm(false); } finally { setRemoving(false); }
              }}
            >
              {removing ? "Removing…" : "Remove app"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
