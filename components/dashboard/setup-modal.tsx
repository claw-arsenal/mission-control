"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

type SetupFormState = {
  bridgeEmail: string;
  telegramTarget: string;
  telegramEnabled: boolean;
};

type Props = {
  initialSetupCompleted: boolean;
};

export function SetupModal({ initialSetupCompleted }: Props) {
  const [open, setOpen] = useState(!initialSetupCompleted);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<SetupFormState>({
    bridgeEmail: "",
    telegramTarget: "",
    telegramEnabled: false,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/setup", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load setup.");
        }

        const settings = (payload.settings || {}) as Record<string, unknown>;
        setForm((prev) => ({
          ...prev,
          bridgeEmail: String(settings.bridgeEmail || ""),
        }));

        // Load notification channels
        const notifyResponse = await fetch("/api/notifications", { cache: "no-store" });
        const notifyPayload = await notifyResponse.json();
        if (notifyResponse.ok && Array.isArray(notifyPayload.channels)) {
          const telegramChannel = notifyPayload.channels.find(
            (c: { provider?: string }) => String(c.provider || "") === "telegram"
          ) as { target?: string; enabled?: boolean } | undefined;

          if (telegramChannel) {
            setForm((prev) => ({
              ...prev,
              telegramTarget: String(telegramChannel.target || ""),
              telegramEnabled: telegramChannel.enabled === true,
            }));
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load setup.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaving(true);

    try {
      // Save setup
      const setupResponse = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bridgeEmail: form.bridgeEmail,
          setupCompleted: true,
        }),
      });

      const setupPayload = await setupResponse.json();
      if (!setupResponse.ok) {
        throw new Error(setupPayload.error || "Failed to save setup.");
      }

      // Save telegram notification if configured
      if (form.telegramTarget.trim()) {
        const notifyResponse = await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "telegram",
            target: form.telegramTarget,
            enabled: form.telegramEnabled,
            events: ["ticket.queued", "ticket.picked_up", "ticket.retry_scheduled", "ticket.failed", "ticket.done", "ticket.cancelled"],
          }),
        });

        const notifyPayload = await notifyResponse.json();
        if (!notifyResponse.ok) {
          throw new Error(notifyPayload.error || "Failed to save Telegram channel.");
        }
      }

      setOpen(false);
      toast.success("Setup completed!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete setup.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="w-full max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Workspace setup</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Complete this once to configure your workspace. All fields are optional and can be updated in settings later.
          </p>

          <div className="space-y-2">
            <Label htmlFor="bridgeEmail">Bridge email (optional)</Label>
            <Input
              id="bridgeEmail"
              value={form.bridgeEmail}
              onChange={(e) => setForm((prev) => ({ ...prev, bridgeEmail: e.target.value }))}
              placeholder="you@company.com"
            />
            <p className="text-xs text-muted-foreground">
              Usually your dashboard login email. Also used by the dashboard bridge.
            </p>
          </div>

          <div className="space-y-2 rounded border p-3">
            <Label htmlFor="telegramTarget">Telegram notifications (optional)</Label>
            <Input
              id="telegramTarget"
              value={form.telegramTarget}
              onChange={(e) => setForm((prev) => ({ ...prev, telegramTarget: e.target.value }))}
              placeholder="chat id, e.g., 839196934 or -100..."
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={form.telegramEnabled}
                onChange={(e) => setForm((prev) => ({ ...prev, telegramEnabled: e.target.checked }))}
              />
              Enable task notifications (queued, picked up, retry, failed, done, cancelled)
            </label>
            <p className="text-xs text-muted-foreground">
              Get notified about ticket execution events via Telegram.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Completing setup…" : "Complete setup"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
