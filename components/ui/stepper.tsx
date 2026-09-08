"use client"

import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type Step = {
  id: string
  label: string
}

type Props = {
  steps: Step[]
  /** Index of the step being shown, zero based. */
  current: number
  /**
   * Called when a step is chosen. Omit to make the stepper a read-only
   * indicator; only steps at or before the current one are selectable.
   */
  onSelect?: (index: number) => void
  className?: string
}

/**
 * Progress through a multi-step form. Completed steps show a check, the
 * current step is marked with `aria-current="step"`, and labels drop away on
 * narrow screens so the row never wraps.
 */
export function Stepper({ steps, current, onSelect, className }: Props) {
  return (
    <ol className={cn("flex w-full items-center gap-1", className)}>
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming"
        const selectable = Boolean(onSelect) && index <= current
        const Marker = selectable ? "button" : "div"

        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1">
            <Marker
              {...(selectable
                ? { type: "button" as const, onClick: () => onSelect?.(index) }
                : {})}
              aria-current={state === "current" ? "step" : undefined}
              aria-label={`Step ${index + 1} of ${steps.length}: ${step.label}`}
              data-state={state}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-(--dur-fast) ease-(--ease-out)",
                selectable && "hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring",
                !selectable && "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular-nums",
                  state === "done" && "bg-primary/15 text-primary",
                  state === "current" && "bg-primary text-primary-foreground",
                  state === "upcoming" && "bg-surface-2 text-muted-foreground ring-1 ring-line",
                )}
              >
                {state === "done" ? <CheckIcon className="size-3" aria-hidden /> : index + 1}
              </span>
              <span
                className={cn(
                  "hidden truncate text-xs sm:block",
                  state === "current" ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </Marker>

            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn("h-px min-w-2 flex-1 rounded-full", index < current ? "bg-primary/40" : "bg-line")}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
