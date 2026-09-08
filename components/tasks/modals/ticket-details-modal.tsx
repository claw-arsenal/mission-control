"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TicketDocumentsSection } from "@/components/tasks/modals/ticket-documents-section";
import { TicketActivitySection } from "@/components/tasks/modals/ticket-activity-section";
import { TicketAttachmentsSection } from "@/components/tasks/modals/ticket-attachments-section";
import {
  TicketChecklistsSection,
  type ChecklistItem,
} from "@/components/tasks/modals/ticket-checklists-section";
import { TicketCommentsSection } from "@/components/tasks/modals/ticket-comments-section";
import { TicketSidebar } from "@/components/tasks/modals/ticket-sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  Assignee,
  Label as BoardLabelType,
  BoardState,
  TicketActivity,
  TicketAttachment,
  TicketComment,
  TicketDetailsForm,
  TicketSubtask,
} from "@/types/tasks";
import {
  ClipboardListIcon,
  CopyIcon,
  LinkIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  mode?: "create" | "edit";
  open: boolean;
  form: TicketDetailsForm;
  board: BoardState;
  assignees: Assignee[];
  labels: BoardLabelType[];
  boardId: string;
  attachments: TicketAttachment[];
  attachmentsLoading: boolean;
  attachmentsUploading: boolean;
  subtasks: TicketSubtask[];
  subtasksLoading: boolean;
  onAddSubtask: (title: string, checklistName: string) => void;
  onToggleSubtask: (subtaskId: string, completed: boolean) => void;
  onDeleteSubtask: (subtaskId: string) => void;
  onRenameChecklist: (oldName: string, newName: string) => void;
  onDeleteChecklist: (checklistName: string) => void;
  comments: TicketComment[];
  commentsLoading: boolean;
  commentDraft: string;
  onCommentDraftChange: (value: string) => void;
  onAddComment: () => void;
  onDeleteComment: (commentId: string) => void;
  activity: TicketActivity[];
  activityLoading: boolean;
  onChange: (patch: Partial<TicketDetailsForm>) => void;
  onUploadAttachments: (files: FileList | File[] | null) => void;
  onDeleteAttachment: (attachmentId: string) => void;
  onSave: (files?: File[], draftSubtasks?: { checklistName: string; title: string }[]) => void;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
};

// ── Component ────────────────────────────────────────────────────────────────

export function TicketDetailsModal({
  mode = "edit", open, form, board, assignees, labels, boardId,
  attachments, attachmentsLoading, attachmentsUploading,
  subtasks, subtasksLoading,
  onAddSubtask, onToggleSubtask, onDeleteSubtask,
  onRenameChecklist, onDeleteChecklist,
  comments, commentsLoading, commentDraft, onCommentDraftChange, onAddComment, onDeleteComment,
  activity, activityLoading, onChange, onUploadAttachments, onDeleteAttachment,
  onSave,
  onCopy, onDelete, onClose,
}: Props) {
  const isEditing = mode === "edit";
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [previewAtt, setPreviewAtt] = useState<TicketAttachment | null>(null);

  // ── Checklist local state ──────────────────────────────────────────────────
  // In create mode: localItems is the source of truth.
  // In edit mode: the subtasks prop is the source of truth; localItems is unused.
  const [localItems, setLocalItems] = useState<ChecklistItem[]>([]);
  const [checklistNamesState, setChecklistNamesState] = useState<string[]>(["Checklist"]);

  const activeItems: ChecklistItem[] = isEditing
    ? subtasks.map((s) => ({ id: s.id, title: s.title, completed: s.completed, checklistName: s.checklistName }))
    : localItems;

  const checklistNames: string[] = isEditing
    ? Array.from(
        new Set([
          ...subtasks.map((s) => s.checklistName),
          ...checklistNamesState.filter((n) => !subtasks.some((s) => s.checklistName === n)),
        ]),
      )
    : checklistNamesState;

  const handleRenameChecklist = (clName: string, newName: string) => {
    if (isEditing) {
      onRenameChecklist(clName, newName);
      return;
    }
    setLocalItems((prev) =>
      prev.map((item) => (item.checklistName === clName ? { ...item, checklistName: newName } : item)),
    );
    setChecklistNamesState((prev) => prev.map((n) => (n === clName ? newName : n)));
  };

  const handleAddItem = (clName: string, title: string) => {
    if (isEditing) {
      onAddSubtask(title, clName);
      return;
    }
    setLocalItems((prev) => [
      ...prev,
      { id: `local-${Date.now()}-${Math.random()}`, title, completed: false, checklistName: clName },
    ]);
  };

  const handleToggleItem = (itemId: string, completed: boolean) => {
    if (isEditing) {
      onToggleSubtask(itemId, completed);
      return;
    }
    setLocalItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, completed } : i)));
  };

  const handleDeleteItem = (itemId: string) => {
    if (isEditing) {
      onDeleteSubtask(itemId);
      return;
    }
    setLocalItems((prev) => prev.filter((i) => i.id !== itemId));
  };

  const handleDeleteChecklist = (clName: string) => {
    if (isEditing) {
      onDeleteChecklist(clName);
      return;
    }
    setLocalItems((prev) => prev.filter((i) => i.checklistName !== clName));
    setChecklistNamesState((prev) => prev.filter((n) => n !== clName));
  };

  const handleCreateChecklist = (name: string) => {
    setChecklistNamesState((prev) => (prev.includes(name) || checklistNames.includes(name) ? prev : [...prev, name]));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent showCloseButton={false} className="sm:max-w-[760px] max-h-[92vh] overflow-hidden p-0">
          {/* Header */}
          <DialogHeader className="px-4 pt-5 pb-0 sm:px-6">
            <div className="flex items-center gap-3">
              <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", isEditing ? "bg-primary/10" : "bg-primary")}>
                <ClipboardListIcon className={cn("size-4", isEditing ? "text-primary" : "text-primary-foreground")} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base">{isEditing ? "Edit ticket" : "New ticket"}</DialogTitle>
                <DialogDescription className="text-xs">
                  {isEditing ? "Update details, checklists, and attachments" : "Create a new ticket"}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {isEditing && (
                  <>
                    <Button variant="ghost" size="icon-sm" onClick={onCopy} aria-label="Copy ticket">
                      <CopyIcon className="size-3.5" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="More actions">
                          <MoreHorizontalIcon className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem variant="destructive" onClick={onDelete}>
                          <Trash2Icon className="size-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* Two-column layout; stacks below md so it holds at 390px. */}
          <div className="flex flex-col overflow-y-auto md:flex-row md:overflow-hidden" style={{ maxHeight: "calc(92vh - 130px)" }}>
            {/* ── Main column ─────────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-4 sm:px-6 md:overflow-y-auto">
              {/* Title */}
              <div className="flex flex-col gap-1">
                <Label htmlFor="ticket-title" className="text-xs font-semibold text-muted-foreground">Title</Label>
                <Input
                  id="ticket-title"
                  placeholder="Ticket title…"
                  value={form.title}
                  onChange={(e) => onChange({ title: e.target.value })}
                  className="h-10 text-base font-semibold"
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1">
                <Label htmlFor="ticket-description" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <FileTextIcon className="size-3" aria-hidden /> Description
                </Label>
                <Textarea
                  id="ticket-description"
                  placeholder="Add a more detailed description…"
                  value={form.description}
                  onChange={(e) => onChange({ description: e.target.value })}
                  rows={6}
                  className="min-h-[120px] resize-y text-sm"
                />
              </div>

              <TicketChecklistsSection
                items={activeItems}
                checklistNames={checklistNames}
                loading={isEditing && subtasksLoading}
                onToggleItem={handleToggleItem}
                onDeleteItem={handleDeleteItem}
                onAddItem={handleAddItem}
                onRenameChecklist={handleRenameChecklist}
                onDeleteChecklist={handleDeleteChecklist}
                onCreateChecklist={handleCreateChecklist}
              />

              <TicketAttachmentsSection
                mode={mode}
                attachments={attachments}
                loading={attachmentsLoading}
                uploading={attachmentsUploading}
                createFiles={createFiles}
                onAddCreateFiles={(files) => setCreateFiles((p) => [...p, ...files])}
                onRemoveCreateFile={(index) => setCreateFiles((p) => p.filter((_, j) => j !== index))}
                onUpload={onUploadAttachments}
                onDelete={onDeleteAttachment}
                onPreviewImage={setPreviewAtt}
              />

              {isEditing && (
                <TicketCommentsSection
                  assignees={assignees}
                  comments={comments}
                  loading={commentsLoading}
                  draft={commentDraft}
                  onDraftChange={onCommentDraftChange}
                  onAdd={onAddComment}
                  onDelete={onDeleteComment}
                />
              )}

              {isEditing && form.id && <TicketDocumentsSection ticketId={form.id} />}

              {isEditing && <TicketActivitySection activity={activity} loading={activityLoading} />}
            </div>

            {/* ── Sidebar ─────────────────────────────────────────── */}
            <TicketSidebar
              form={form}
              board={board}
              labels={labels}
              assignees={assignees}
              onChange={onChange}
            />
          </div>

          {/* Footer */}
          <DialogFooter className="border-t border-line px-4 py-3 sm:px-6">
            {isEditing && form.id && boardId && (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto gap-1.5 text-xs text-muted-foreground"
                onClick={() => {
                  if (typeof window === "undefined") return;
                  const url = `${window.location.origin}/boards?board=${boardId}&ticket=${form.id}`;
                  void navigator.clipboard?.writeText(url);
                }}
                title="Copy link to this ticket"
              >
                <LinkIcon className="size-3.5" />
                Copy link
              </Button>
            )}
            <Button
              onClick={() => {
                if (mode === "create") {
                  onSave(createFiles, localItems.map((i) => ({ checklistName: i.checklistName, title: i.title })));
                } else {
                  onSave();
                }
              }}
              className="gap-1.5"
            >
              <ClipboardListIcon className="size-3.5" />
              {isEditing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image preview */}
      <Dialog open={Boolean(previewAtt)} onOpenChange={(o) => { if (!o) setPreviewAtt(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewAtt?.name}</DialogTitle>
            <DialogDescription>Image preview</DialogDescription>
          </DialogHeader>
          {previewAtt && (
            <div className="relative h-[70vh] w-full">
              <Image
                src={previewAtt.url}
                alt={previewAtt.name}
                fill
                unoptimized
                className="rounded-md object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
