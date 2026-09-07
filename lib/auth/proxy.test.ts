import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ verifySession: vi.fn(), getSessionRole: vi.fn(), createSession: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  ...auth, SESSION_COOKIE: "mc-session", SESSION_DURATION_SECONDS: 604800, SESSION_REFRESH_THRESHOLD: 259200,
  sessionCookieAttrs: (maxAge: number) => ({ name: "mc-session", maxAge, path: "/", httpOnly: true }),
}));
vi.mock("@/lib/auth/roles", () => ({ getSessionRole: auth.getSessionRole }));
import proxy from "@/proxy";

beforeEach(() => {
  vi.resetAllMocks();
  auth.verifySession.mockResolvedValue({ sub: "operator", email: "operator@example.test", name: "Operator", exp: Math.floor(Date.now() / 1000) + 300000 });
  auth.getSessionRole.mockResolvedValue("member");
});

describe("Access revocation", () => {
  it("rejects a removed user's still-signed session on protected APIs", async () => {
    auth.getSessionRole.mockResolvedValue(null);
    const res = await proxy(new NextRequest("http://localhost/api/tasks"));
    expect(res.status).toBe(403);
    expect(res.cookies.get("mc-session")?.maxAge).toBe(0);
    expect(auth.createSession).not.toHaveBeenCalled();
  });

  it("allows an existing member", async () => {
    const res = await proxy(new NextRequest("http://localhost/api/tasks"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("fails closed if the access lookup is unavailable", async () => {
    auth.getSessionRole.mockRejectedValue(new Error("Database unavailable"));
    const res = await proxy(new NextRequest("http://localhost/api/tasks"));
    expect(res.status).toBe(503);
    expect(res.cookies.get("mc-session")).toBeUndefined();
  });
});
