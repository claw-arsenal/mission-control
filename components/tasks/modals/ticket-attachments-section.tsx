"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { TicketAttachment } from "@/types/tasks";
import {
  DownloadIcon,
  EyeIcon,
  FileIcon,
  ImageIcon,
  PaperclipIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

const fmtBytes = (s: number) =>
  s < 1024 ? `${s} B` : s < 1048576 ? `${(s / 1024).toFixed(1)} KB` : `${(s / 1048576).toFixed(1)} MB`;

type Props = {
  mode: "create" | "edit";
  attachments: TicketAttachment[];
  loading: boolean;
  uploading: boolean;
  createFiles: File[];
  onAddCreateFiles: (files: File[]) => void;
  onRemoveCreateFile: (index: number) => void;
  onUpload: (files: FileList | File[] | null) => void;
  onDelete: (attachmentId: string) => void;
  onPreviewImage: (attachment: TicketAttachment) => void;
};

export function TicketAttachmentsSection({
  mode,
  attachments,
  loading,
  uploading,
  createFiles,
  onAddCreateFiles,
  onRemoveCreateFile,
  onUpload,
  onDelete,
  onPreviewImage,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isEditing = mode === "edit";
  const count = isEditing ? attachments.length : createFiles.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <PaperclipIcon className="size-3" aria-hidden /> Attachments
        </Label>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            if (mode === "create") {
              if (e.target.files?.length) onAddCreateFiles(Array.from(e.target.files));
            } else {
              onUpload(e.target.files);
            }
            e.currentTarget.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="xs"
          disabled={uploading}
          aria-label="Add attachment"
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner className="size-3" /> : <PlusIcon />} Add
        </Button>
      </div>

      {mode === "create" && createFiles.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {createFiles.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs"
            >
              <FileIcon className="size-3 text-muted-foreground" aria-hidden />
              <span className="max-w-[120px] truncate">{f.name}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${f.name}`}
                onClick={() => onRemoveCreateFile(i)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {isEditing && loading && attachments.length === 0 ? (
        <div className="flex flex-wrap gap-2" aria-busy="true" aria-label="Loading attachments">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-32" />
        </div>
      ) : isEditing && attachments.length === 0 ? (
        <Empty className="min-h-0 border-line py-4">
          <EmptyHeader>
            <EmptyDescription className="text-xs">
              No attachments yet. Use Add to upload a file to this ticket.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : isEditing ? (
        <ul className="flex flex-wrap gap-2">
          {attachments.map((att) => {
            const mime = att.mimeType || "application/octet-stream";
            const url = att.url || "";
            const isImage = mime.startsWith("image/");
            const isPdf = mime === "application/pdf";
            const isPreviewable = isImage || isPdf;
            const isDataUrl = url.startsWith("data:");
            const downloadUrl = isDataUrl
              ? url
              : url.includes("/api/files?")
                ? `${url}&download=1`
                : url;

            return (
              <li
                key={att.id}
                className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs"
              >
                {isImage ? (
                  <ImageIcon className="size-3 text-muted-foreground" aria-hidden />
                ) : (
                  <FileIcon className="size-3 text-muted-foreground" aria-hidden />
                )}
                <span className="max-w-[120px] truncate">{att.name}</span>
                <span className="tabular-nums text-muted-foreground">{fmtBytes(att.size)}</span>
                {isPreviewable && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Preview ${att.name}`}
                    onClick={() => {
                      if (isImage) onPreviewImage(att);
                      else window.open(url, "_blank");
                    }}
                  >
                    <EyeIcon />
                  </Button>
                )}
                <Button variant="ghost" size="icon-xs" asChild>
                  <a
                    href={downloadUrl}
                    download={att.name}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Download ${att.name}`}
                  >
                    <DownloadIcon />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-danger-fg hover:text-danger-fg"
                  aria-label={`Delete ${att.name}`}
                  onClick={() => onDelete(att.id)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : count === 0 ? (
        <Empty className="min-h-0 border-line py-4">
          <EmptyHeader>
            <EmptyDescription className="text-xs">
              No files attached yet. They upload when you create the ticket.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </div>
  );
}
