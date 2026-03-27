"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import {
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconRefresh,
  IconDownload,
  IconTrash,
  IconAlertTriangle,
  IconCircleCheck,
  IconLoader2,
  IconPalette,
  IconBell,
  IconBellOff,
  IconCalendarCog,
  IconCloudDownload,
  IconVolume,
  IconVolumeOff,
  IconShieldBolt,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  loadNotificationSettings,
  saveNotificationSettings,
} from "@/components/providers/notification-provider";

// ── Types ────────────────────────────────────────────────────────────────────

type ThemeOption = {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const themeOptions: ThemeOption[] = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
  { value: "system", label: "System", icon: IconDeviceDesktop },
];

type SectionKey = "appearance" | "notifications" | "agenda" | "updates" | "danger";

const NAV_ITEMS: { key: SectionKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "appearance", label: "Appearance", icon: IconPalette },
  { key: "notifications", label: "Notifications", icon: IconBell },
  { key: "agenda", label: "Agenda", icon: IconCalendarCog },
  { key: "updates", label: "Updates", icon: IconCloudDownload },
  { key: "danger", label: "Danger Zone", icon: IconShieldBolt },
];

// ── Reusable sub-components ─────────────────────────────────────────────────

function SectionHeading({ title, description }: { title: string; description?: string }): React.ReactNode {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {description && (
        <p className="text-[13px] text-muted-foreground mt-0.5">{description}</p>
      )}
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{label}</p>
        {description && (
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function SettingsPageClient(): React.ReactNode {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>("appearance");

  // Update check state
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ behind: number; latestCommit: string } | null>(null);
  const [updating, setUpdating] = useState(false);

  // Danger zone state
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false);
  const [uninstallConfirmText, setUninstallConfirmText] = useState("");
  const [uninstalling, setUninstalling] = useState(false);

  // Notification settings
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifSound, setNotifSound] = useState(true);

  // Agenda settings
  const [agendaConcurrency, setAgendaConcurrency] = useState(5);
  const [defaultExecWindow, setDefaultExecWindow] = useState(30);
  const [autoRetryAfterMinutes, setAutoRetryAfterMinutes] = useState(0);
  const [agendaSettingsLoading, setAgendaSettingsLoading] = useState(false);
  const [defaultFallbackModel, setDefaultFallbackModel] = useState("");
  const [maxRetries, setMaxRetries] = useState(1);
  const agendaMountedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    const s = loadNotificationSettings();
    setNotifEnabled(s.enabled);
    setNotifSound(s.sound);
  }, []);

  // Load agenda settings
  useEffect(() => {
    if (agendaMountedRef.current) return;
    agendaMountedRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getWorkerSettings" }),
          cache: "reload",
        });
        const json = await res.json();
        if (json.ok && json.workerSettings) {
          setAgendaConcurrency(json.workerSettings.agendaConcurrency ?? 5);
          setDefaultExecWindow(json.workerSettings.defaultExecutionWindowMinutes ?? 30);
          setAutoRetryAfterMinutes(json.workerSettings.autoRetryAfterMinutes ?? 0);
          setDefaultFallbackModel(json.workerSettings.defaultFallbackModel ?? "");
          setMaxRetries(json.workerSettings.maxRetries ?? 1);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      agendaMountedRef.current = false;
    };
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const checkUpdates = async (): Promise<void> => {
    setChecking(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkUpdates" }),
      });
      const json = await res.json();
      if (json.ok) {
        setUpdateInfo({ behind: json.behind, latestCommit: json.latestCommit || "" });
        if (json.behind === 0) toast.success("You're up to date!");
        else toast.info(`${json.behind} update${json.behind === 1 ? "" : "s"} available`);
      } else {
        toast.error(json.error || "Failed to check updates");
      }
    } catch {
      toast.error("Failed to check for updates");
    } finally {
      setChecking(false);
    }
  };

  const runUpdate = async (): Promise<void> => {
    setUpdating(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update" }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.message || "Update complete!");
        setUpdateInfo(null);
      } else {
        toast.error(json.error || "Update failed");
      }
    } catch {
      toast.error("Update failed — check logs");
    } finally {
      setUpdating(false);
    }
  };

  const runCleanReset = async (): Promise<void> => {
    setResetting(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cleanReset" }),
      });
      const json = await res.json();
      if (json.ok) toast.success(json.message || "Clean reset complete!");
      else toast.error(json.error || "Clean reset failed");
    } catch {
      toast.error("Clean reset failed");
    } finally {
      setResetting(false);
      setResetDialogOpen(false);
      setResetConfirmText("");
    }
  };

  const runUninstall = async (): Promise<void> => {
    setUninstalling(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "uninstall" }),
      });
      const json = await res.json();
      if (json.ok) toast.success(json.message || "Uninstalled successfully");
      else toast.error(json.error || "Uninstall failed");
    } catch {
      toast.error("Uninstall failed");
    } finally {
      setUninstalling(false);
      setUninstallDialogOpen(false);
      setUninstallConfirmText("");
    }
  };

  const saveAgendaSettings = async (): Promise<void> => {
    setAgendaSettingsLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateWorkerSettings",
          agendaConcurrency,
          defaultExecutionWindowMinutes: defaultExecWindow,
          maxRetries,
        }),
      });
      const json = await res.json();
      if (json.ok) toast.success("Agenda settings saved");
      else toast.error(json.error || "Failed to save");
    } catch {
      toast.error("Failed to save agenda settings");
    } finally {
      setAgendaSettingsLoading(false);
    }
  };

  // ── Section renderers ─────────────────────────────────────────────────────

  const renderAppearance = (): React.ReactNode => (
    <section>
      <SectionHeading title="Appearance" description="Choose how Mission Control looks." />

      <div className="rounded-lg border bg-card">
        <div className="p-4">
          <Label className="text-sm font-medium">Theme</Label>
          <p className="text-[12px] text-muted-foreground mb-3">Select your preferred color scheme.</p>

          {/* Segmented control */}
          <div className="inline-flex rounded-lg border bg-muted/40 p-1 gap-1">
            {themeOptions.map((option) => {
              const Icon = option.icon;
              const isActive = mounted && theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTheme(option.value)}
                  className={[
                    "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-all cursor-pointer",
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="size-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );

  const renderNotifications = (): React.ReactNode => (
    <section>
      <SectionHeading title="Notifications" description="Control live alerts for task and event updates." />

      <div className="rounded-lg border bg-card divide-y">
        {/* Enable toggle */}
        <SettingRow
          label="Enable notifications"
          description="Toast alerts for completions, failures, and approvals"
        >
          <Button
            variant={notifEnabled ? "default" : "outline"}
            size="sm"
            className="cursor-pointer min-w-[56px] h-7 text-xs"
            onClick={() => {
              const next = !notifEnabled;
              setNotifEnabled(next);
              saveNotificationSettings({ enabled: next, sound: notifSound });
              toast.success(next ? "Notifications enabled" : "Notifications disabled");
            }}
          >
            {notifEnabled ? "On" : "Off"}
          </Button>
        </SettingRow>

        {/* Sound toggle */}
        <SettingRow
          label="Sound"
          description="Play a chime when notifications appear"
        >
          <Button
            variant={notifSound ? "default" : "outline"}
            size="sm"
            className="cursor-pointer min-w-[56px] h-7 text-xs"
            disabled={!notifEnabled}
            onClick={() => {
              const next = !notifSound;
              setNotifSound(next);
              saveNotificationSettings({ enabled: notifEnabled, sound: next });
              toast.success(next ? "Sound enabled" : "Sound disabled");
            }}
          >
            {notifSound ? "On" : "Off"}
          </Button>
        </SettingRow>
      </div>

      {/* Triggers */}
      <div className="mt-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">Active triggers</p>
        <div className="flex flex-wrap gap-1.5">
          {["Picked up", "Completed", "Failed", "Needs approval", "Agent responded", "Retry", "Agent started", "System error"].map((t) => (
            <Badge key={t} variant="secondary" className="text-[11px] font-normal py-0.5 px-2">
              {t}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );

  const renderAgenda = (): React.ReactNode => (
    <section>
      <SectionHeading title="Agenda" description="Configure the scheduling worker behavior." />

      <div className="rounded-lg border bg-card divide-y">
        {/* Concurrency */}
        <div className="px-4">
          <SettingRow
            label="Concurrency"
            description="Maximum parallel jobs (1–10)"
          >
            <Input
              type="number"
              min={1}
              max={10}
              value={agendaConcurrency}
              onChange={(e) => setAgendaConcurrency(Math.max(1, Math.min(10, parseInt(e.target.value) || 5)))}
              className="h-8 w-20 text-center text-sm"
            />
          </SettingRow>
        </div>

        {/* Execution Window */}
        <div className="px-4">
          <SettingRow
            label="Execution window"
            description="Late start threshold in minutes"
          >
            <div className="relative">
              <Input
                type="number"
                min={1}
                max={1440}
                value={defaultExecWindow}
                onChange={(e) => setDefaultExecWindow(Math.max(1, Math.min(1440, parseInt(e.target.value) || 30)))}
                className="h-8 w-24 text-center text-sm pr-9"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground pointer-events-none">
                min
              </span>
            </div>
          </SettingRow>
        </div>

        {/* Max Retries */}
        <div className="px-4">
          <SettingRow
            label="Max retries"
            description="Auto-retries before marking as failed (0–5)"
          >
            <Input
              type="number"
              min={0}
              max={5}
              value={maxRetries}
              onChange={(e) => setMaxRetries(Math.max(0, Math.min(5, parseInt(e.target.value) || 1)))}
              className="h-8 w-20 text-center text-sm"
            />
          </SettingRow>
        </div>
      </div>

      {/* Retry flow info */}
      <div className="mt-4 rounded-lg border border-dashed bg-muted/20 px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">Retry flow</p>
        <div className="space-y-1 text-[12px] text-muted-foreground">
          <p><span className="text-blue-500 font-medium">1.</span> Fails → instant retry (same model, up to {maxRetries}×)</p>
          <p><span className="text-amber-500 font-medium">2.</span> All retries exhausted → fallback model (if set per event)</p>
          <p><span className="text-red-500 font-medium">3.</span> Still failing → marked <code className="text-[11px] bg-muted px-1 py-0.5 rounded">needs_retry</code></p>
        </div>
      </div>

      <div className="mt-4">
        <Button
          size="sm"
          disabled={agendaSettingsLoading}
          className="cursor-pointer gap-1.5 h-8"
          onClick={saveAgendaSettings}
        >
          {agendaSettingsLoading && <IconLoader2 className="size-3.5 animate-spin" />}
          Save changes
        </Button>
      </div>
    </section>
  );

  const renderUpdates = (): React.ReactNode => (
    <section>
      <SectionHeading title="System Updates" description="Check for and install Mission Control updates." />

      <div className="rounded-lg border bg-card">
        <div className="px-4">
          <SettingRow
            label="Check for updates"
            description="Pull latest changes from the upstream repository"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={checkUpdates}
              disabled={checking || updating}
              className="gap-1.5 cursor-pointer h-8 text-xs"
            >
              {checking ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconRefresh className="size-3.5" />}
              {checking ? "Checking…" : "Check now"}
            </Button>
          </SettingRow>
        </div>
      </div>

      {/* Update result banner */}
      {updateInfo && (
        <div className="mt-3">
          {updateInfo.behind === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
              <IconCircleCheck className="size-4 shrink-0" />
              <span className="font-medium">Up to date</span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                <IconAlertTriangle className="size-4 shrink-0" />
                <div>
                  <span className="font-medium">
                    {updateInfo.behind} update{updateInfo.behind === 1 ? "" : "s"} available
                  </span>
                  {updateInfo.latestCommit && (
                    <p className="text-[11px] opacity-80 mt-0.5">Latest: {updateInfo.latestCommit}</p>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                onClick={runUpdate}
                disabled={updating}
                className="gap-1.5 cursor-pointer shrink-0 h-8 text-xs"
              >
                {updating ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconDownload className="size-3.5" />}
                {updating ? "Updating…" : "Update"}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );

  const renderDanger = (): React.ReactNode => (
    <section>
      <SectionHeading title="Danger Zone" description="Irreversible actions — proceed with caution." />

      <div className="rounded-lg border border-destructive/30 bg-card divide-y divide-destructive/15">
        {/* Clean Reset */}
        <div className="px-4">
          <SettingRow
            label="Clean reset"
            description="Wipe the database and start fresh. All data will be permanently deleted."
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setResetDialogOpen(true);
                setResetConfirmText("");
              }}
              disabled={resetting}
              className="shrink-0 cursor-pointer border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground h-8 text-xs gap-1"
            >
              {resetting ? <IconLoader2 className="size-3 animate-spin" /> : <IconTrash className="size-3" />}
              Reset
            </Button>
          </SettingRow>
        </div>

        {/* Uninstall */}
        <div className="px-4">
          <SettingRow
            label="Uninstall"
            description="Stop services, remove Docker volumes and symlinks."
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setUninstallDialogOpen(true);
                setUninstallConfirmText("");
              }}
              disabled={uninstalling}
              className="shrink-0 cursor-pointer border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground h-8 text-xs gap-1"
            >
              {uninstalling ? <IconLoader2 className="size-3 animate-spin" /> : <IconTrash className="size-3" />}
              Uninstall
            </Button>
          </SettingRow>
        </div>
      </div>
    </section>
  );

  // ── Section map ────────────────────────────────────────────────────────────

  const sections: Record<SectionKey, () => React.ReactNode> = {
    appearance: renderAppearance,
    notifications: renderNotifications,
    agenda: renderAgenda,
    updates: renderUpdates,
    danger: renderDanger,
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col px-3 py-4 sm:px-4 lg:px-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage preferences and system configuration</p>
      </div>

      {/* Mobile nav — horizontal pills */}
      <div className="flex sm:hidden gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveSection(item.key)}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted",
              ].join(" ")}
            >
              <Icon className="size-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Two-column layout */}
      <div className="flex gap-8 flex-1 min-h-0">
        {/* Sidebar nav */}
        <nav className="hidden sm:flex flex-col w-44 shrink-0">
          <div className="flex flex-col gap-0.5 sticky top-4">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  className={[
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer text-left",
                    isActive
                      ? "bg-muted text-foreground"
                      : item.key === "danger"
                        ? "text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  ].join(" ")}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0 max-w-xl pb-8">
          {sections[activeSection]()}
        </div>
      </div>

      {/* ── Clean Reset Dialog ────────────────────────────────────────── */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <IconAlertTriangle className="size-5" />
              Clean Reset
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This will <strong>wipe the entire database</strong> — all boards, tickets, events, logs, and settings
              will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-sm text-muted-foreground">
              Type <strong className="text-destructive">RESET</strong> to confirm:
            </p>
            <Input
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="Type RESET"
              className="font-mono"
              autoFocus
            />
          </div>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={runCleanReset}
              disabled={resetConfirmText !== "RESET" || resetting}
              className="gap-1.5 cursor-pointer"
            >
              {resetting ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconTrash className="size-3.5" />}
              {resetting ? "Resetting…" : "Confirm Reset"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Uninstall Dialog ──────────────────────────────────────────── */}
      <AlertDialog open={uninstallDialogOpen} onOpenChange={setUninstallDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <IconAlertTriangle className="size-5" />
              Uninstall Mission Control
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This will <strong>stop all services</strong>, remove Docker volumes, and clean up symlinks. Re-run{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">install.sh</code> to reinstall.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-sm text-muted-foreground">
              Type <strong className="text-destructive">UNINSTALL</strong> to confirm:
            </p>
            <Input
              value={uninstallConfirmText}
              onChange={(e) => setUninstallConfirmText(e.target.value)}
              placeholder="Type UNINSTALL"
              className="font-mono"
              autoFocus
            />
          </div>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel disabled={uninstalling}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={runUninstall}
              disabled={uninstallConfirmText !== "UNINSTALL" || uninstalling}
              className="gap-1.5 cursor-pointer"
            >
              {uninstalling ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconTrash className="size-3.5" />}
              {uninstalling ? "Uninstalling…" : "Confirm Uninstall"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
