// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgendaEventModal } from "./agenda-event-modal";

vi.mock("@/lib/use-models", () => ({ useModels: () => [] }));
vi.mock("./agenda-simulate-modal", () => ({ AgendaSimulateModal: () => null }));
afterEach(cleanup);

describe("Agenda save recovery", () => {
  it("keeps the entered date and time when changing the timezone", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const onSave = vi.fn();
    render(<AgendaEventModal open initialData={{ title: "Christmas report", request: "Prepare report", startDate: "2026-12-25", startTime: "10:15", timezone: "Europe/Amsterdam" }} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Timezone" }), { key: "ArrowDown" });
    await act(async () => { fireEvent.keyDown(screen.getByRole("option", { name: "UTC" }), { key: "Enter" }); });
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ startDate: "2026-12-25", startTime: "10:15", timezone: "UTC" });
  });

  it("retains the review and draft until saving succeeds, preventing duplicate submissions", async () => {
    let resolve!: () => void;
    const onSave = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    render(<AgendaEventModal open initialData={{ title: "Keep my draft", request: "Prepare a report", startDate: "2026-09-07", startTime: "10:00" }} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /Review/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.queryByRole("button", { name: /Saving/ })).not.toBeNull();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByText("Keep my draft").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Saving/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
  });
});
