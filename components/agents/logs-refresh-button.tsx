"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const POLL_SECONDS = 8;

type RefreshSource = "auto" | "manual";

export function LogsRefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [secondsLeft, setSecondsLeft] = useState(POLL_SECONDS);
  const [lastSource, setLastSource] = useState<RefreshSource>("manual");

  function triggerRefresh(source: RefreshSource) {
    setLastSource(source);
    startTransition(() => {
      router.refresh();
    });
  }

  function handleRefresh() {
    setSecondsLeft(POLL_SECONDS);
    triggerRefresh("manual");
  }

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;

      setSecondsLeft((current) => {
        if (current <= 1) {
          triggerRefresh("auto");
          return POLL_SECONDS;
        }
        return current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const buttonText = isPending
    ? lastSource === "auto"
      ? `Auto refreshing… (${secondsLeft}s)`
      : `Refreshing… (${secondsLeft}s)`
    : `Refresh (${secondsLeft}s)`;

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleRefresh}
      disabled={isPending}
      className="gap-1.5"
    >
      <RefreshCw className={`size-4 ${isPending ? "animate-spin" : ""}`} />
      {buttonText}
    </Button>
  );
}
