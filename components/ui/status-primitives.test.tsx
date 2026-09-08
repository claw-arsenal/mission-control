// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "./alert";
import { Badge } from "./badge";
import { Progress } from "./progress";
import { Spinner } from "./spinner";

afterEach(cleanup);

describe("Alert", () => {
  it("announces problems as alerts and notices as status", () => {
    const { rerender } = render(<Alert variant="destructive"><AlertTitle>Could not load</AlertTitle></Alert>);
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender(<Alert variant="warning"><AlertTitle>Store is stale</AlertTitle></Alert>);
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender(<Alert variant="info"><AlertTitle>Sync scheduled</AlertTitle></Alert>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("carries a recovery action alongside the message", () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Could not load activity</AlertTitle>
        <AlertDescription>The server returned 503.</AlertDescription>
        <AlertActions><button type="button">Try again</button></AlertActions>
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The server returned 503.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("draws every variant from the status tokens", () => {
    const { container, rerender } = render(<Alert variant="success">ok</Alert>);
    expect(container.querySelector(".bg-success-soft")).toBeTruthy();
    rerender(<Alert variant="warning">careful</Alert>);
    expect(container.querySelector(".bg-warning-soft")).toBeTruthy();
    rerender(<Alert variant="destructive">broken</Alert>);
    expect(container.querySelector(".bg-danger-soft")).toBeTruthy();
  });
});

describe("Badge", () => {
  it("offers status variants that use the shared tokens", () => {
    const { container, rerender } = render(<Badge variant="success">Sent</Badge>);
    expect(container.querySelector(".text-success-fg")).toBeTruthy();
    rerender(<Badge variant="warning">Retrying</Badge>);
    expect(container.querySelector(".text-warning-fg")).toBeTruthy();
    rerender(<Badge variant="info">Queued</Badge>);
    expect(container.querySelector(".text-info-fg")).toBeTruthy();
  });
});

describe("Spinner", () => {
  it("announces itself and stops moving under reduced motion", () => {
    const { container } = render(<Spinner />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    expect(container.querySelector(".motion-reduce\\:animate-none")).toBeTruthy();
  });
});

describe("Progress", () => {
  it("reports how far along it is", () => {
    const { container } = render(<Progress value={40} aria-label="Checklist" />);
    expect(screen.getByRole("progressbar", { name: "Checklist" })).toBeTruthy();
    const indicator = container.querySelector('[data-slot="progress-indicator"]') as HTMLElement;
    expect(indicator.style.transform).toBe("translateX(-60%)");
  });
});
