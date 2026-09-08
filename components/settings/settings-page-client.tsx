"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  IconBox,
  IconUsersGroup,
  IconCalendarCog,
  IconCloudDownload,
  IconShieldBolt,
  IconSettings,
  IconCode,
  IconFlask,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ModulesSection } from "@/components/settings/modules-section";
import { SectionHeading, SettingRow } from "@/components/settings/setting-row";
import { ReviewNotificationsSection } from "@/components/settings/review-notifications-section";
import { AllowedUsersSection } from "@/components/settings/allowed-users-section";
import { useAuth } from "@/hooks/use-auth";
import {
  loadNotificationSettings,
  saveNotificationSettings,
} from "@/components/providers/notification-provider";
import {
  THEME_ACCENTS,
  THEME_ACCENT_STORAGE_KEY,
  applyThemeAccent,
  getStoredThemeAccentId,
} from "@/lib/theme-accent";

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

const DEV_MODE_KEY = "mc-dev-mode";

function getDevMode() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEV_MODE_KEY) === "1";
}
function setDevMode(enabled: boolean) {
  if (enabled) localStorage.setItem(DEV_MODE_KEY, "1");
  else localStorage.removeItem(DEV_MODE_KEY);
  window.dispatchEvent(new Event("mc-dev-mode-changed"));
}

type SectionKey = "appearance" | "general" | "users" | "modules" | "notifications" | "agenda" | "updates" | "developer" | "danger";

const BASE_NAV_ITEMS: { key: SectionKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "appearance", label: "Appearance", icon: IconPalette },
  { key: "general", label: "General", icon: IconSettings },
  { key: "users", label: "Allowed users", icon: IconUsersGroup },
  { key: "modules", label: "Modules", icon: IconBox },
  { key: "notifications", label: "Notifications", icon: IconBell },
  { key: "agenda", label: "Agenda", icon: IconCalendarCog },
  { key: "updates", label: "Updates", icon: IconCloudDownload },
  { key: "developer", label: "Developer", icon: IconCode },
  { key: "danger", label: "Danger Zone", icon: IconShieldBolt },
];

// ── Main component ──────────────────────────────────────────────────────────

export function SettingsPageClient(): React.ReactNode {
  const { user: authUser, role: authRole } = useAuth();
  const currentEmail = authUser?.email ?? null;
  const isAdmin = authRole === "admin";
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // A link such as /settings#modules opens that section directly.
  const [activeSection, setActiveSection] = useState<SectionKey>(() => {
    if (typeof window === "undefined") return "appearance";
    const fromHash = window.location.hash.replace("#", "");
    return BASE_NAV_ITEMS.some((item) => item.key === fromHash) ? (fromHash as SectionKey) : "appearance";
  });
  const [agendaTimeStepMinutes, setAgendaTimeStepMinutes] = useState(15);
  const [accentPickerOpen, setAccentPickerOpen] = useState(false);
  const [accentId, setAccentId] = useState("purple");

  // Update check state
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ behind: number; latestCommit: string } | null>(null);
  const [updating, setUpdating] = useState(false);

  // Danger zone state
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);

  // Notification settings
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifSound, setNotifSound] = useState(true);

  // Developer mode — synced from localStorage
  const devModeEnabled = useSyncExternalStore(
    (cb) => {
      window.addEventListener("mc-dev-mode-changed", cb);
      return () => window.removeEventListener("mc-dev-mode-changed", cb);
    },
    () => getDevMode(),
    () => false,
  );

  // Agenda settings
  // agendaConcurrency and defaultExecWindow removed in v2 — cron handles these natively
  const [agendaSettingsLoading, setAgendaSettingsLoading] = useState(false);
  const [maxRetries, setMaxRetries] = useState(1);
  const [sidebarActivityCount, setSidebarActivityCount] = useState(8);
  const [instanceName, setInstanceName] = useState("");
  const agendaMountedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    const s = loadNotificationSettings();
    setNotifEnabled(s.enabled);
    setNotifSound(s.sound);


    const rawStep = Number(localStorage.getItem("mc-agenda-time-step-minutes") ?? "15");
    const safeStep = Number.isFinite(rawStep) ? Math.max(0, Math.min(60, rawStep)) : 15;
    setAgendaTimeStepMinutes(safeStep);

    const savedAccent = getStoredThemeAccentId();
    setAccentId(savedAccent);
    applyThemeAccent(savedAccent, false);

    return undefined;
  }, [activeSection]);

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
          setMaxRetries(json.workerSettings.maxRetries ?? 1);
          setSidebarActivityCount(json.workerSettings.sidebarActivityCount ?? 8);
          setInstanceName(json.workerSettings.instanceName ?? "Mission Control");
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
        toast.success("Update complete. Reopening the refreshed app in a moment…");
        setUpdateInfo({ behind: 0, latestCommit: "" });
        setTimeout(() => {
          const nextUrl = `/settings?updated=${Date.now()}`;
          window.location.replace(nextUrl);
        }, 4000);
      } else {
        toast.error(json.error || "Update failed");
      }
    } catch {
      toast.error("Update failed before completion — check logs if services did not come back");
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


  const saveAgendaSettings = async (): Promise<void> => {
    setAgendaSettingsLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateWorkerSettings",
          maxRetries,
          sidebarActivityCount,
          instanceName,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        const nextName = String(json.workerSettings?.instanceName || instanceName || "Mission Control").trim() || "Mission Control";
        setInstanceName(nextName);
        window.dispatchEvent(new CustomEvent("mc-instance-name-changed", { detail: { name: nextName } }));
        document.title = nextName;
        toast.success("Agenda settings saved");
      }
      else toast.error(json.error || "Failed to save");
    } catch {
      toast.error("Failed to save agenda settings");
    } finally {
      setAgendaSettingsLoading(false);
    }
  };

  // ── Section renderers ─────────────────────────────────────────────────────

  const renderGeneral = (): React.ReactNode => (
    <section>
      <SectionHeading title="General" description="Core workspace settings." />

      <div className="rounded-xl border bg-card divide-y">
        <SettingRow
          label="Instance name"
          description="Shown in the sidebar brand and browser tab. Helps identify multiple instances."
        >
          <Input
            type="text"
            maxLength={80}
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            placeholder="Mission Control"
            className="h-9 w-56 text-sm"
          />
        </SettingRow>
      </div>

      <div className="mt-5">
        <Button
          className="cursor-pointer gap-2 h-10 px-6"
          onClick={async () => {
            const nextName = instanceName.trim() || "Mission Control";
            try {
              const res = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "updateWorkerSettings",
                  instanceName: nextName,
                }),
              });
              const json = await res.json();
              if (json.ok) {
                const saved = String(json.workerSettings?.instanceName || nextName).trim() || "Mission Control";
                setInstanceName(saved);
                window.dispatchEvent(new CustomEvent("mc-instance-name-changed", { detail: { name: saved } }));
                document.title = saved;
                toast.success("General settings saved");
              } else {
                toast.error(json.error || "Failed to save");
              }
            } catch {
              toast.error("Failed to save general settings");
            }
          }}
        >
          Save general settings
        </Button>
      </div>
    </section>
  );

  const renderAppearance = (): React.ReactNode => (
    <section>
      <SectionHeading title="Appearance" description="Choose how Mission Control looks." />

      <div className="rounded-xl border bg-card p-6">
        <p className="text-sm font-medium mb-1">Theme</p>
        <p className="text-sm text-muted-foreground mb-5">Select your preferred color scheme.</p>

        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const isActive = mounted && theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setTheme(option.value);
                  if (option.value === "light") setAccentPickerOpen(true);
                }}
                className={[
                  "flex flex-col items-center gap-2.5 rounded-xl border-2 px-4 py-5 transition-all cursor-pointer",
                  isActive
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary/40 hover:bg-muted/30",
                ].join(" ")}
              >
                <div className={[
                  "flex items-center justify-center size-11 rounded-xl transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                ].join(" ")}>
                  <Icon className="size-5" />
                </div>
                <span className={[
                  "text-sm font-medium",
                  isActive ? "text-primary" : "text-muted-foreground",
                ].join(" ")}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-2xl border bg-gradient-to-br from-card via-card to-muted/30 px-4 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Main color</p>
              <p className="text-xs text-muted-foreground mt-1">
                Pick from the core accents or pastel collection. {THEME_ACCENTS.length} colors available.
              </p>
            </div>
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl border bg-background/80 px-3 py-2 hover:bg-muted/50 cursor-pointer shadow-sm"
              onClick={() => setAccentPickerOpen(true)}
            >
              <span className="size-6 rounded-lg ring-1 ring-black/5" style={{ backgroundColor: THEME_ACCENTS.find((a) => a.id === accentId)?.swatch ?? "#8b5cf6" }} />
              <span className="text-xs font-medium">Change</span>
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {THEME_ACCENTS.filter((accent) => !accent.id.startsWith("extra-")).map((accent) => {
              const active = accent.id === accentId;
              return (
                <button
                  key={accent.id}
                  type="button"
                  title={accent.label}
                  onClick={() => {
                    setAccentId(accent.id);
                    localStorage.setItem(THEME_ACCENT_STORAGE_KEY, accent.id);
                    applyThemeAccent(accent.id, true);
                    window.dispatchEvent(new CustomEvent("mc-theme-accent-changed", { detail: { id: accent.id } }));
                  }}
                  className={[
                    "size-7 rounded-full ring-2 transition-all cursor-pointer hover:scale-105",
                    active ? "ring-foreground scale-105" : "ring-transparent",
                  ].join(" ")}
                  style={{ backgroundColor: accent.swatch }}
                />
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

      <div className="rounded-xl border bg-card divide-y">
        <SettingRow
          label="Enable notifications"
          description="Toast alerts for completions, failures, and approvals"
        >
          <Switch
            id="setting-notifications-enabled"
            aria-label="Enable notifications"
            checked={notifEnabled}
            onCheckedChange={(next) => {
              setNotifEnabled(next);
              saveNotificationSettings({ enabled: next, sound: notifSound });
              toast.success(next ? "Notifications enabled" : "Notifications disabled");
            }}
          />
        </SettingRow>

        <SettingRow
          label="Sound"
          description="Play a chime when notifications appear"
        >
          <Switch
            id="setting-notification-sound"
            aria-label="Play a chime when notifications appear"
            checked={notifSound && notifEnabled}
            disabled={!notifEnabled}
            onCheckedChange={(next) => {
              setNotifSound(next);
              saveNotificationSettings({ enabled: notifEnabled, sound: next });
              toast.success(next ? "Sound enabled" : "Sound disabled");
            }}
          />
        </SettingRow>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium mb-3">Active triggers</p>
        <div className="flex flex-wrap gap-2">
          {["Picked up", "Completed", "Failed", "Needs approval", "Agent responded", "Retry", "Agent started", "System error"].map((t) => (
            <Badge key={t} variant="secondary" className="text-xs font-normal py-1 px-3 rounded-full">
              {t}
            </Badge>
          ))}
        </div>
      </div>
      <ReviewNotificationsSection />
    </section>
  );

  const renderAgenda = (): React.ReactNode => (
    <section>
      <SectionHeading title="Agenda" description="Configure event scheduling and retry behavior. Execution is handled natively by the OpenClaw cron engine." />

      <div className="rounded-xl border bg-card divide-y">
        <SettingRow
          label="Max retry attempts"
          description="Stores the retry-attempt limit in worker settings for Mission Control retry policy and diagnostics. (1–5)"
        >
          <Input
            type="number"
            min={1}
            max={5}
            value={maxRetries}
            onChange={(e) => setMaxRetries(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
            className="h-9 w-20 text-center text-sm"
          />
        </SettingRow>

        <SettingRow
          label="Sidebar Activity Count"
          description="Number of recent activity entries shown in the sidebar (1–30)"
        >
          <Input
            type="number"
            min={1}
            max={30}
            value={sidebarActivityCount}
            onChange={(e) => setSidebarActivityCount(Math.max(1, Math.min(30, parseInt(e.target.value) || 8)))}
            className="h-9 w-20 text-center text-sm"
          />
        </SettingRow>
      </div>

      {/* Retry flow info */}
      <div className="mt-5 rounded-xl border border-dashed border-muted-foreground/25 bg-muted/10 p-5">
        <p className="text-sm font-medium mb-3">Retry flow</p>
        <div className="space-y-2.5">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center size-6 rounded-full bg-info-soft text-blue-500 text-xs font-bold shrink-0 mt-0.5">1</div>
            <p className="text-sm text-muted-foreground">Mission Control stores a retry-attempt limit of <span className="font-medium text-foreground">{maxRetries} attempt{maxRetries === 1 ? "" : "s"}</span> for agenda retry policy and diagnostics.</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center size-6 rounded-full bg-danger-soft text-red-500 text-xs font-bold shrink-0 mt-0.5">2</div>
            <p className="text-sm text-muted-foreground">All retries exhausted → marked <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">needs_retry</code> + Telegram alert.</p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border bg-card divide-y">
        <SettingRow
          label="Time input interval"
          description="Minute snapping for the event time picker. 0 = free input, 5/10/15/etc = snaps to that interval."
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={60}
              value={agendaTimeStepMinutes}
              onChange={(e) => {
                const v = Math.max(0, Math.min(60, Number(e.target.value) || 0));
                setAgendaTimeStepMinutes(v);
                localStorage.setItem("mc-agenda-time-step-minutes", String(v));
                window.dispatchEvent(new CustomEvent("mc-agenda-time-step-changed", { detail: { value: v } }));
              }}
              className="h-9 w-20 text-center text-sm"
            />
            <span className="text-sm text-muted-foreground">min</span>
          </div>
        </SettingRow>
      </div>

      <div className="mt-5">
        <Button
          disabled={agendaSettingsLoading}
          className="cursor-pointer gap-2 h-10 px-6"
          onClick={saveAgendaSettings}
        >
          {agendaSettingsLoading && <IconLoader2 className="size-4 animate-spin" />}
          Save changes
        </Button>
      </div>
    </section>
  );

  const renderUpdates = (): React.ReactNode => (
    <section>
      <SectionHeading title="System Updates" description="Check for and install Mission Control updates." />

      <div className="rounded-xl border bg-card">
        <SettingRow
          label="Check for updates"
          description="Pull latest changes from the upstream repository"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={checkUpdates}
            disabled={checking || updating}
            className="gap-2 cursor-pointer h-9 px-4"
          >
            {checking ? <IconLoader2 className="size-4 animate-spin" /> : <IconRefresh className="size-4" />}
            {checking ? "Checking…" : "Check now"}
          </Button>
        </SettingRow>
      </div>

      {/* Update result banner */}
      {updateInfo && (
        <div className="mt-4">
          {updateInfo.behind === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft px-5 py-4 text-sm text-success-fg">
              <IconCircleCheck className="size-5 shrink-0" />
              <span className="font-medium">You&apos;re up to date</span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-warning/30 bg-warning-soft px-5 py-4">
              <div className="flex items-center gap-3 text-sm text-warning-fg">
                <IconAlertTriangle className="size-5 shrink-0" />
                <div>
                  <span className="font-medium">
                    {updateInfo.behind} update{updateInfo.behind === 1 ? "" : "s"} available
                  </span>
                  {updateInfo.latestCommit && (
                    <p className="text-xs opacity-80 mt-0.5">Latest: {updateInfo.latestCommit}</p>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                onClick={runUpdate}
                disabled={updating}
                className="gap-2 cursor-pointer shrink-0 h-9 px-4"
              >
                {updating ? <IconLoader2 className="size-4 animate-spin" /> : <IconDownload className="size-4" />}
                {updating ? "Updating…" : "Update now"}
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

      <div className="rounded-xl border-2 border-destructive/30 bg-card divide-y divide-destructive/15">
        <SettingRow
          label="Clean reset"
          description="Wipe the entire database — all boards, tickets, events, logs, and settings will be permanently deleted."
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setResetDialogOpen(true);
              setResetConfirmText("");
            }}
            disabled={resetting}
            className="shrink-0 cursor-pointer border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground h-9 px-4 gap-2"
          >
            {resetting ? <IconLoader2 className="size-4 animate-spin" /> : <IconTrash className="size-4" />}
            Reset
          </Button>
        </SettingRow>

      </div>
    </section>
  );

  // ── Section map ────────────────────────────────────────────────────────────

  
  // ── Developer section ─────────────────────────────────────────────────────

  const renderDeveloper = (): React.ReactNode => (
    <section>
      <SectionHeading
        title="Developer"
        description="Tools for testing and debugging Mission Control."
      />
      <div className="rounded-xl border bg-card divide-y divide-border/60">
        <SettingRow
          label="Developer mode"
          description="Enables test panels on the Agenda and Boards pages. Stored in localStorage — toggle off to return to normal view."
        >
          <Switch
            id="setting-developer-mode"
            aria-label="Developer mode"
            checked={devModeEnabled}
            onCheckedChange={(next) => {
              setDevMode(next);
              toast(next ? "Developer mode enabled" : "Developer mode disabled", {
                description: next
                  ? "Test panels are now visible on Agenda and Boards."
                  : "Test panels are now hidden.",
              });
            }}
          />
        </SettingRow>
        {devModeEnabled && (
          <div className="px-5 py-4 flex items-start gap-3 bg-primary/5 rounded-b-xl">
            <IconFlask className="size-4 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Developer mode is active.</span>{" "}
              Test panels are visible on the <strong>Agenda</strong> and <strong>Boards</strong> pages.
            </p>
          </div>
        )}
      </div>
    </section>
  );

  const sections: Record<SectionKey, () => React.ReactNode> = {
    appearance: renderAppearance,
    general: renderGeneral,
    users: () => <AllowedUsersSection currentEmail={currentEmail} />,
    modules: () => <ModulesSection />,
    notifications: renderNotifications,
    agenda: renderAgenda,
    updates: renderUpdates,
    developer: renderDeveloper,
    danger: renderDanger,
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const NAV_ITEMS = BASE_NAV_ITEMS.filter((item) => item.key !== "danger" || isAdmin);

  // A section chosen here is reflected in the URL hash, so the choice survives a
  // refresh and links such as /settings#modules land in the right place.
  const selectSection = (key: SectionKey) => {
    setActiveSection(key);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${key}`);
    }
  };

  return (
    <div className="page-x flex flex-1 flex-col py-(--page-y)">
      <p className="sr-only" id="settings-intro">Manage preferences and system configuration.</p>

      <Tabs
        value={activeSection}
        onValueChange={(value) => selectSection(value as SectionKey)}
        orientation="vertical"
        className="flex min-h-0 flex-1 flex-col gap-6 sm:flex-row sm:gap-10"
      >
        {/* Horizontal on phones, a rail beside the content from sm up */}
        <TabsList className="mc-scrollbar h-auto w-full justify-start gap-1 overflow-x-auto rounded-full bg-surface-2 p-1 sm:sticky sm:top-6 sm:w-52 sm:shrink-0 sm:flex-col sm:items-stretch sm:self-start sm:rounded-xl sm:bg-transparent sm:p-0">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <TabsTrigger
                key={item.key}
                value={item.key}
                className={cn(
                  "shrink-0 justify-start gap-2 rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap sm:rounded-lg sm:py-2.5",
                  "data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none",
                  item.key === "danger" && "data-[state=inactive]:hover:text-destructive",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <div className="min-w-0 flex-1 pb-12 sm:max-w-2xl">
          {NAV_ITEMS.map((item) => (
            <TabsContent key={item.key} value={item.key} className="m-0">
              {item.key === "danger" && !isAdmin ? null : sections[item.key]()}
            </TabsContent>
          ))}
        </div>
      </Tabs>

      <Dialog open={accentPickerOpen} onOpenChange={setAccentPickerOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Choose your main color</DialogTitle>
            <DialogDescription>
              Core accents plus a large pastel palette. Click any color to preview and save instantly.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl border bg-gradient-to-br from-card via-card to-muted/30 p-4">
            <div className="flex items-center gap-4">
              <div className="size-14 rounded-2xl shadow-sm ring-1 ring-black/5" style={{ backgroundColor: THEME_ACCENTS.find((a) => a.id === accentId)?.swatch ?? "#8b5cf6" }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{THEME_ACCENTS.find((a) => a.id === accentId)?.label ?? "Purple (Default)"}</p>
                <p className="text-xs text-muted-foreground mt-1">Selected theme accent · {THEME_ACCENTS.length} total colors</p>
              </div>
            </div>
          </div>
          <div className="max-h-[62vh] overflow-y-auto pr-1 space-y-6">
            {([
              { label: "Core",  filter: (a: { id: string }) => !a.id.startsWith("extra-") },
              { label: "Extended Palette", filter: (a: { id: string }) => a.id.startsWith("extra-") },
            ] as const).map(({ label, filter }) => {
              const group = THEME_ACCENTS.filter(filter);
              return (
                <div key={label}>
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                    <span className="text-2xs text-muted-foreground/60">({group.length})</span>
                  </div>
                  <div className="grid grid-cols-6 sm:grid-cols-10 gap-2">
                    {group.map((accent) => {
                      const active = accentId === accent.id;
                      return (
                        <button
                          key={accent.id}
                          type="button"
                          title={accent.label}
                          onClick={() => {
                            setAccentId(accent.id);
                            localStorage.setItem(THEME_ACCENT_STORAGE_KEY, accent.id);
                            applyThemeAccent(accent.id, true);
                            window.dispatchEvent(new CustomEvent("mc-theme-accent-changed", { detail: { id: accent.id } }));
                            toast.success(`Color set to ${accent.label}`);
                          }}
                          className={[
                            "group flex flex-col items-center gap-1.5 rounded-xl border p-1.5 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md cursor-pointer",
                            active ? "border-foreground bg-foreground/5 shadow-sm" : "border-transparent hover:border-border",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "size-8 rounded-lg ring-1 ring-black/10 transition-transform",
                              active ? "scale-110" : "",
                            ].join(" ")}
                            style={{ backgroundColor: accent.swatch }}
                          />
                          <span className="text-2xs text-center leading-tight text-muted-foreground group-hover:text-foreground truncate w-full px-0.5">
                            {accent.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Clean Reset Dialog ────────────────────────────────────────── */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2.5 text-destructive">
              <IconAlertTriangle className="size-5" />
              Clean Reset
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              This will <strong>wipe the entire database</strong> — all boards, tickets, events, logs, and settings
              will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3 mt-3">
            <p className="text-sm text-muted-foreground">
              Type <strong className="text-destructive">RESET</strong> to confirm:
            </p>
            <Input
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder="Type RESET"
              className="font-mono h-10"
              autoFocus
            />
          </div>
          <AlertDialogFooter className="mt-5">
            <AlertDialogCancel disabled={resetting} className="h-10">Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={runCleanReset}
              disabled={resetConfirmText !== "RESET" || resetting}
              className="gap-2 cursor-pointer h-10"
            >
              {resetting ? <IconLoader2 className="size-4 animate-spin" /> : <IconTrash className="size-4" />}
              {resetting ? "Resetting…" : "Confirm Reset"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


    </div>
  );
}
