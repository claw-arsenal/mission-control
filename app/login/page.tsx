"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PublicClientApplication } from "@azure/msal-browser";
import { IconInnerShadowTop } from "@tabler/icons-react";
import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

type Status = "initializing" | "ready" | "signing-in";

type LoginError = {
  message: string;
  /** Config errors can be retried by re-running initialisation; sign-in errors retry via the button. */
  kind: "config" | "sign-in";
};

/** Brand mark; the hues are Microsoft's own and intentionally not tokens. */
function MicrosoftMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" fill="none" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="9" height="9" fill="#F35325" />
      <rect x="11" y="1" width="9" height="9" fill="#81BC06" />
      <rect x="1" y="11" width="9" height="9" fill="#05A6F0" />
      <rect x="11" y="11" width="9" height="9" fill="#FFBA08" />
    </svg>
  );
}

function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      {children}
    </main>
  );
}

function LoginFallback() {
  return (
    <LoginShell>
      <div className="flex flex-col items-center gap-3">
        <Spinner className="size-6" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </LoginShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<LoginError | null>(null);
  const [status, setStatus] = useState<Status>("initializing");
  const [attempt, setAttempt] = useState(0);
  const msalRef = useRef<PublicClientApplication | null>(null);

  useEffect(() => {
    let cancelled = false;

    // MSAL uses browser APIs, so it must run client-side only.
    void (async () => {
      // Fetch Azure AD config from the server at runtime (not baked in at build time).
      let clientId: string;
      let tenantId: string;
      try {
        const cfgRes = await fetch("/api/auth/config");
        if (!cfgRes.ok) throw new Error("Auth not configured");
        const cfg = (await cfgRes.json()) as { clientId: string; tenantId: string };
        clientId = cfg.clientId;
        tenantId = cfg.tenantId;
      } catch {
        if (cancelled) return;
        setError({
          message: "Authentication is not configured. Contact your administrator.",
          kind: "config",
        });
        setStatus("ready");
        return;
      }

      const { PublicClientApplication } = await import("@azure/msal-browser");

      const msal = new PublicClientApplication({
        auth: {
          clientId,
          authority: `https://login.microsoftonline.com/${tenantId}`,
          redirectUri: `${window.location.origin}/login`,
        },
        cache: {
          cacheLocation: "sessionStorage",
          storeAuthStateInCookie: false,
        },
      });

      await msal.initialize();
      if (cancelled) return;
      msalRef.current = msal;

      // Handle the redirect back from Microsoft.
      const response = await msal.handleRedirectPromise();
      if (cancelled) return;
      if (response?.idToken) {
        setStatus("signing-in");
        try {
          const res = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken: response.idToken }),
          });
          if (cancelled) return;
          if (res.ok) {
            const raw = searchParams.get("callbackUrl") ?? "";
            // Only allow same-origin relative paths, never external URLs.
            const callbackUrl =
              raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
            router.replace(callbackUrl);
            return;
          }
          setError({ message: "Sign-in failed. Please try again.", kind: "sign-in" });
        } catch {
          if (cancelled) return;
          setError({ message: "Sign-in failed. Please try again.", kind: "sign-in" });
        }
        setStatus("ready");
        return;
      }

      setStatus("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams, attempt]);

  const retryInit = () => {
    setError(null);
    setStatus("initializing");
    setAttempt((n) => n + 1);
  };

  const handleSignIn = async () => {
    const msal = msalRef.current;
    if (!msal) return;
    setError(null);
    setStatus("signing-in");
    try {
      await msal.loginRedirect({ scopes: ["openid", "profile", "email"] });
    } catch {
      setError({ message: "Could not start sign-in. Please try again.", kind: "sign-in" });
      setStatus("ready");
    }
  };

  const pending = status !== "ready";
  // MSAL is only unavailable when config failed to load; that error carries its own retry.
  const canSignIn = !pending && error?.kind !== "config";

  return (
    <LoginShell>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
            <IconInnerShadowTop className="size-7 text-primary" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>Use your Microsoft work account to continue.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{error.kind === "config" ? "Sign-in unavailable" : "Sign-in failed"}</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
              {error.kind === "config" && (
                <AlertActions>
                  <Button variant="outline" size="sm" onClick={retryInit} disabled={pending}>
                    Retry
                  </Button>
                </AlertActions>
              )}
            </Alert>
          )}

          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => void handleSignIn()}
            disabled={!canSignIn}
            aria-busy={pending}
          >
            {pending ? <Spinner /> : <MicrosoftMark className="size-4" />}
            {status === "signing-in"
              ? "Signing you in…"
              : status === "initializing"
                ? "Loading…"
                : "Sign in with Microsoft"}
          </Button>
        </CardContent>
      </Card>
    </LoginShell>
  );
}
