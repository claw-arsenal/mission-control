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
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AlertTriangleIcon, Trash2Icon, PencilIcon, PlusIcon, XIcon, CheckIcon } from "lucide-react";
import type { Assignee } from "@/types/tasks";

const SWATCHES = [
  "#5B7CF6", "#55A07A", "#F0A64F", "#EA6C73", "#8A7FF6",
  "#22D3EE", "#A78BFA", "#F472B6", "#F59E0B", "#10B981",
  "#64748B", "#0EA5E9",
];

type Props = {
  open: boolean;
  boardName: string;
  assignees: Assignee[];
  onCreate: (name: string, color: string, email: string) => Promise<{ ok: boolean; error?: string }>;
  onUpdate: (assigneeId: string, name: string, color: string, email: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (assigneeId: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
};

export function ManageAssigneesModal(props: Props) {
  return <ManageAssigneesDialog key={String(props.open)} {...props} />;
}

function ManageAssigneesDialog({ open, boardName, assignees, onCreate, onUpdate, onDelete, onClose }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editColor, setEditColor] = useState(SWATCHES[0]);


  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await onCreate(trimmed, color, email.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Failed to add assignee.");
      return;
    }
    setName("");
    setEmail("");
    setColor(SWATCHES[0]);
  };

  const startEdit = (a: Assignee) => {
    setEditingId(a.id);
    setEditName(a.name);
    setEditEmail(a.email ?? "");
    setEditColor(a.color);
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
    const result = await onUpdate(editingId, trimmed, editColor, editEmail.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Failed to update assignee.");
      return;
    }
    setEditingId(null);
  };

  const handleDelete = async (assigneeId: string) => {
    setBusy(true);
    setError("");
    const result = await onDelete(assigneeId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Failed to delete assignee.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Manage assignees</DialogTitle>
          <DialogDescription>
            Custom assignees for <span className="font-medium text-foreground">{boardName}</span>. They can be attached to tickets on this board.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="rounded-md border border-line bg-surface-2 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="ma-name" className="mb-1.5 block text-xs">Name</Label>
                <Input
                  id="ma-name"
                  placeholder="e.g. Alex Rivera"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
                />
              </div>
              <div>
                <Label htmlFor="ma-email" className="mb-1.5 block text-xs">
                  Email <span className="font-normal text-muted-foreground">(optional, enables mentions)</span>
                </Label>
                <Input
                  id="ma-email"
                  type="email"
                  placeholder="alex@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
                />
              </div>
            </div>
            <div className="mt-2 flex justify-end">
              <Button onClick={() => void handleAdd()} disabled={busy || !name.trim()} size="sm" className="gap-1.5">
                <PlusIcon className="h-4 w-4" /> Add
              </Button>
            </div>
            <div className="mt-2">
              <Label className="mb-1.5 block text-xs">Color</Label>
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
            {assignees.length === 0 ? (
              <Empty className="min-h-0 border-0 bg-transparent py-6">
                <EmptyHeader>
                  <EmptyTitle className="text-sm">No assignees yet</EmptyTitle>
                  <EmptyDescription className="text-xs">
                    Add one above so tickets on this board can be assigned.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="divide-y divide-line">
                {assignees.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                    {editingId === a.id ? (
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
                            placeholder="Name"
                          />
                          <Input
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void commitEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                            className="h-8"
                            placeholder="Email (optional)"
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
                        <div
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                          style={{ backgroundColor: a.color, color: "#fff" }}
                        >
                          {a.initials}
                        </div>
                        <div className="flex flex-1 min-w-0 flex-col">
                          <span className="truncate text-sm">{a.name}</span>
                          {a.email && (
                            <span className="truncate text-2xs text-muted-foreground">{a.email}</span>
                          )}
                        </div>
                        <Button size="icon-sm" variant="ghost" onClick={() => startEdit(a)} aria-label={`Edit ${a.name}`}>
                          <PencilIcon className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-danger-fg hover:text-danger-fg"
                          onClick={() => void handleDelete(a.id)}
                          disabled={busy}
                          aria-label={`Delete ${a.name}`}
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
