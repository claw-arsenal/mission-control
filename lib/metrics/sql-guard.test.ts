import { describe, expect, it } from "vitest";
import { guardSelectOnly, bindNamedParams } from "./sql-guard";
import { usesBucket, usesWindow } from "./window";

describe("metric query boundaries", () => {
  it("rejects SELECT side effects and deliberate delays", () => {
    for (const sql of ["SELECT 1 INTO OUTFILE '/tmp/test'", "SELECT LOAD_FILE('/tmp/test')", "SELECT SLEEP(10)", "SELECT BENCHMARK(100, SHA1('x'))", "SELECT GET_LOCK('x', 5)"])
      expect(guardSelectOnly(sql), sql).toMatchObject({ ok: false });
    expect(guardSelectOnly("SELECT 'SLEEP and INTO' AS `OUTFILE`")).toMatchObject({ ok: true });
  });
  it("uses only actual bound placeholders to describe the time controls", () => {
    expect(usesWindow("SELECT ':since', `:until` /* :bucket */")).toBe(false);
    expect(usesBucket("SELECT 1 -- :bucket\n")).toBe(false);
    expect(usesBucket("SELECT DATE_FORMAT(created, :bucket)")).toBe(true);
    expect(usesWindow("SELECT * FROM events WHERE created >= :since")).toBe(true);
    expect(bindNamedParams("SELECT value::bucket", { bucket: 1 }).values).toEqual([]);
  });
});
