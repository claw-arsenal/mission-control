export type RecurrenceType = "none" | "daily" | "weekly" | "monthly";

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseRecurrenceRule(rule: string | null | undefined): { type: RecurrenceType; weekdays: string[] } {
  const frequency = rule?.match(/(?:^|[;:])FREQ=(DAILY|WEEKLY|MONTHLY)(?:;|$)/)?.[1];
  if (!frequency) return { type: "none", weekdays: [] };
  const type = frequency.toLowerCase() as Exclude<RecurrenceType, "none">;
  const weekdays = type === "weekly"
    ? (rule?.match(/BYDAY=([^;]+)/)?.[1].split(",") ?? [])
      .map((day) => DAYS.indexOf(day)).filter((day) => day >= 0).map(String)
    : [];
  return { type, weekdays };
}

export function toRecurrenceRule(type: RecurrenceType, weekdays: string[], original?: string | null): string | null {
  if (type === "none") return null;
  const previous = parseRecurrenceRule(original);
  // Retain INTERVAL, COUNT and advanced RRULE fields when their controls did not change.
  if (original && previous.type === type && (type !== "weekly" ||
    [...previous.weekdays].sort().join(",") === [...weekdays].sort().join(","))) return original;
  if (type === "weekly") {
    const days = [...new Set(weekdays)].sort().map((day) => DAYS[Number(day)]).filter(Boolean);
    return `FREQ=WEEKLY;BYDAY=${days.length ? days.join(",") : "MO"}`;
  }
  return `FREQ=${type.toUpperCase()}`;
}
