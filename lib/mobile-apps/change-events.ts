import type { getSql } from "@/lib/local-db";

type Sql = ReturnType<typeof getSql>;

export const CHANGE_CHANNEL = "mobile_apps_change";

export const CHANGE_KINDS = ["reviews", "listing", "reports", "job", "app"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const JOB_STATUSES = ["queued", "running", "success", "partial", "failed", "skipped"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * One change to Mobile Applications data, as published over PostgreSQL NOTIFY
 * and forwarded to browsers. `appId: null` means every app is affected (the
 * worker's global incremental pass).
 */
export type MobileAppsChange = {
  kind: ChangeKind;
  appId: string | null;
  listingId?: string;
  store?: "apple" | "google";
  jobId?: string;
  jobStatus?: JobStatus;
  /** reviews: rows newly inserted by the publishing sync. */
  inserted?: number;
  /** ISO time the change was published. */
  at: string;
};

export type ChangeInput = Omit<MobileAppsChange, "at"> & { at?: string };

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * Parse a NOTIFY payload. The database trigger still publishes the legacy
 * `{appId}` shape; it means "reviews were inserted for this app".
 */
export function parseChange(payload: string): MobileAppsChange | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const appId = obj.appId === null || obj.appId === undefined ? null : obj.appId;
  if (appId !== null && !isString(appId)) return null;
  const kind = obj.kind === undefined ? "reviews" : obj.kind;
  if (!CHANGE_KINDS.includes(kind as ChangeKind)) return null;
  const change: MobileAppsChange = { kind: kind as ChangeKind, appId, at: isString(obj.at) ? obj.at : new Date().toISOString() };
  if (isString(obj.listingId)) change.listingId = obj.listingId;
  if (obj.store === "apple" || obj.store === "google") change.store = obj.store;
  if (isString(obj.jobId)) change.jobId = obj.jobId;
  if (JOB_STATUSES.includes(obj.jobStatus as JobStatus)) change.jobStatus = obj.jobStatus as JobStatus;
  if (typeof obj.inserted === "number" && Number.isFinite(obj.inserted)) change.inserted = obj.inserted;
  return change;
}

const keyOf = (c: MobileAppsChange) => `${c.kind}|${c.appId ?? "*"}|${c.listingId ?? ""}|${c.jobId ?? ""}`;

/**
 * Collapse a burst into one change per (kind, app, listing, job). The latest
 * change wins its scalar fields; inserted counts are summed. First-seen order
 * is preserved so listeners apply changes in publication order.
 */
export function coalesceChanges(changes: MobileAppsChange[]): MobileAppsChange[] {
  const out = new Map<string, MobileAppsChange>();
  for (const change of changes) {
    const key = keyOf(change);
    const prev = out.get(key);
    if (!prev) {
      out.set(key, { ...change });
      continue;
    }
    const latest = change.at >= prev.at ? change : prev;
    const inserted = (prev.inserted ?? 0) + (change.inserted ?? 0);
    out.set(key, { ...prev, ...latest, ...(inserted > 0 ? { inserted } : {}) });
  }
  return [...out.values()];
}

/** Publish a change. Never throws: a lost notification degrades to polling. */
export async function publishChange(sql: Sql, input: ChangeInput, now: () => Date = () => new Date()): Promise<void> {
  const change: MobileAppsChange = { ...input, at: input.at ?? now().toISOString() };
  try {
    await sql`select pg_notify('mobile_apps_change', ${JSON.stringify(change)})`;
  } catch {
    /* A missed notification is recovered by the next revalidation. */
  }
}
