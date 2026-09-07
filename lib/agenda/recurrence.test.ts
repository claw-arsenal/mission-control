import { describe, expect, it } from "vitest";
import { parseRecurrenceRule, toRecurrenceRule } from "./recurrence";

describe("Agenda recurrence round trips", () => {
  it.each([
    "FREQ=MONTHLY;BYDAY=1MO;COUNT=12",
    "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=10",
    "FREQ=DAILY;INTERVAL=3",
  ])("preserves advanced scheduling fields in %s", rule => {
    const { type, weekdays } = parseRecurrenceRule(rule);
    expect(toRecurrenceRule(type, weekdays, rule)).toBe(rule);
  });
  it("does not interpret a monthly ordinal weekday as a weekly schedule", () => {
    expect(parseRecurrenceRule("FREQ=MONTHLY;BYDAY=1MO")).toEqual({ type: "monthly", weekdays: [] });
  });
  it("changes weekdays without sorting the editor's state in place", () => {
    const weekdays = ["4", "2"];
    expect(toRecurrenceRule("weekly", weekdays, "FREQ=WEEKLY;BYDAY=MO")).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(weekdays).toEqual(["4", "2"]);
  });
});
