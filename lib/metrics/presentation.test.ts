import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aggregateMetric, formatMetricValue, metricCsv, metricNumber } from "./presentation";
import { matchImport, parseMetricImport } from "./definition";
import { guardSelectOnly, bindNamedParams } from "./sql-guard";
import { computeBucketDelta, parseDbDateTime } from "./delta";

describe("metric interpretation", () => {
  it("preserves missing and invalid values without manufacturing zeroes", () => {
    for (const value of [null, undefined, "", " ", "unknown", NaN, Infinity, false]) expect(metricNumber(value)).toBeNull();
    expect(metricNumber("0")).toBe(0);
    expect(formatMetricValue(null)).toBe("Not available");
    expect(formatMetricValue("25", "Return (%)")).toBe("25%");
    expect(formatMetricValue(0.1, "Referral %")).toMatch(/^0[.,]1%$/);
  });
  it("makes KPI aggregation explicit and does not invent a latest value", () => {
    const rows = [{ v: 2 }, { v: 6 }, { v: null }];
    expect(aggregateMetric(rows, "v", "sum")).toBe(8);
    expect(aggregateMetric(rows, "v", "average")).toBe(4);
    expect(aggregateMetric(rows, "v", "latest")).toBeNull();
  });
  it("does not compare across missing calendar periods or missing values", () => {
    const options = { xColumn: "date", yColumn: "v", window: "monthly" as const, asOf: new Date(2026, 8, 7) };
    expect(computeBucketDelta({ ...options, rows: [{ date: "2026-06", v: 10 }, { date: "2026-08", v: 20 }] })).toBeNull();
    expect(computeBucketDelta({ ...options, rows: [{ date: "2026-07", v: null }, { date: "2026-08", v: 20 }] })).toBeNull();
    expect(parseDbDateTime("2026-09-07T10:00:00Z")?.toISOString()).toBe("2026-09-07T10:00:00.000Z");
  });
  it("escapes CSV cells and neutralizes spreadsheet formulas", () => {
    const csv = metricCsv([{ name: '=HYPERLINK("x")', count: -2 }, { name: 'a,b\nc', count: null }], ["name", "count"]);
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).toContain('"-2"');
    expect(csv).toContain('"a,b\nc",""');
  });
});

describe("metrics export", () => {
  const raw = JSON.parse(readFileSync(new URL("../../docs/metrics/metrics-export-2026-09-07-improved.json", import.meta.url), "utf-8"));
  it("validates all twelve improved definitions and binds their queries", () => {
    const entries = parseMetricImport(raw);
    expect(entries).toHaveLength(12);
    for (const entry of entries) {
      const guard = guardSelectOnly(entry.query);
      expect(guard, entry.title).toMatchObject({ ok: true });
      const bound = bindNamedParams(entry.query, { since: new Date(), until: new Date(), bucket: "%Y-%m" });
      expect(bound.sql).not.toMatch(/:(since|until|bucket)\b/);
      expect(entry.notes.length).toBeGreaterThan(100);
    }
    const retention = entries.find(entry => entry.title === "New-player return rate")!;
    expect(retention.yColumns).toHaveLength(2);
    expect(retention.yColumns.every(column => column.includes("%"))).toBe(true);
    expect(retention.query).toContain("period_end + INTERVAL 28 DAY <= cutoff");
  });
  it("matches renamed metrics without silently choosing ambiguous duplicates", () => {
    const entry = parseMetricImport(raw)[0];
    expect(matchImport(entry, [{ id: "old", name: entry.replaces! }])?.id).toBe("old");
    expect(() => matchImport(entry, [{ id: "old", name: entry.replaces! }, { id: "new", name: entry.title }])).toThrow("More than one");
    expect(() => parseMetricImport([raw[0], raw[0]])).toThrow("duplicate");
    expect(() => parseMetricImport([raw[0], { title: "Broken" }])).toThrow("Metric 2");
  });
});
