"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Maximize2Icon, XIcon } from "lucide-react";

type Props = {
  listTitle: string;
  /** Resolves true when the ticket was saved; the draft is cleared only then. */
  onSubmit: (title: string) => Promise<boolean>;
  onClose: () => void;
  onOpenFullEditor: () => void;
};

/** Inline title-only ticket entry at the foot of a list. Enter adds, Esc closes. */
export function QuickAddComposer({ listTitle, onSubmit, onClose, onOpenFullEditor }: Props) {
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    const saved = await onSubmit(trimmed);
    setPending(false);
    if (saved) {
      setTitle("");
      fieldRef.current?.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-2 rounded-xl border border-line bg-card p-2 shadow-elev-1"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && rootRef.current?.contains(next)) return;
        if (!title.trim() && !pending) onClose();
      }}
    >
      <Textarea
        ref={fieldRef}
        autoFocus
        rows={2}
        aria-label="New ticket title"
        placeholder={`Add to ${listTitle}…`}
        value={title}
        disabled={pending}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value.replace(/\n/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        className="min-h-0 resize-none border-0 bg-transparent px-1.5 py-1 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center gap-1">
        <Button size="sm" className="h-7 px-2.5 text-xs" disabled={!title.trim() || pending} onClick={() => void submit()}>
          {pending ? "Adding…" : "Add ticket"}
        </Button>
        <Button variant="ghost" size="icon-xs" className={cn("text-muted-foreground")} aria-label="Close composer" onClick={onClose}>
          <XIcon />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto text-muted-foreground"
          onClick={onOpenFullEditor}
          title="Open the full ticket editor"
        >
          <Maximize2Icon />
          Details
        </Button>
      </div>
    </div>
  );
}
