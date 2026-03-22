"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SettingsPage() {
  const [gatewayToken, setGatewayToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/setup", { cache: "no-store" });
      const payload = await response.json();
      const settings = (payload.settings || {}) as Record<string, unknown>;
      setGatewayToken(String(settings.gatewayToken || ""));
    };
    void load();
  }, []);

  const onSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gatewayToken }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to save settings.");
      setMessage("Saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={onSave} className="w-full max-w-lg space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Local workspace settings.</p>
        <div className="space-y-2">
          <Label htmlFor="gatewayToken">Gateway token</Label>
          <Input id="gatewayToken" type="password" value={gatewayToken} onChange={(e) => setGatewayToken(e.target.value)} autoComplete="off" />
        </div>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </form>
    </main>
  );
}
