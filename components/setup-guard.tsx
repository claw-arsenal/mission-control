"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Props = { children: React.ReactNode };

export function SetupGuard({ children }: Props) {
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/setup", { cache: "no-store" });
        const payload = await response.json();
        const saved = String(payload?.settings?.gatewayToken || "").trim();
        const isReady = Boolean(payload?.setupCompleted) && Boolean(saved);
        setToken(saved);
        setOpen(!isReady);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load setup.");
        setOpen(true);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gatewayToken: token }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to save setup.");
      setOpen(false);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save setup.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <>
      {children}
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} className="w-full max-w-lg">
          <DialogHeader>
            <DialogTitle>Gateway token required</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">This workspace cannot be used until the gateway token is entered.</p>
            <div className="space-y-2">
              <Label htmlFor="gatewayToken">Gateway token</Label>
              <Input
                id="gatewayToken"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
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
    </>
  );
}
