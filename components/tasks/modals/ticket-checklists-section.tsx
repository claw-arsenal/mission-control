"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CheckSquareIcon, PlusIcon, XIcon } from "lucide-react";

export type ChecklistItem = {
  id: string;
  title: string;
  completed: boolean;
  checklistName: string;
};

type Props = {
  items: ChecklistItem[];
  checklistNames: string[];
  loading?: boolean;
  onToggleItem: (itemId: string, completed: boolean) => void;
  onDeleteItem: (itemId: string) => void;
  onAddItem: (checklistName: string, title: string) => void;
  onRenameChecklist: (oldName: string, newName: string) => void;
  onDeleteChecklist: (checklistName: string) => void;
  onCreateChecklist: (name: string) => void;
};

export function TicketChecklistsSection({
  items,
  checklistNames,
  loading = false,
  onToggleItem,
  onDeleteItem,
  onAddItem,
  onRenameChecklist,
  onDeleteChecklist,
  onCreateChecklist,
}: Props) {
  const [draftsByChecklist, setDraftsByChecklist] = useState<Record<string, string>>({});
  const [editingChecklistName, setEditingChecklistName] = useState<string | null>(null);
  const [checklistNameDraft, setChecklistNameDraft] = useState("");
  const [newChecklistInput, setNewChecklistInput] = useState("");
  const [showAddChecklist, setShowAddChecklist] = useState(false);

  const finishRename = (clName: string) => {
    const newName = checklistNameDraft.trim();
    if (newName && newName !== clName) {
      onRenameChecklist(clName, newName);
      setDraftsByChecklist((prev) => {
        if (!(clName in prev)) return prev;
        const { [clName]: draft, ...rest } = prev;
        return { ...rest, [newName]: draft };
      });
    }
    setEditingChecklistName(null);
  };

  const addItem = (clName: string) => {
    const draft = (draftsByChecklist[clName] ?? "").trim();
    if (!draft) return;
    onAddItem(clName, draft);
    setDraftsByChecklist((prev) => ({ ...prev, [clName]: "" }));
  };

  const addChecklist = () => {
    onCreateChecklist(newChecklistInput.trim() || `Checklist ${checklistNames.length + 1}`);
    setNewChecklistInput("");
    setShowAddChecklist(false);
  };

  if (loading && items.length === 0) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading checklists">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-1.5 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {checklistNames.map((clName) => {
        const clItems = items.filter((i) => i.checklistName === clName);
        const done = clItems.filter((i) => i.completed).length;
        const total = clItems.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const draft = draftsByChecklist[clName] ?? "";
        const isEditingName = editingChecklistName === clName;

        return (
          <div key={clName} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <CheckSquareIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {isEditingName ? (
                <>
                  <Label htmlFor={`checklist-name-${clName}`} className="sr-only">
                    Checklist name
                  </Label>
                  <Input
                    id={`checklist-name-${clName}`}
                    autoFocus
                    value={checklistNameDraft}
                    onChange={(e) => setChecklistNameDraft(e.target.value)}
                    className="h-6 flex-1 px-1 text-xs font-semibold"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); finishRename(clName); }
                      if (e.key === "Escape") setEditingChecklistName(null);
                    }}
                    onBlur={() => finishRename(clName)}
                  />
                </>
              ) : (
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded text-left text-xs font-semibold text-foreground",
                    "transition-colors duration-(--dur-fast) ease-(--ease-out) hover:text-primary",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  )}
                  onClick={() => { setEditingChecklistName(clName); setChecklistNameDraft(clName); }}
                >
                  {clName}
                  <span className="sr-only"> (rename checklist)</span>
                </button>
              )}
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                {done}/{total}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                aria-label={`Delete checklist ${clName}`}
                onClick={() => onDeleteChecklist(clName)}
              >
                <XIcon className="text-muted-foreground" />
              </Button>
            </div>

            {total > 0 && (
              <Progress
                value={pct}
                className="h-1.5"
                indicatorClassName="bg-success"
                aria-label={`${clName} progress`}
              />
            )}

            {clItems.length > 0 ? (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {clItems.map((item) => (
                  <li
                    key={item.id}
                    className={cn(
                      "group flex items-center gap-2 px-3 py-2",
                      "transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover",
                    )}
                  >
                    <Checkbox
                      id={`checklist-item-${item.id}`}
                      checked={item.completed}
                      onCheckedChange={(c) => onToggleItem(item.id, Boolean(c))}
                    />
                    <label
                      htmlFor={`checklist-item-${item.id}`}
                      className={cn(
                        "flex-1 cursor-pointer text-sm",
                        item.completed && "text-muted-foreground line-through",
                      )}
                    >
                      {item.title}
                    </label>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete item ${item.title}`}
                      className="opacity-0 transition-opacity duration-(--dur-fast) ease-(--ease-out) group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => onDeleteItem(item.id)}
                    >
                      <XIcon className="text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty className="min-h-0 border-line py-4">
                <EmptyHeader>
                  <EmptyDescription className="text-xs">
                    No items in {clName} yet. Add the first one below.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}

            <div className="flex gap-2">
              <Label htmlFor={`checklist-add-${clName}`} className="sr-only">
                Add an item to {clName}
              </Label>
              <Input
                id={`checklist-add-${clName}`}
                value={draft}
                onChange={(e) => setDraftsByChecklist((prev) => ({ ...prev, [clName]: e.target.value }))}
                placeholder="Add item…"
                className="h-8 flex-1 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.trim()) {
                    e.preventDefault();
                    addItem(clName);
                  }
                }}
              />
              <Button size="sm" variant="secondary" disabled={!draft.trim()} onClick={() => addItem(clName)}>
                Add
              </Button>
            </div>
          </div>
        );
      })}

      {showAddChecklist ? (
        <div className="flex gap-2">
          <Label htmlFor="new-checklist-name" className="sr-only">New checklist name</Label>
          <Input
            id="new-checklist-name"
            autoFocus
            value={newChecklistInput}
            onChange={(e) => setNewChecklistInput(e.target.value)}
            placeholder="Checklist name…"
            className="h-8 flex-1 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addChecklist(); }
              if (e.key === "Escape") { setNewChecklistInput(""); setShowAddChecklist(false); }
            }}
          />
          <Button size="sm" variant="secondary" onClick={addChecklist}>Add</Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setNewChecklistInput(""); setShowAddChecklist(false); }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="xs" className="self-start" onClick={() => setShowAddChecklist(true)}>
          <PlusIcon /> Add checklist
        </Button>
      )}
    </div>
  );
}
