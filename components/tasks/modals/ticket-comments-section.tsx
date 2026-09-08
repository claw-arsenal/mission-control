"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Assignee, TicketComment } from "@/types/tasks";
import { SendHorizonalIcon, SquarePenIcon, Trash2Icon } from "lucide-react";

const formatDate = (v: string) =>
  new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const initialsOf = (name: string) => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "OC";
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
};

type Props = {
  assignees: Assignee[];
  comments: TicketComment[];
  loading: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onDelete: (commentId: string) => void;
};

export function TicketCommentsSection({
  assignees,
  comments,
  loading,
  draft,
  onDraftChange,
  onAdd,
  onDelete,
}: Props) {
  // Detect an active `@<partial>` token at the caret so we can suggest assignees.
  // Simpler than full caret-tracking: match the last `@…` token at end of draft.
  const match = draft.match(/(^|\s)@([^\s@]{0,40})$/);
  const partial = match ? match[2].toLowerCase() : null;
  const suggestions = match
    ? assignees
        .filter((a) => (partial === "" ? Boolean(a.email) : a.name.toLowerCase().includes(partial!) && Boolean(a.email)))
        .slice(0, 6)
    : [];

  const pick = (name: string) => {
    onDraftChange(draft.replace(/(^|\s)@([^\s@]{0,40})$/, (_m, lead) => `${lead}@${name} `));
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="ticket-comment-draft" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <SquarePenIcon className="size-3" aria-hidden /> Comments
      </Label>

      <div className="flex gap-2">
        <Input
          id="ticket-comment-draft"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Write a comment… use @name to mention"
          className="h-8 flex-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim() && suggestions.length === 0) {
              e.preventDefault();
              onAdd();
            }
            if (e.key === "Enter" && suggestions.length > 0) {
              e.preventDefault();
              pick(suggestions[0].name);
            }
          }}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onAdd}
          disabled={!draft.trim()}
          aria-label="Post comment"
        >
          <SendHorizonalIcon className="size-3.5" />
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div className="rounded-md border border-line bg-popover p-1 shadow-elev-2">
          {suggestions.map((a, idx) => (
            <button
              key={a.id}
              type="button"
              onClick={() => pick(a.name)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs",
                "transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                idx === 0 && "bg-surface-hover",
              )}
            >
              {/* Assignee colour is per-entity data, so it stays an inline style. */}
              <span
                className="flex size-5 items-center justify-center rounded-full text-2xs font-semibold"
                style={{ backgroundColor: a.color, color: "#fff" }}
              >
                {a.initials}
              </span>
              <span className="flex-1 truncate">{a.name}</span>
              {a.email && <span className="truncate text-2xs text-muted-foreground">{a.email}</span>}
            </button>
          ))}
        </div>
      )}

      {loading && comments.length === 0 ? (
        <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="Loading comments">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : comments.length === 0 ? (
        <Empty className="min-h-0 border-line py-4">
          <EmptyHeader>
            <EmptyDescription className="text-xs">
              No comments yet. Be the first to leave one.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="max-h-[160px]">
          <ul className="space-y-1.5">
            {comments.map((c) => (
              <li key={c.id} className="flex items-start gap-2 rounded-md border border-line bg-surface-2 p-2">
                <Avatar className="mt-0.5 size-5">
                  <AvatarFallback className="text-2xs">{initialsOf(c.authorName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{c.authorName}</span>
                    <time dateTime={c.createdAt} className="text-2xs tabular-nums text-muted-foreground">
                      {formatDate(c.createdAt)}
                    </time>
                  </div>
                  <p className="text-xs whitespace-pre-wrap text-foreground/80">{c.content}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-danger-fg hover:text-danger-fg"
                  aria-label={`Delete comment by ${c.authorName}`}
                  onClick={() => onDelete(c.id)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
