"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import { toast } from "sonner";

type SettingsState = {
  bridgeEmail: string;
};

type NotificationState = {
  telegramTarget: string;
  telegramEnabled: boolean;
};

const initialState: SettingsState = {
  bridgeEmail: "",
};

export default function SettingsPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<SettingsState>(initialState);
  const [notification, setNotification] = useState<NotificationState>({
    telegramTarget: "",
    telegramEnabled: false,
  });

  useEffect(() => {
    if (!unlocked) return;
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/setup", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load settings.");
        }

        if (!active) return;
        const settings = (payload.settings || {}) as Partial<SettingsState>;
        setState({
          bridgeEmail: settings.bridgeEmail || "",
        });

        const notificationsResponse = await fetch("/api/notifications", { cache: "no-store" });
        const notificationsPayload = await notificationsResponse.json();
        if (notificationsResponse.ok) {
          const channels = Array.isArray(notificationsPayload.channels) ? notificationsPayload.channels : [];
          const telegram = channels.find(
            (channel: { provider?: string }) => String(channel.provider || "") === "telegram",
          ) as { target?: string; enabled?: boolean } | undefined;

          setNotification({
            telegramTarget: telegram?.target || "",
            telegramEnabled: telegram?.enabled === true,
          });
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load settings.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [unlocked]);

  const unlock = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const client = getBrowserSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();

    if (userError || !user?.email) {
      setError(userError?.message || "Unauthorized");
      return;
    }

    const { error: authError } = await client.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (authError) {
      setError("Incorrect password.");
      return;
    }

    setUnlocked(true);
    setPassword("");
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...state, setupCompleted: true }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save settings.");
      }

      if (notification.telegramTarget) {
        const notifyResponse = await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "telegram",
            target: notification.telegramTarget,
            enabled: notification.telegramEnabled,
            events: ["ticket.queued", "ticket.picked_up", "ticket.retry_scheduled", "ticket.failed", "ticket.done", "ticket.cancelled"],
          }),
        });

        const notifyPayload = await notifyResponse.json();
        if (!notifyResponse.ok) {
          throw new Error(notifyPayload.error || "Failed to save notification channel.");
        }
      }

      toast.success("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  if (!unlocked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <form onSubmit={unlock} className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 shadow-sm">
          <div>
            <h1 className="text-xl font-semibold">Settings locked</h1>
            <p className="mt-1 text-sm text-muted-foreground">Enter your password to access settings.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="w-full">
            Unlock settings
          </Button>
        </form>
      </main>
    );
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading settings…</div>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={save} className="w-full max-w-lg space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Workspace settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Update your private workspace runtime configuration.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bridgeEmail">Bridge email</Label>
          <Input
            id="bridgeEmail"
            value={state.bridgeEmail}
            onChange={(event) => setState((prev) => ({ ...prev, bridgeEmail: event.target.value }))}
          />
        </div>

        <div className="space-y-2 rounded border p-3">
          <Label htmlFor="telegramTarget">Telegram notifications (optional)</Label>
          <Input
            id="telegramTarget"
            value={notification.telegramTarget}
            onChange={(event) =>
              setNotification((prev) => ({ ...prev, telegramTarget: event.target.value }))
            }
            placeholder="chat id, for example 839196934 or -100..."
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={notification.telegramEnabled}
              onChange={(event) =>
                setNotification((prev) => ({ ...prev, telegramEnabled: event.target.checked }))
              }
            />
            Enable task notifications (queued, picked up, retry, failed, done, cancelled)
          </label>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </form>
    </main>
  );
}
