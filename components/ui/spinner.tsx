import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The one spinner. Use it inline (buttons, rows) or as the fallback for cold
 * navigation; anything that has a layout to mirror should use Skeleton instead.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin text-muted-foreground motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Spinner }
