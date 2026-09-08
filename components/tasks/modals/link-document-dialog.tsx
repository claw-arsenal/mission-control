"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertTriangleIcon,
  FileIcon,
  FileTextIcon,
  FileCodeIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  SearchIcon,
  LinkIcon,
  FolderTreeIcon,
  HardDriveIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type DirEntry = {
  name: string;
  relativePath: string;
  kind: "file" | "folder";
  sizeBytes: number;
  extension: string | null;
  modifiedAt: string;
};


type Props = {
  open: boolean;
  ticketId: string;
  alreadyLinkedIds: Set<string>;
  onClose: () => void;
  onLinked: () => void;
};

function iconForFile(ext: string | null): typeof FileTextIcon {
  if (!ext) return FileIcon;
  if ([".md", ".markdown", ".txt", ".rtf"].includes(ext)) return FileTextIcon;
  if ([".html", ".htm", ".js", ".ts", ".tsx", ".jsx", ".json", ".yaml", ".yml", ".sql", ".py", ".sh", ".css", ".scss"].includes(ext)) return FileCodeIcon;
  return FileIcon;
}
function dirname(p: string): string {
  const parts = p.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function LinkDocumentDialog({ open, ticketId, alreadyLinkedIds, onClose, onLinked }: Props) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [idsByPath, setIdsByPath] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"documents" | "url" | "path">("documents");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [treeError, setTreeError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const treeLoading = !treeLoaded && !treeError;

  // Reset the form when the dialog opens, during render rather than in an
  // effect so no synchronous setState runs from an effect body.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setSelected(new Set());
      setError("");
      setTreeError("");
      setTab("documents");
      setUrl("");
      setLabel("");
      setPath("");
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [tree, recent] = await Promise.all([
          fetch("/api/documents").then((r) => r.json()),
          fetch("/api/documents?recent=1&limit=200").then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (tree.ok) setEntries(tree.entries || []);
        if (recent.ok) {
          const map: Record<string, string> = {};
          for (const r of recent.recent || []) map[r.relative_path] = r.id;
          setIdsByPath(map);
        }
        setTreeError(tree.ok ? "" : tree.error || "The document list did not load.");
      } catch {
        if (!cancelled) setTreeError("Could not reach the server.");
      } finally {
        if (!cancelled) setTreeLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, reloadKey]);

  const childrenByParent = useMemo(() => {
    const out: Record<string, DirEntry[]> = { "": [] };
    for (const e of entries) {
      const parent = dirname(e.relativePath);
      if (!out[parent]) out[parent] = [];
      out[parent].push(e);
    }
    return out;
  }, [entries]);

  const matches = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.trim().toLowerCase();
    return entries.filter((e) => e.kind === "file" && e.relativePath.toLowerCase().includes(q));
  }, [entries, query]);

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const ids: string[] = [];
      for (const path of selected) {
        const id = idsByPath[path];
        if (id) ids.push(id);
      }
      if (ids.length === 0) {
        setError("Pick at least one file.");
        return;
      }
      for (const docId of ids) {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "linkTicketDocument", ticketId, documentId: docId }),
        });
        const j = await res.json();
        if (!j.ok) {
          setError(j.error || "Failed to link a document.");
          return;
        }
      }
      onLinked();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const submitUrl = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Enter a URL.");
      return;
    }
    // Client-side guard mirroring the server: must be a valid http(s) URL.
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setError("Only http and https URLs are allowed.");
        return;
      }
    } catch {
      setError("Enter a valid URL (including http:// or https://).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "addTicketLink", ticketId, url: trimmed, label: label.trim() }),
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error || "Failed to add the link.");
        return;
      }
      onLinked();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const submitPath = async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setError("Enter a file or folder path.");
      return;
    }
    // Client-side guard mirroring the server: must be an absolute Windows/UNC/POSIX path.
    const looksLikePath = /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\") || trimmed.startsWith("/");
    if (!looksLikePath) {
      setError("Enter a full path, e.g. M:\\Altinstar\\2026\\AI.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "addTicketLink", ticketId, kind: "path", url: trimmed, label: label.trim() }),
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error || "Failed to add the path link.");
        return;
      }
      onLinked();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Link to ticket</DialogTitle>
          <DialogDescription>Link an internal document or a custom URL to this ticket.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => { setTab(v as "documents" | "url" | "path"); setError(""); }}>
          <TabsList className="w-full">
            <TabsTrigger value="documents" className="gap-1.5">
              <FolderTreeIcon className="size-3.5" /> Documents
            </TabsTrigger>
            <TabsTrigger value="url" className="gap-1.5">
              <LinkIcon className="size-3.5" /> URL
            </TabsTrigger>
            <TabsTrigger value="path" className="gap-1.5">
              <HardDriveIcon className="size-3.5" /> File / Folder
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="mt-3 flex flex-col gap-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents…"
                className="h-8 pl-8 text-xs"
              />
            </div>

            {treeError ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>Documents could not be loaded</AlertTitle>
                <AlertDescription>{treeError}</AlertDescription>
                <AlertActions>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setTreeError(""); setTreeLoaded(false); setReloadKey((k) => k + 1); }}
                  >
                    Try again
                  </Button>
                </AlertActions>
              </Alert>
            ) : (
              <ScrollArea className="h-[320px] rounded-md border border-line">
                {treeLoading ? (
                  <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label="Loading documents">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <Skeleton key={i} className="h-7 w-full" />
                    ))}
                  </div>
                ) : matches ? (
                  matches.length === 0 ? (
                    <Empty className="min-h-0 border-0 bg-transparent py-8">
                      <EmptyHeader>
                        <EmptyTitle className="text-sm">No matches</EmptyTitle>
                        <EmptyDescription className="text-xs">
                          No document name contains “{query.trim()}”. Try a shorter search.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <ul className="divide-y divide-line">
                      {matches.map((e) => {
                        const Icon = iconForFile(e.extension);
                        const id = idsByPath[e.relativePath];
                        const isAlready = id ? alreadyLinkedIds.has(id) : false;
                        const description = dirname(e.relativePath) || "in root";
                        return (
                          <li key={e.relativePath} className="flex items-center gap-2 px-3 py-2 text-xs">
                            <Checkbox
                              id={`doc-${e.relativePath}`}
                              disabled={isAlready || !id}
                              checked={selected.has(e.relativePath)}
                              onCheckedChange={() => toggle(e.relativePath)}
                              aria-label={`Select ${e.name}`}
                            />
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2">
                              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                            </div>
                            <label htmlFor={`doc-${e.relativePath}`} className="min-w-0 flex-1 cursor-pointer">
                              <span className="block truncate text-sm font-medium">{e.name}</span>
                              <span className="block truncate text-2xs text-muted-foreground">{description}</span>
                            </label>
                            {isAlready && <span className="text-2xs text-muted-foreground">already linked</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : (
                  <PickerTree
                    parent=""
                    childrenByParent={childrenByParent}
                    expanded={expanded}
                    onToggle={(p) => setExpanded((prev) => {
                      const n = new Set(prev);
                      if (n.has(p)) n.delete(p);
                      else n.add(p);
                      return n;
                    })}
                    selected={selected}
                    onSelect={toggle}
                    idsByPath={idsByPath}
                    alreadyLinkedIds={alreadyLinkedIds}
                  />
                )}
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="url" className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="link-url" className="text-xs">URL</Label>
              <Input
                id="link-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitUrl(); } }}
                placeholder="https://example.com/page"
                className="h-8 text-xs"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="link-label" className="text-xs">
                Label <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="link-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitUrl(); } }}
                placeholder="e.g. Figma board"
                className="h-8 text-xs"
              />
              <p className="text-2xs text-muted-foreground">Falls back to the site’s domain if left blank.</p>
            </div>
          </TabsContent>

          <TabsContent value="path" className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="link-path" className="text-xs">File or folder path</Label>
              <Input
                id="link-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitPath(); } }}
                placeholder="M:\Altinstar\2026\AI"
                className="h-8 font-mono text-xs"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="link-path-label" className="text-xs">
                Label <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="link-path-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitPath(); } }}
                placeholder="e.g. AI project folder"
                className="h-8 text-xs"
              />
            </div>
            <p className="rounded-md border border-line bg-surface-2 px-2.5 py-2 text-2xs leading-relaxed text-muted-foreground">
              Clicking the link <span className="font-medium">copies the path</span> so you can paste
              it into Explorer. For true one-click open in Windows File Explorer, do the one-time
              setup per machine —{" "}
              <a
                href="/install-mc-explorer.ps1"
                download
                className="font-medium text-foreground underline underline-offset-2"
              >
                download install-mc-explorer.ps1
              </a>{" "}
              and run it (PowerShell).
            </p>
          </TabsContent>
        </Tabs>

        {error && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>That did not work</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {tab === "documents" && (
            <Button onClick={() => void submit()} disabled={busy || selected.size === 0}>
              {busy ? "Linking…" : `Link ${selected.size || ""}`}
            </Button>
          )}
          {tab === "url" && (
            <Button onClick={() => void submitUrl()} disabled={busy || !url.trim()}>
              {busy ? "Adding…" : "Add link"}
            </Button>
          )}
          {tab === "path" && (
            <Button onClick={() => void submitPath()} disabled={busy || !path.trim()}>
              {busy ? "Adding…" : "Add path"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PickerTree({
  parent, childrenByParent, expanded, onToggle, selected, onSelect, idsByPath, alreadyLinkedIds,
}: {
  parent: string;
  childrenByParent: Record<string, DirEntry[]>;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selected: Set<string>;
  onSelect: (path: string) => void;
  idsByPath: Record<string, string>;
  alreadyLinkedIds: Set<string>;
}) {
  const list = childrenByParent[parent] || [];
  if (list.length === 0 && parent === "") {
    return (
      <Empty className="min-h-0 border-0 bg-transparent py-8">
        <EmptyHeader>
          <EmptyTitle className="text-sm">No documents yet</EmptyTitle>
          <EmptyDescription className="text-xs">
            Documents added in the Documents module show up here, ready to link.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="text-xs">
      {list.map((entry) => {
        if (entry.kind === "folder") {
          const open = expanded.has(entry.relativePath);
          return (
            <li key={entry.relativePath}>
              <button
                type="button"
                onClick={() => onToggle(entry.relativePath)}
                aria-expanded={open}
                className={cn(
                  "flex w-full items-center gap-1 px-3 py-1 text-left",
                  "transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                )}
              >
                {open
                  ? <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden />
                  : <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />}
                <FolderIcon className={cn("size-3.5 shrink-0", open ? "text-warning" : "text-muted-foreground")} aria-hidden />
                <span className="truncate">{entry.name}</span>
              </button>
              {open && (
                <div className="pl-3">
                  <PickerTree
                    parent={entry.relativePath}
                    childrenByParent={childrenByParent}
                    expanded={expanded}
                    onToggle={onToggle}
                    selected={selected}
                    onSelect={onSelect}
                    idsByPath={idsByPath}
                    alreadyLinkedIds={alreadyLinkedIds}
                  />
                </div>
              )}
            </li>
          );
        }
        const Icon = iconForFile(entry.extension);
        const id = idsByPath[entry.relativePath];
        const isAlready = id ? alreadyLinkedIds.has(id) : false;
        return (
          <li
            key={entry.relativePath}
            className="flex items-center gap-2 px-3 py-1 pl-7 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-hover"
          >
            <Checkbox
              id={`tree-${entry.relativePath}`}
              disabled={isAlready || !id}
              checked={selected.has(entry.relativePath)}
              onCheckedChange={() => onSelect(entry.relativePath)}
              aria-label={`Select ${entry.name}`}
            />
            <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            <label htmlFor={`tree-${entry.relativePath}`} className="flex-1 cursor-pointer truncate">
              {entry.name}
            </label>
            {isAlready && <span className="text-2xs text-muted-foreground">linked</span>}
          </li>
        );
      })}
    </ul>
  );
}
