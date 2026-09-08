// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AttentionPanel } from "./attention-panel";
import type { AttentionItem } from "@/lib/db/dashboard-pulse";

afterEach(cleanup);

const NOW = Date.parse("2026-09-08T12:00:00Z");

const items: AttentionItem[] = [
  { id: "service:worker", kind: "service", severity: "danger", title: "worker", detail: "Heartbeat lost", at: "2026-09-08T11:30:00Z", href: "/logs" },
  { id: "agenda:1", kind: "agenda", severity: "danger", title: "Nightly digest", detail: "Failed after 2 attempts", at: "2026-09-08T02:00:00Z", href: "/agenda" },
  { id: "ticket:1", kind: "ticket", severity: "warning", title: "Rotate API keys", detail: "Overdue · Ops", at: "2026-09-05", href: "/boards?board=b&ticket=1" },
];

describe("AttentionPanel", () => {
  it("teaches what the panel is for when nothing needs attention", () => {
    render(<AttentionPanel items={[]} now={NOW} />);
    expect(screen.getByText("Nothing needs attention")).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("links every item to where it is recovered and says how long ago", () => {
    render(<AttentionPanel items={items} now={NOW} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/logs", "/agenda", "/boards?board=b&ticket=1"]);
    expect(screen.getByText("30m ago")).toBeDefined();
    expect(screen.getByText("10h ago")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("names kind and severity for screen readers rather than colour alone", () => {
    render(<AttentionPanel items={items} now={NOW} />);
    expect(screen.getByText("Service, failed")).toBeDefined();
    expect(screen.getByText("Ticket, warning")).toBeDefined();
  });
});
