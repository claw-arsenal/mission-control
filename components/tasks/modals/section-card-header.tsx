"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";

type Props = {
  label: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
};

export function SectionCardHeader({ label, count, collapsed, onToggle }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
      <div className="flex items-center gap-2">
        <p className="eyebrow">{label}</p>
        {typeof count === "number" && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={`Toggle ${label}`} aria-expanded={!collapsed}>
        <ChevronDownIcon className={cn("size-4 transition-transform duration-(--dur-fast) ease-(--ease-out)", collapsed && "-rotate-90")} />
      </Button>
    </div>
  );
}
