/** "just now", "4m ago", "3h ago", "2d ago". Null-safe for unknown times. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "10:32" for today, otherwise "8 Sep, 10:32". */
export function clockTime(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

/** "202609" → "2026-09". */
export function formatMonth(yyyymm: string | null): string {
  if (!yyyymm || yyyymm.length !== 6) return yyyymm ?? "—";
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
}

export function formatCount(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}
