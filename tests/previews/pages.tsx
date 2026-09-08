import { createRoot } from "react-dom/client";
import { useSyncExternalStore } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageHeader } from "@/components/layout/page-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "sonner";

import { SettingsPageClient } from "@/components/settings/settings-page-client";
import { AgendaClientWrapper } from "@/components/agenda/agenda-client-wrapper";
import { ProcessesPageClient } from "@/components/processes/processes-page-client";
import { MetricsClient } from "@/components/metrics/metrics-client";
import { DocumentsClient } from "@/components/documents/documents-client";
import { LogsPageClient } from "@/components/agents/logs-page-client";
import { AgentsClientGrid } from "@/app/agents/agents-client";
import { FileManagerClient } from "@/app/file-manager/file-manager-client";
import "@/app/globals.css";

/**
 * Renders each page's client against empty-but-valid API responses, so the
 * empty, loading and error states can be reviewed side by side. `?fail=1`
 * makes every request fail, which is how the error states are checked.
 */
const shouldFail = new URLSearchParams(window.location.search).get("fail") === "1";

window.fetch = (async () => {
  if (shouldFail) return new Response("upstream unavailable", { status: 503, statusText: "Service Unavailable" });
  return Response.json({
    ok: true,
    rows: [], logs: [], agents: [], events: [], processes: [], metrics: [], documents: [], services: [],
    modules: [], users: [], entries: [], items: [], boards: [], columns: [], tickets: [],
    boardAssignees: [], boardLabels: [], notifications: [], apps: [],
    settings: {}, workerSettings: { instanceName: "Mission Control" }, config: {},
    pageInfo: { page: 1, limit: 25, totalCount: 0, pageCount: 1 },
    total: 0, count: 0,
  });
}) as typeof fetch;

class QuietEventSource {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
window.EventSource = QuietEventSource as unknown as typeof EventSource;

const PAGES = {
  settings: { label: "Settings", node: <SettingsPageClient /> },
  agenda: { label: "Agenda", node: <AgendaClientWrapper /> },
  processes: { label: "Processes", node: <ProcessesPageClient /> },
  metrics: { label: "Metrics", node: <MetricsClient /> },
  documents: { label: "Documents", node: <DocumentsClient /> },
  logs: {
    label: "Logs",
    node: <LogsPageClient initialLogs={[]} initialAgents={[]} initialPageInfo={{ page: 1, limit: 25, totalCount: 0, pageCount: 1 }} initialNowIso={new Date().toISOString()} />,
  },
  agents: { label: "Agents", node: <AgentsClientGrid showAgentDebug={false} /> },
  files: { label: "File manager", node: <FileManagerClient /> },
} as const;

type PageKey = keyof typeof PAGES;

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); window.addEventListener("popstate", l); return () => { listeners.delete(l); window.removeEventListener("popstate", l); }; };
const currentKey = (): PageKey => {
  const key = new URLSearchParams(window.location.search).get("page") ?? "settings";
  return (key in PAGES ? key : "settings") as PageKey;
};

function Preview() {
  const page = useSyncExternalStore(subscribe, currentKey, currentKey);
  const select = (key: PageKey) => {
    const next = new URLSearchParams(window.location.search);
    next.set("page", key);
    window.history.pushState({}, "", `?${next}`);
    listeners.forEach((l) => l());
  };

  // Some clients render their own PageHeader, so they need the provider but not
  // a second header; settings renders neither.
  const ownsHeader = page === "metrics" || page === "logs";
  const bare = page === "settings";

  return (
    <div className="flex min-h-svh flex-col">
      <nav aria-label="Fixture pages" className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs">
        <span className="font-medium">Page fixtures</span>
        <span className="text-muted-foreground">{shouldFail ? "requests failing" : "empty responses"}</span>
        {Object.entries(PAGES).map(([key, value]) => (
          <button
            key={key}
            onClick={() => select(key as PageKey)}
            className={`rounded border px-2 py-0.5 ${page === key ? "border-primary text-primary" : "border-line text-muted-foreground"}`}
          >
            {value.label}
          </button>
        ))}
        <button className="rounded border border-line px-2 py-0.5" onClick={() => document.documentElement.classList.toggle("dark")}>
          Toggle theme
        </button>
      </nav>

      <div className="min-h-0 flex-1">
        {bare ? (
          PAGES[page].node
        ) : (
          <SidebarProvider>
            <AppSidebar variant="inset" initialUser={null} />
            <SidebarInset>
              {ownsHeader ? null : <PageHeader page={PAGES[page].label} />}
              <div className="min-h-0 flex-1 overflow-auto">{PAGES[page].node}</div>
            </SidebarInset>
          </SidebarProvider>
        )}
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
