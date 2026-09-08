"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  name: string;
  initials: string;
  subtitle: string;
  selected?: boolean;
  onClick?: () => void;
};

export function AssigneeMiniCard({
  name,
  initials,
  subtitle,
  selected = false,
  onClick,
}: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "h-auto min-w-44 justify-start rounded-xl border px-3 py-2 text-left",
        "bg-surface-1 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover",
        selected
          ? "border-primary/60 ring-1 ring-primary/20"
          : "border-line",
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/80 text-2xs text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </Button>
  );
}
