import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "border-line bg-card text-card-foreground",
        info: "border-info/30 bg-info-soft text-info-fg [&>svg]:text-info",
        success: "border-success/30 bg-success-soft text-success-fg [&>svg]:text-success",
        warning: "border-warning/30 bg-warning-soft text-warning-fg [&>svg]:text-warning",
        destructive:
          "border-danger/30 bg-danger-soft text-danger-fg [&>svg]:text-danger *:data-[slot=alert-description]:text-danger-fg/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={variant === "destructive" || variant === "warning" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-sm text-pretty [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

/** Trailing actions (retry, dismiss) aligned under the description. */
function AlertActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-actions"
      className={cn("col-start-2 mt-2 flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertActions, alertVariants }
