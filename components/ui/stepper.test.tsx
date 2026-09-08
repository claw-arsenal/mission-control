// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Stepper } from "./stepper";

afterEach(cleanup);

const steps = [
  { id: "what", label: "What to run" },
  { id: "when", label: "When to run it" },
  { id: "review", label: "Review" },
];

describe("Stepper", () => {
  it("marks only the current step for assistive technology", () => {
    render(<Stepper steps={steps} current={1} />);
    const marked = screen.getAllByLabelText(/^Step \d of 3/).filter((el) => el.getAttribute("aria-current") === "step");
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute("aria-label")).toBe("Step 2 of 3: When to run it");
  });

  it("is a read-only indicator without onSelect", () => {
    render(<Stepper steps={steps} current={2} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("lets the reader go back but not skip ahead", () => {
    const onSelect = vi.fn();
    render(<Stepper steps={steps} current={1} onSelect={onSelect} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("shows completed steps as done", () => {
    const { container } = render(<Stepper steps={steps} current={2} />);
    expect(container.querySelectorAll('[data-state="done"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-state="current"]')).toHaveLength(1);
  });
});
