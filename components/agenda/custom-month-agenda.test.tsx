// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CustomMonthAgenda, type ViewMode } from "./custom-month-agenda";

afterEach(cleanup);

describe("Agenda keyboard access", () => {
  it.each<ViewMode>(["month", "week", "day"])("opens an event with the keyboard in %s view", (viewMode) => {
    const onEventClick = vi.fn();
    // The app mounts one TooltipProvider at its root; mirror that here.
    render(<TooltipProvider><CustomMonthAgenda
      events={[{ id: "event", title: "Team briefing", start: "2026-09-07T10:00:00Z", end: "", allDay: false, extendedProps: { timezone: "UTC" } }]}
      viewMode={viewMode} currentDate={new Date(2026, 8, 7)} loading={false}
      onViewModeChange={vi.fn()} onDateChange={vi.fn()} onEventClick={onEventClick}
    /></TooltipProvider>);
    const event = screen.getByRole("button", { name: /Open Team briefing/ });
    fireEvent.keyDown(event, { key: "Enter" });
    expect(onEventClick).toHaveBeenCalledWith("event", "2026-09-07");
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDefined();
  });
});
