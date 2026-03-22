"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

type SetupFormState = { gatewayToken: string };

type Props = { initialSetupCompleted: boolean };

export function SetupModal({ initialSetupCompleted }: Props) {
  const [open, setOpen] = useState(!initialSetupCompleted);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<SetupFormState>({ gatewayToken: "" });

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/setup", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Failed to load setup.");
        const settings = (payload.settings || {}) as Record<string, unknown>;
        const token = String(settings.gatewayToken || "").trim();
        setForm({ gatewayToken: token });
        setOpen(!Boolean(payload.setupCompleted) || !token);
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
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gatewayToken: form.gatewayToken }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to save setup.");
      setOpen(false);
      toast.success("Gateway token saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete setup.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="w-full max-w-lg">
        <DialogHeader>
          <DialogTitle>Gateway token required</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This workspace cannot be used until the gateway token is entered.
          </p>
          <p className="text-xs text-muted-foreground">
            The dashboard refreshes live state when this setup completes.
          </p>
          <div className="space-y-2">
            <Label htmlFor="gatewayToken">Gateway token</Label>
            <Input
              id="gatewayToken"
              type="password"
              value={form.gatewayToken}
              onChange={(e) => setForm({ gatewayToken: e.target.value })}
              placeholder="paste your gateway token"
              autoComplete="off"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? "Saving…" : "Save token"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
