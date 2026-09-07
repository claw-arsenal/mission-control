import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ name: "report.html", mimeType: "text/html", path: "/fixture/report.html" }));
vi.mock("@/lib/local-db", () => ({ getSql: () => async () => [{ artifact_payload: { files: [fixture] } }] }));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({ readFile: async () => Buffer.from("<html>Report</html>") }));
import { GET } from "@/app/api/agenda/artifacts/[stepId]/[filename]/route";

beforeEach(() => { fixture.name = "report.html"; fixture.mimeType = "text/html"; });

describe("Agenda artifact downloads", () => {
  it("downloads generated HTML without allowing same-origin script execution", async () => {
    const res = await GET(new Request("http://localhost/artifact"), { params: Promise.resolve({ stepId: "step", filename: fixture.name }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("supports Unicode filenames without returning a header encoding error", async () => {
    fixture.name = "résumé-日本語.txt";
    fixture.mimeType = "text/plain";
    const res = await GET(new Request("http://localhost/artifact"), { params: Promise.resolve({ stepId: "step", filename: fixture.name }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("filename*=UTF-8''");
  });
});
