// @vitest-environment jsdom
import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKanbanShortcuts } from "./use-kanban-shortcuts";

afterEach(() => { cleanup(); document.body.innerHTML = ""; });

function mount(enabled = true) {
  const handlers = { onNewTicket: vi.fn(), onFocusSearch: vi.fn(), onToggleHelp: vi.fn() };
  renderHook(() => useKanbanShortcuts(handlers, enabled));
  return handlers;
}

describe("useKanbanShortcuts", () => {
  it("maps n, / and ? to their actions", () => {
    const handlers = mount();
    fireEvent.keyDown(document.body, { key: "n" });
    fireEvent.keyDown(document.body, { key: "/" });
    fireEvent.keyDown(document.body, { key: "?" });
    expect(handlers.onNewTicket).toHaveBeenCalledTimes(1);
    expect(handlers.onFocusSearch).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleHelp).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while typing in a field", () => {
    const handlers = mount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "n" });
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.appendChild(editable);
    fireEvent.keyDown(editable, { key: "n" });
    expect(handlers.onNewTicket).not.toHaveBeenCalled();
  });

  it("ignores modifier chords and open dialogs", () => {
    const handlers = mount();
    fireEvent.keyDown(document.body, { key: "n", ctrlKey: true });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    fireEvent.keyDown(document.body, { key: "n" });
    expect(handlers.onNewTicket).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const handlers = mount(false);
    fireEvent.keyDown(document.body, { key: "n" });
    expect(handlers.onNewTicket).not.toHaveBeenCalled();
  });
});
