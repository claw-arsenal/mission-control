import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const query = vi.fn();
  const connection = { query, release: vi.fn(), destroy: vi.fn() };
  const pool = { getConnection: vi.fn(async () => connection), end: vi.fn(), query: vi.fn() };
  return { query, connection, pool, createPool: vi.fn(() => pool), password: "first" };
});
vi.mock("mysql2/promise", () => ({ createPool: fixture.createPool }));
vi.mock("./secrets", () => ({ getMysqlCredentials: () => ({ ok: true, host: "localhost", port: 3306, database: "fixture", user: "reader", password: fixture.password }) }));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); fixture.password = "first"; fixture.query.mockReset(); });
describe("metric query execution", () => {
  it("sets a MySQL session limit before the actual query", async () => {
    fixture.query.mockResolvedValueOnce([]).mockResolvedValueOnce([[{ count: 10 }], [{ name: "count", type: 3 }]]);
    const { executeMetricQuery } = await import("./mysql");
    expect(await executeMetricQuery("SELECT count FROM fixture", [])).toMatchObject({ ok: true, rowCount: 1 });
    expect(fixture.query.mock.calls[0][0]).toBe("SET SESSION max_execution_time = 20000");
    expect(fixture.connection.release).toHaveBeenCalledOnce();
  });
  it("uses the MariaDB seconds limit when the MySQL variable is unavailable", async () => {
    fixture.query.mockRejectedValueOnce(new Error("Unknown system variable")).mockResolvedValueOnce([]).mockResolvedValueOnce([[], []]);
    const { executeMetricQuery } = await import("./mysql");
    expect(await executeMetricQuery("SELECT 1", [])).toMatchObject({ ok: true });
    expect(fixture.query.mock.calls[1][0]).toBe("SET SESSION max_statement_time = 20");
  });
  it("destroys a timed-out connection instead of returning its unfinished query to the pool", async () => {
    fixture.query.mockResolvedValueOnce([]).mockRejectedValueOnce(Object.assign(new Error("Timed out"), { code: "PROTOCOL_SEQUENCE_TIMEOUT" }));
    const { executeMetricQuery } = await import("./mysql");
    expect(await executeMetricQuery("SELECT 1", [])).toMatchObject({ ok: false });
    expect(fixture.connection.destroy).toHaveBeenCalledOnce();
    expect(fixture.connection.release).not.toHaveBeenCalled();
  });
  it("rotates the pool when only the password changes", async () => {
    fixture.query.mockResolvedValue([[], []]);
    const { executeMetricQuery } = await import("./mysql");
    await executeMetricQuery("SELECT 1", []);
    fixture.password = "second";
    await executeMetricQuery("SELECT 1", []);
    expect(fixture.createPool).toHaveBeenCalledTimes(2);
    expect(fixture.pool.end).toHaveBeenCalledOnce();
  });
  it("shares one pool when several dashboard cards start together", async () => {
    fixture.query.mockResolvedValue([[], []]);
    const { executeMetricQuery } = await import("./mysql");
    await Promise.all(Array.from({ length: 6 }, () => executeMetricQuery("SELECT 1", [])));
    expect(fixture.createPool).toHaveBeenCalledOnce();
  });
});
