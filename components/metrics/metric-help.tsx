"use client";

import type { ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function MetricHelp({ label, children }: { label: string; children: ReactNode }) {
  return <Popover>
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`About ${label}`} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <InfoIcon className="size-4" />
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 motion-reduce:animate-none">Explain {label}</TooltipContent>
    </Tooltip>
    <PopoverContent align="start" className="max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto text-sm leading-relaxed motion-reduce:animate-none">
      <p className="mb-2 font-semibold">{label}</p>
      <div className="space-y-2 text-muted-foreground">{children}</div>
    </PopoverContent>
  </Popover>;
}
