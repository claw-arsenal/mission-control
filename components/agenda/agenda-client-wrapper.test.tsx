// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgendaEventModal } from "./agenda-event-modal";
import type { AgendaEventSummary } from "./agenda-details-sheet";
import { AgendaClientWrapper } from "./agenda-client-wrapper";

const state = vi.hoisted(() => ({
  modal: {} as ComponentProps<typeof AgendaEventModal>,
  event: {} as AgendaEventSummary,
}));
vi.mock("./agenda-page-client", () => ({ AgendaPageClient: (props: { onEditEvent: (event: AgendaEventSummary) => void; onDayClick: (date: Date) => void }) => <>
  <button onClick={() => props.onEditEvent(state.event)}>Edit fixture</button>
  <button onClick={() => props.onDayClick(new Date(2026, 8, 7))}>Select September 7</button>
</> }));
vi.mock("./agenda-event-modal", () => ({ AgendaEventModal: (props: ComponentProps<typeof AgendaEventModal>) => { state.modal = props; return props.open ? <div>Draft editor</div> : null; } }));
vi.mock("./agenda-stats-cards", () => ({ AgendaStatsCards: () => null }));
vi.mock("./agenda-test-panel", () => ({ AgendaTestPanel: () => null }));
vi.mock("@/components/ui/container-loader", () => ({ ContainerLoader: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

beforeEach(() => {
  state.event = {
    id: "fixture", title: "Weekly report", freePrompt: "Prepare report", agentId: "", agentName: "", processIds: [], processNames: [],
    status: "draft", startDate: "2026-09-07", startTime: "10:00", endDate: "", endTime: "", timezone: "Europe/Amsterdam",
    recurrence: "weekly", recurrenceRule: "FREQ=WEEKLY;BYDAY=TU,TH", nextRuns: [], latestResult: null,
  };
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ ok: true, agents: [], processes: [], events: [], chats: [] })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Agenda editor handoff", () => {
  it("preserves selected weekdays when reopening a recurring event", async () => {
    await act(async () => { render(<AgendaClientWrapper />); });
    await act(async () => { fireEvent.click(screen.getByText("Edit fixture")); });
    expect(state.modal.initialData?.weekdays).toEqual(["2", "4"]);
  });

  it("keeps monthly schedules repeatable", async () => {
    state.event.recurrence = "monthly";
    state.event.recurrenceRule = "FREQ=MONTHLY";
    await act(async () => { render(<AgendaClientWrapper />); });
    await act(async () => { fireEvent.click(screen.getByText("Edit fixture")); });
    expect(state.modal.initialData?.taskType).toBe("repeatable");
    expect(state.modal.initialData?.frequency).toBe("monthly");
  });

  it("keeps the editor and its draft after a rejected save", async () => {
    state.event.recurrence = "none";
    await act(async () => { render(<AgendaClientWrapper />); });
    await act(async () => { fireEvent.click(screen.getByText("Edit fixture")); });
    vi.mocked(fetch).mockResolvedValue(Response.json({ ok: false, error: "Save unavailable" }, { status: 503 }));
    await act(async () => {
      await Promise.resolve(state.modal.onSave({ ...state.modal.initialData, weekdays: [] } as Parameters<typeof state.modal.onSave>[0])).catch(() => {});
    });
    expect(screen.queryByText("Draft editor")).not.toBeNull();
    expect(state.modal.initialData?.title).toBe("Weekly report");
  });

  it("uses the selected calendar date without converting midnight to UTC", async () => {
    await act(async () => { render(<AgendaClientWrapper />); });
    await act(async () => { fireEvent.click(screen.getByText("Select September 7")); });
    expect(state.modal.initialData?.startDate).toBe("2026-09-07");
  });
});
