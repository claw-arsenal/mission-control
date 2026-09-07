import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.hoisted(() => vi.fn());
vi.mock("@/lib/local-db", () => ({ getSql: () => sql }));
vi.mock("@/scripts/openclaw-config.mjs", () => ({ buildCleanEnv: () => ({}) }));
vi.mock("@/scripts/runtime-artifacts.mjs", () => ({ deleteEventArtifacts: vi.fn() }));
import { PATCH } from "@/app/api/agenda/events/[id]/route";

beforeEach(() => {
  sql.mockReset().mockImplementation(async (strings: TemplateStringsArray) => {
    const query = strings.join("?").toLowerCase();
    if (query.includes("from workspaces")) return [{ id: "workspace" }];
    if (query.includes("select * from agenda_events")) return [{
      id: "event", title: "Original series", recurrence_rule: "FREQ=DAILY", status: "draft",
      starts_at: "2027-09-07T10:00:00Z", timezone: "UTC", free_prompt: "Report",
    }];
    return [];
  });
});

describe("Recurring event edit scope", () => {
  it.each(["single", "this_and_future"])("rejects %s without an occurrence instead of editing the whole series", async (scope) => {
    const res = await PATCH(new Request("http://localhost/api/agenda/events/event", {
      method: "PATCH", body: JSON.stringify({ editScope: scope, occurrenceId: null, title: "Changed", timeStepMinutes: 0 }),
    }), { params: Promise.resolve({ id: "event" }) });
    expect(res.status).toBe(400);
    const queries = sql.mock.calls.map(([strings]) => (strings as string[]).join("?").trim());
    expect(queries.some((query) => /^(update|insert|delete)/i.test(query))).toBe(false);
  });
});
