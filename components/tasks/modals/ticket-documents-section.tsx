"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  FileTextIcon,
  FileCodeIcon,
  FileIcon,
  LinkIcon,
  PlusIcon,
  XIcon,
  ExternalLinkIcon,
  GlobeIcon,
  FolderOpenIcon,
} from "lucide-react";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkDocumentDialog } from "@/components/tasks/modals/link-document-dialog";
import { useModules } from "@/components/modules/modules-provider";

type LinkedDocument = {
  id: string;
  relative_path: string;
  kind: "file" | "folder";
  size_bytes: number;
  extension: string | null;
  last_edited_by_name: string | null;
  last_edited_by_email: string | null;
  updated_at: string;
  linked_by_name: string | null;
  linked_at: string;
};

type TicketLink = {
  id: string;
  kind: "url" | "path";
  url: string;
  label: string | null;
  added_by_name: string | null;
  added_at: string;
};

type Props = {
  ticketId: string | null;
};

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Copies text to the clipboard. Returns synchronously (so the execCommand
 * fallback stays inside the user gesture) and works in non-secure contexts —
 * the dashboard is often served over plain http where navigator.clipboard is
 * unavailable.
 */
function copyText(text: string): boolean {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    void navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function iconFor(ext: string | null): typeof FileTextIcon {
  if (!ext) return FileIcon;
  if ([".md", ".markdown", ".txt", ".rtf"].includes(ext)) return FileTextIcon;
  if ([".html", ".htm", ".js", ".ts", ".tsx", ".jsx", ".json", ".yaml", ".yml", ".sql", ".py", ".sh", ".css", ".scss"].includes(ext)) return FileCodeIcon;
  return FileIcon;
}
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function TicketDocumentsSection({ ticketId }: Props) {
  const { isEnabled } = useModules();
  const moduleEnabled = isEnabled("documents");
  const [docs, setDocs] = useState<LinkedDocument[]>([]);
  const [links, setLinks] = useState<TicketLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!ticketId || !moduleEnabled) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [docsRes, linksRes] = await Promise.all([
        fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "listTicketDocuments", ticketId }),
        }).then((r) => r.json()),
        fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "listTicketLinks", ticketId }),
        }).then((r) => r.json()),
      ]);
      if (docsRes.ok) setDocs(docsRes.documents || []);
      if (linksRes.ok) setLinks(linksRes.links || []);
      if (!docsRes.ok || !linksRes.ok) {
        setLoadError(docsRes.error || linksRes.error || "The request did not complete.");
      }
    } catch {
      setLoadError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [ticketId, moduleEnabled]);

  useEffect(() => { void load(); }, [load]);

  const unlink = useCallback(async (documentId: string) => {
    if (!ticketId) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unlinkTicketDocument", ticketId, documentId }),
    });
    await load();
  }, [ticketId, load]);

  const removeLink = useCallback(async (linkId: string) => {
    if (!ticketId) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "removeTicketLink", ticketId, linkId }),
    });
    await load();
  }, [ticketId, load]);

  const alreadyLinkedIds = useMemo(() => new Set(docs.map((d) => d.id)), [docs]);

  if (!ticketId) return null;
  // Module disabled — render nothing at all (silent integration).
  if (!moduleEnabled) return null;

  return (
    <div className="flex flex-col gap-2">
      <Label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <LinkIcon className="size-3" aria-hidden /> Documents and links ({docs.length + links.length})
      </Label>

      {loadError ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Documents and links are unavailable</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
          <AlertActions>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              Try again
            </Button>
          </AlertActions>
        </Alert>
      ) : loading && docs.length === 0 && links.length === 0 ? (
        <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="Loading documents and links">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : docs.length === 0 && links.length === 0 ? (
        <Empty className="min-h-0 border-line py-4">
          <EmptyHeader>
            <EmptyDescription className="text-xs">
              No documents or links yet. Link a document, a URL, or a file path to keep the context
              with the ticket.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {docs.map((d) => {
            const Icon = iconFor(d.extension);
            return (
              <li
                key={d.id}
                className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.relative_path}</p>
                  <p className="truncate text-2xs text-muted-foreground">
                    {bytes(d.size_bytes)}
                    {d.last_edited_by_name && ` · edited ${relTime(d.updated_at)} by ${d.last_edited_by_name}`}
                  </p>
                </div>
                <Button variant="ghost" size="icon-xs" asChild>
                  <a
                    href={`/documents?path=${encodeURIComponent(d.relative_path)}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${d.relative_path} in Documents`}
                    title="Open in Documents"
                  >
                    <ExternalLinkIcon />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-danger-fg"
                  aria-label={`Unlink ${d.relative_path}`}
                  onClick={() => void unlink(d.id)}
                >
                  <XIcon />
                </Button>
              </li>
            );
          })}
          {links.map((l) => {
            const isPath = l.kind === "path";
            const display = l.label?.trim() || (isPath ? basenameOf(l.url) : hostnameOf(l.url));
            const Icon = isPath ? FolderOpenIcon : GlobeIcon;
            return (
              <li
                key={l.id}
                className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{display}</p>
                  <p className="truncate font-mono text-2xs text-muted-foreground">{l.url}</p>
                </div>
                {isPath ? (
                  <Button variant="ghost" size="icon-xs" asChild>
                    <a
                      href={`mc-explorer:${encodeURIComponent(l.url)}`}
                      onClick={() => {
                        // The href still fires the mc-explorer: handler for anyone
                        // who installed it. Regardless, copy the path so it always
                        // does something useful even without the handler.
                        const ok = copyText(l.url);
                        if (ok) {
                          toast.success("Path copied to clipboard", {
                            description: "If Explorer didn't open, paste it into Explorer's address bar (Win+E, then Ctrl+L).",
                          });
                        } else {
                          toast.error("Couldn't copy automatically, here's the path", { description: l.url });
                        }
                      }}
                      aria-label={`Copy path ${l.url}`}
                      title="Copy path (and open in Explorer if the one-time setup is installed)"
                    >
                      <ExternalLinkIcon />
                    </a>
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon-xs" asChild>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`Open link ${display}`}
                      title="Open link"
                    >
                      <ExternalLinkIcon />
                    </a>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-danger-fg"
                  aria-label={`Remove link ${display}`}
                  onClick={() => void removeLink(l.id)}
                >
                  <XIcon />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 self-start text-xs"
        onClick={() => setPickerOpen(true)}
        disabled={loading}
      >
        <PlusIcon className="size-3.5" />
        Link document, URL, or path
      </Button>

      <LinkDocumentDialog
        open={pickerOpen}
        ticketId={ticketId}
        alreadyLinkedIds={alreadyLinkedIds}
        onClose={() => setPickerOpen(false)}
        onLinked={() => void load()}
      />
    </div>
  );
}
