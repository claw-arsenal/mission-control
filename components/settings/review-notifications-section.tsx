"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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

export function ReviewNotificationsSection() {
  const { role } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [config, setConfig] = useState<ReviewAlertConfig>(DEFAULT_REVIEW_ALERT_CONFIG);
  const [emails, setEmails] = useState("");
  const [chats, setChats] = useState("");
  const [generation, setGeneration] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/mobile-apps/notifications", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ generation, config: { ...config, emailRecipients: splitRecipients(emails), telegramChats: splitRecipients(chats) } }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "Could not save settings.");
      await load(true);
      setMessage("Saved. These recipients will receive matching new reviews submitted after this save.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save settings."); }
    finally { setBusy(false); }
  }
  const preview = formatReviewAlert({ appId: "example", appName: "Your app", store: "google", rating: 2, author: "A reviewer", title: null, body: "The latest update closes when I open the app.", submittedAt: null });
  const running = status?.settings.heartbeat_at && Date.now() - new Date(status.settings.heartbeat_at).getTime() < 90_000;

  return <section className="mt-10 space-y-5" aria-labelledby="review-alerts-heading">
    <div><h2 id="review-alerts-heading" className="text-lg font-semibold">Mobile app review alerts</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">Check for published reviews in the background and send each new review to your chosen recipients. Store publication delays still apply.</p></div>
    {role !== "admin" ? <p className="text-sm text-muted-foreground">An administrator can configure email and Telegram recipients.</p> : <>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {!status ? <Button variant="outline" onClick={() => void load(true)}>Load review alert settings</Button> : <>
        <div className="space-y-1 text-sm" aria-live="polite">
          <p className="font-medium">{!status.moduleEnabled ? "Paused: enable Mobile Applications in Modules." : !status.settings.config.monitoring ? "Background monitoring is paused." : running ? "Review monitor is running" : "Review monitor is offline. Start the mobile:reviews:watch service on the server."}</p>
          <p className="text-muted-foreground">Last check: {date(status.settings.last_checked_at)}. Next check: {date(status.settings.next_poll_at)}.</p>
          {status.settings.last_error && <p className="text-destructive">{status.settings.last_error}</p>}
        </div>
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={busy} className="space-y-5">
            <div className="flex items-center justify-between gap-4"><label htmlFor="review-monitor" className="text-sm font-medium">Background monitoring</label><Switch id="review-monitor" checked={config.monitoring} onCheckedChange={monitoring => setConfig({ ...config, monitoring })} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm">Check every (seconds)<Input type="number" min={60} max={3600} value={config.pollSeconds} onChange={event => setConfig({ ...config, pollSeconds: Number(event.target.value) })} required /></label>
              <label className="space-y-2 text-sm">Notify for ratings at or below<Input type="number" min={1} max={5} value={config.maxRating} onChange={event => setConfig({ ...config, maxRating: Number(event.target.value) })} required /></label>
            </div>
            <p className="text-xs text-muted-foreground">Minimum 60 seconds. Large review feeds and store errors extend the interval to respect API limits. Set rating to 5 for all reviews.</p>
            <div className="space-y-3 border-t pt-5">
              <div className="flex items-center justify-between gap-4"><label htmlFor="review-email" className="text-sm font-medium">Outlook email</label><Switch id="review-email" checked={config.emailEnabled} onCheckedChange={emailEnabled => setConfig({ ...config, emailEnabled })} /></div>
              <p className="text-sm text-muted-foreground">{status.channels.email.message}</p>
              <label className="block space-y-2 text-sm">Email recipients<Input value={emails} onChange={event => setEmails(event.target.value)} placeholder="person@example.com, team@example.com" autoComplete="off" /></label>
              <p className="text-xs text-muted-foreground">Uses the authenticated Outlook skill on the server. Recipients receive separate messages.</p>
            </div>
            <div className="space-y-3 border-t pt-5">
              <div className="flex items-center justify-between gap-4"><label htmlFor="review-telegram" className="text-sm font-medium">Telegram</label><Switch id="review-telegram" checked={config.telegramEnabled} onCheckedChange={telegramEnabled => setConfig({ ...config, telegramEnabled })} /></div>
              <p className="text-sm text-muted-foreground">{status.channels.telegram.message}</p>
              <label className="block space-y-2 text-sm">Chat IDs or channel usernames<Input value={chats} onChange={event => setChats(event.target.value)} placeholder="-1001234567890, @your_channel" autoComplete="off" /></label>
            </div>
          </fieldset>
          <details className="text-sm"><summary className="cursor-pointer font-medium">Preview an example notification</summary><p className="mt-3 font-medium">{preview.subject}</p><pre className="mt-2 whitespace-pre-wrap font-sans text-muted-foreground">{preview.body}</pre><p className="mt-2 text-xs text-muted-foreground">Real notifications include the app, store, rating, author, date and review text. Outlook uses the skill&apos;s configured email template; Telegram receives plain text.</p></details>
          <p className="max-w-prose text-xs text-muted-foreground">Saving authorizes automatic messages to the recipients above while monitoring and that channel are enabled. Existing reviews are not replayed; pending alerts from the previous settings are cancelled. A send already in progress may finish.</p>
          <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>{busy ? "Saving…" : config.monitoring && (config.emailEnabled || config.telegramEnabled) ? "Save and enable alerts" : "Save settings"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void load(true)}>Reload saved settings</Button></div>
        </form>
        <div className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">Recent deliveries</h3>
          {status.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">No alerts queued yet. New matching reviews appear here after detection.</p> : <ul className="divide-y">{status.deliveries.map(delivery => <li key={delivery.id} className="py-3 text-sm"><p className="break-words">{delivery.channel === "email" ? "Outlook" : "Telegram"} · {delivery.recipient} · <strong>{delivery.status}</strong></p><p className="text-xs text-muted-foreground">{date(delivery.created_at)}</p>{delivery.error && <p className="mt-1 text-muted-foreground">{delivery.error}</p>}</li>)}</ul>}
        </div>
      </>}
    </>}
  </section>;
}
