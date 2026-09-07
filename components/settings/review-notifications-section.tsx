"use client";

import { useCallback, useEffect, useState } from "react";
import { IconAlertTriangle, IconCircleCheck, IconLoader2, IconPlayerPause } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionHeading, SettingRow } from "@/components/settings/setting-row";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_REVIEW_ALERT_CONFIG, formatReviewAlert, type ReviewAlertConfig } from "@/lib/mobile-apps/review-alert-config";

type Status = {
  moduleEnabled: boolean;
  settings: { config: ReviewAlertConfig; generation: string; heartbeat_at: string | null; last_checked_at: string | null; next_poll_at: string; last_error: string | null };
  channels: Record<"email" | "telegram", { ready: boolean; message: string }>;
  deliveries: Array<{ id: string; channel: string; recipient: string; status: string; error: string | null; created_at: string }>;
};

const splitRecipients = (value: string) => value.split(/[,;\n]/).map(value => value.trim()).filter(Boolean);
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Not checked yet";

const BANNERS = {
  running: { icon: IconCircleCheck, className: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400" },
  paused: { icon: IconPlayerPause, className: "border-border bg-muted/30 text-muted-foreground" },
  offline: { icon: IconAlertTriangle, className: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400" },
};

function monitorState(status: Status): { tone: keyof typeof BANNERS; title: string } {
  if (!status.moduleEnabled) return { tone: "paused", title: "Paused: enable Mobile Applications in Modules." };
  if (!status.settings.config.monitoring) return { tone: "paused", title: "Background monitoring is paused." };
  const beat = status.settings.heartbeat_at ? Date.now() - new Date(status.settings.heartbeat_at).getTime() : Infinity;
  if (beat < 90_000) return { tone: "running", title: "Review monitor is running" };
  return { tone: "offline", title: "Review monitor is offline. Start the mobile:reviews:watch service on the server." };
}

function MonitorBanner({ status }: { status: Status }) {
  const state = monitorState(status);
  const banner = BANNERS[state.tone];
  return <div aria-live="polite" className={`flex items-start gap-3 rounded-xl border px-5 py-4 text-sm ${banner.className}`}>
    <banner.icon className="mt-0.5 size-5 shrink-0" />
    <div className="min-w-0">
      <p className="font-medium">{state.title}</p>
      <p className="mt-0.5 text-xs opacity-80">Last check: {date(status.settings.last_checked_at)} · Next check: {date(status.settings.next_poll_at)}</p>
      {status.settings.last_error && <p className="mt-1 text-xs text-destructive">{status.settings.last_error}</p>}
    </div>
  </div>;
}

export function ReviewNotificationsSection() {
  const { role } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [config, setConfig] = useState<ReviewAlertConfig>(DEFAULT_REVIEW_ALERT_CONFIG);
  const [emails, setEmails] = useState("");
  const [chats, setChats] = useState("");
  const [generation, setGeneration] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (reset: boolean, signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/mobile-apps/notifications", { cache: "no-store", signal });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "Could not load review alert settings.");
      setStatus(json);
      if (reset) {
        setConfig(json.settings.config); setGeneration(json.settings.generation);
        setEmails(json.settings.config.emailRecipients.join(", ")); setChats(json.settings.config.telegramChats.join(", "));
        setError(null);
      }
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "Could not load review alert settings."); }
  }, []);
  useEffect(() => {
    if (role !== "admin") return;
    const controller = new AbortController();
    void load(true, controller.signal);
    const poll = setInterval(() => { if (document.visibilityState === "visible") void load(false, controller.signal); }, 30_000);
    return () => { controller.abort(); clearInterval(poll); };
  }, [role, load]);

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch("/api/mobile-apps/notifications", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation, config: { ...config, emailRecipients: splitRecipients(emails), telegramChats: splitRecipients(chats) } }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "Could not save settings.");
      await load(true);
      toast.success("Review alert settings saved. Recipients receive matching reviews submitted from now on.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  const preview = formatReviewAlert({ appId: "example", appName: "Your app", store: "google", rating: 2, author: "A reviewer", title: null, body: "The latest update closes when I open the app.", submittedAt: null });
  const alertsOn = config.monitoring && (config.emailEnabled || config.telegramEnabled);

  return <section className="mt-10" aria-labelledby="review-alerts-heading">
    <SectionHeading id="review-alerts-heading" title="Mobile app review alerts" description="Check for published reviews in the background and send each new review to your chosen recipients. Store publication delays still apply." />

    {role !== "admin" ? <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">An administrator can configure email and Telegram recipients.</div> : <>
      {error && <div className="mb-4 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive"><IconAlertTriangle className="size-5 shrink-0" /><p role="alert">{error}</p></div>}

      {!status ? (error
        ? <Button variant="outline" className="h-9 px-4 cursor-pointer" onClick={() => void load(true)}>Retry</Button>
        : <div className="flex items-center justify-center rounded-xl border bg-card p-8 text-xs text-muted-foreground"><IconLoader2 className="mr-2 size-4 animate-spin" /> Loading…</div>
      ) : <>
        <MonitorBanner status={status} />

        <form onSubmit={save} className="mt-4">
          <fieldset disabled={busy} className="space-y-4">
            <div className="rounded-xl border bg-card divide-y">
              <SettingRow htmlFor="review-monitor" label="Background monitoring" description="Poll both stores for newly published reviews while Mission Control services are running.">
                <Switch id="review-monitor" checked={config.monitoring} onCheckedChange={monitoring => setConfig({ ...config, monitoring })} />
              </SettingRow>
              <SettingRow htmlFor="review-poll" label="Check interval" description="Minimum 60 seconds. Large review feeds and store errors extend the interval to respect API limits.">
                <div className="flex items-center gap-2">
                  <Input id="review-poll" type="number" min={60} max={3600} value={config.pollSeconds} onChange={event => setConfig({ ...config, pollSeconds: Number(event.target.value) })} required className="h-9 w-20 text-center text-sm" />
                  <span className="text-sm text-muted-foreground">sec</span>
                </div>
              </SettingRow>
              <SettingRow htmlFor="review-rating" label="Notify for ratings at or below" description="Set to 5 to be alerted about every review.">
                <div className="flex items-center gap-2">
                  <Input id="review-rating" type="number" min={1} max={5} value={config.maxRating} onChange={event => setConfig({ ...config, maxRating: Number(event.target.value) })} required className="h-9 w-20 text-center text-sm" />
                  <span className="text-sm text-muted-foreground">stars</span>
                </div>
              </SettingRow>
            </div>

            <div className="rounded-xl border bg-card divide-y">
              <SettingRow htmlFor="review-email" label="Outlook email" description={status.channels.email.message}>
                <Switch id="review-email" checked={config.emailEnabled} onCheckedChange={emailEnabled => setConfig({ ...config, emailEnabled })} />
              </SettingRow>
              <div className="px-5 py-4">
                <Label htmlFor="review-email-recipients" className="mb-1.5 block text-xs">Email recipients</Label>
                <Input id="review-email-recipients" value={emails} onChange={event => setEmails(event.target.value)} placeholder="person@example.com, team@example.com" autoComplete="off" />
                <p className="mt-2 text-xs text-muted-foreground">Uses the authenticated Outlook skill on the server. Recipients receive separate messages.</p>
              </div>
            </div>

            <div className="rounded-xl border bg-card divide-y">
              <SettingRow htmlFor="review-telegram" label="Telegram" description={status.channels.telegram.message}>
                <Switch id="review-telegram" checked={config.telegramEnabled} onCheckedChange={telegramEnabled => setConfig({ ...config, telegramEnabled })} />
              </SettingRow>
              <div className="px-5 py-4">
                <Label htmlFor="review-telegram-chats" className="mb-1.5 block text-xs">Chat IDs or channel usernames</Label>
                <Input id="review-telegram-chats" value={chats} onChange={event => setChats(event.target.value)} placeholder="-1001234567890, @your_channel" autoComplete="off" />
              </div>
            </div>
          </fieldset>

          <details className="mt-5 rounded-xl border border-dashed border-muted-foreground/25 bg-muted/10 p-5 text-sm">
            <summary className="cursor-pointer font-medium">Preview an example notification</summary>
            <p className="mt-3 font-medium">{preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-muted-foreground">{preview.body}</pre>
            <p className="mt-3 text-xs text-muted-foreground">Real notifications include the app, store, rating, author, date and review text. Outlook uses the skill&apos;s configured email template; Telegram receives plain text.</p>
          </details>

          <p className="mt-4 max-w-prose text-xs text-muted-foreground">Saving authorizes automatic messages to the recipients above while monitoring and that channel are enabled. Existing reviews are not replayed; pending alerts from the previous settings are cancelled. A send already in progress may finish.</p>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="submit" disabled={busy} className="cursor-pointer gap-2 h-10 px-6">{busy && <IconLoader2 className="size-4 animate-spin" />}{busy ? "Saving…" : alertsOn ? "Save and enable alerts" : "Save settings"}</Button>
            <Button type="button" variant="outline" disabled={busy} className="cursor-pointer h-10 px-6" onClick={() => void load(true)}>Reload saved settings</Button>
          </div>
        </form>

        <div className="mt-6">
          <p className="text-sm font-medium mb-3">Recent deliveries</p>
          <div className="rounded-xl border bg-card divide-y divide-border/60">
            {status.deliveries.length === 0 ? <div className="px-4 py-6 text-center text-xs text-muted-foreground">No alerts queued yet. New matching reviews appear here after detection.</div>
              : status.deliveries.map(delivery => <div key={delivery.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium">{delivery.channel === "email" ? "Outlook" : "Telegram"} · {delivery.recipient}</p>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{delivery.status}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{date(delivery.created_at)}</p>
                {delivery.error && <p className="mt-1 text-xs text-destructive">{delivery.error}</p>}
              </div>)}
          </div>
        </div>
      </>}
    </>}
  </section>;
}
