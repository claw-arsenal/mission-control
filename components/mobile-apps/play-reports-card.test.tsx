// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayReportsCard } from "./play-reports-card";
afterEach(cleanup);
describe("report recovery controls", () => {
  it("keeps a refresh action available before any report has been imported", () => {
    const refresh = vi.fn();
    render(<PlayReportsCard installs={[]} crashes={[]} storePerformance={[]} trafficSources={[]} files={[]} breakdowns={[]} onRefresh={refresh}
      freshness={{ status: "unknown", latestOfficialMonth: null, latestProcessedMonth: null, checkedAt: null, processedAt: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh reports" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByText(/No report data is available yet/)).toBeTruthy();
  });
});
