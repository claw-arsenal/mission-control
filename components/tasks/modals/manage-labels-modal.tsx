"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label as UiLabel } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AlertTriangleIcon, Trash2Icon, PencilIcon, PlusIcon, XIcon, CheckIcon } from "lucide-react";
import type { Label } from "@/types/tasks";

const SWATCHES = [
  "#5B7CF6", "#55A07A", "#F0A64F", "#EA6C73", "#8A7FF6",
  "#22D3EE", "#A78BFA", "#F472B6", "#F59E0B", "#10B981",
  "#64748B", "#0EA5E9",
];

type Props = {
  open: boolean;
  boardName: string;
  labels: Label[];
  onCreate: (name: string, color: string) => Promise<{ ok: boolean; error?: string }>;
  onUpdate: (labelId: string, name: string, color: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (labelId: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
};

export function ManageLabelsModal(props: Props) {
  return <ManageLabelsDialog key={String(props.open)} {...props} />;
}

function ManageLabelsDialog({ open, boardName, labels, onCreate, onUpdate, onDelete, onClose }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(SWATCHES[0]);


  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await onCreate(trimmed, color);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Failed to add label.");
      return;
    }
    setName("");
    setColor(SWATCHES[0]);
  };

  const startEdit = (l: Label) => {
    setEditingId(l.id);
    setEditName(l.name);
    setEditColor(l.color);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError("");
  };

  const commitEdit = async () => {
    if (!editingId) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await onUpdate(editingId, trimmed, editColor);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Failed to update label.");
      return;
    }
    setEditingId(null);
  };

  const handleDelete = async (labelId: string) => {
    setBusy(true);
    setError("");
    const result = await onDelete(labelId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Failed to delete label.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Manage labels</DialogTitle>
          <DialogDescription>
            Colored labels for <span className="font-medium text-foreground">{boardName}</span>.
            Tickets can be assigned one or more labels and filtered by them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="rounded-md border border-line bg-surface-2 p-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <UiLabel htmlFor="ml-name" className="mb-1.5 block text-xs">Name</UiLabel>
                <Input
                  id="ml-name"
                  placeholder="e.g. Backend"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
                />
              </div>
              <Button onClick={() => void handleAdd()} disabled={busy || !name.trim()} size="sm" className="gap-1.5">
                <PlusIcon className="h-4 w-4" /> Add
              </Button>
            </div>
            <div className="mt-2">
              <UiLabel className="mb-1.5 block text-xs">Color</UiLabel>
              <div className="flex flex-wrap gap-1.5">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Color ${swatch}`}
                    aria-pressed={color === swatch}
                    onClick={() => setColor(swatch)}
                    className={cn(
                      "size-6 rounded-full transition-transform duration-(--dur-fast) ease-(--ease-out)",
                      "motion-safe:hover:scale-110",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      color === swatch && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>That did not work</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="max-h-[280px] overflow-auto rounded-md border border-line">
            {labels.length === 0 ? (
              <Empty className="min-h-0 border-0 bg-transparent py-6">
                <EmptyHeader>
                  <EmptyTitle className="text-sm">No labels yet</EmptyTitle>
                  <EmptyDescription className="text-xs">
                    Add one above to start tagging tickets on this board.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="divide-y divide-line">
                {labels.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                    {editingId === l.id ? (
                      <>
                        <div className="flex flex-1 flex-col gap-1.5">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void commitEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            className="h-8"
                          />
                          <div className="flex flex-wrap gap-1">
                            {SWATCHES.map((swatch) => (
                              <button
                                key={swatch}
                                type="button"
                                aria-label={`Color ${swatch}`}
                                aria-pressed={editColor === swatch}
                                onClick={() => setEditColor(swatch)}
                                className={cn(
                                  "size-5 rounded-full",
                                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                                  editColor === swatch && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                                )}
                                style={{ backgroundColor: swatch }}
                              />
                            ))}
                          </div>
                        </div>
                        <Button size="icon-sm" variant="ghost" onClick={() => void commitEdit()} disabled={busy} aria-label="Save">
                          <CheckIcon className="h-4 w-4" />
                        </Button>
                        <Button size="icon-sm" variant="ghost" onClick={cancelEdit} aria-label="Cancel">
                          <XIcon className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ backgroundColor: l.color, color: "#fff" }}
                        >
                          {l.name}
                        </span>
                        <span className="flex-1" />
                        <Button size="icon-sm" variant="ghost" onClick={() => startEdit(l)} aria-label={`Edit ${l.name}`}>
                          <PencilIcon className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-danger-fg hover:text-danger-fg"
                          onClick={() => void handleDelete(l.id)}
                          disabled={busy}
                          aria-label={`Delete ${l.name}`}
                        >
                          <Trash2Icon className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
