// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TiptapEditor } from "./tiptap-editor";

afterEach(cleanup);
describe("document editor compatibility", () => {
  it("loads external documents without emitting an edit or duplicating extensions", async () => {
    const onChange = vi.fn();
    const warn = vi.spyOn(console, "warn");
    try {
      const { rerender } = render(<TiptapEditor content="<p>First document</p>" onChange={onChange} ext=".html" />);
      await waitFor(() => expect(screen.getByRole("textbox", { name: "Document content" }).textContent).toBe("First document"));
      rerender(<TiptapEditor content="<p>Second document</p>" onChange={onChange} ext=".html" />);
      await waitFor(() => expect(screen.getByRole("textbox", { name: "Document content" }).textContent).toBe("Second document"));
      expect(onChange).not.toHaveBeenCalled();
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/duplicate extension/i);
    } finally { warn.mockRestore(); }
  });
});
