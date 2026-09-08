"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

type SetupState = {
  bridgeEmail: string;
};

const initialState: SetupState = {
  bridgeEmail: "",
};

export default function SetupPage() {
  const router = useRouter();
  const [state, setState] = useState<SetupState>(initialState);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/setup", { cache: "reload" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load setup.");
        }

        if (!active) return;

        const settings = (payload.settings || {}) as Partial<SetupState>;
        setState({
          bridgeEmail: settings.bridgeEmail || "",
        });
        setLoadError(null);
      } catch (err) {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load setup.");
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError(null);
    setLoadAttempt((n) => n + 1);
  };

  const save = async () => {
    setSaveError(null);
    setSaving(true);

    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...state,
          setupCompleted: true,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save setup.");
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save setup.");
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">Workspace setup required</CardTitle>
          <CardDescription>
            Complete this once to isolate your runtime agent configuration. No fields are
            mandatory; you can finish now and update values later in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4" aria-busy="true" aria-live="polite">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-9 w-full" />
            </div>
          ) : loadError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load setup</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
              <AlertActions>
                <Button variant="outline" size="sm" onClick={retryLoad}>
                  Retry
                </Button>
              </AlertActions>
            </Alert>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bridgeEmail">Bridge email (optional)</Label>
                <Input
                  id="bridgeEmail"
                  type="email"
                  autoComplete="email"
                  value={state.bridgeEmail}
                  onChange={(event) =>
                    setState((prev) => ({ ...prev, bridgeEmail: event.target.value }))
                  }
                  placeholder="you@company.com"
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">
                  Usually your dashboard login email. Also used by{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    dashboard-bridge --email …
                  </code>
                  .
                </p>
              </div>

              {saveError ? (
                <Alert variant="destructive">
                  <AlertTitle>Could not save setup</AlertTitle>
                  <AlertDescription>{saveError}</AlertDescription>
                  <AlertActions>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void save()}
                      disabled={saving}
                    >
                      Retry
                    </Button>
                  </AlertActions>
                </Alert>
              ) : null}

              <Button type="submit" className="w-full" disabled={saving} aria-busy={saving}>
                {saving && <Spinner className="text-current" />}
                {saving ? "Saving…" : "Complete setup"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
