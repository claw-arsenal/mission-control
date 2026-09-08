"use client";

import { IconCheck, IconClock, IconLoader2, IconX } from "@tabler/icons-react";
import type { JobState } from "@/lib/mobile-apps/client/live-store";
import { LiveDuration } from "@/hooks/use-now";
import { clockTime } from "@/lib/mobile-apps/client/format";
import { cn } from "@/lib/utils";

/**
 * Where a report job is: queued, running (with a live duration), or finished.
 * Renders nothing when no job is known for the app.
 */
export function JobTimeline({ job, now }: { job: JobState | null; now: number }) {
  if (!job) return null;
  const done = job.status === "success" || job.status === "skipped";
  const failed = job.status === "failed" || job.status === "partial";
  const running = job.status === "running";
  const Icon = failed ? IconX : done ? IconCheck : running ? IconLoader2 : IconClock;
  const tone = failed ? "text-danger-fg" : done ? "text-success-fg" : running ? "text-warning-fg" : "text-muted-foreground";
  const label = failed
    ? job.status === "partial" ? "Finished with problems" : "Failed"
    : done ? "Finished"
      : running ? "Running"
        : "Queued";
  const when = clockTime(job.finishedAt ?? job.startedAt ?? job.updatedAt, now);

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", tone)} data-job-status={job.status}>
      <Icon className={cn("size-3.5", running && "motion-safe:animate-spin")} aria-hidden />
      <span className="font-medium">Report sync {label.toLowerCase()}</span>
      {running && job.startedAt ? <span className="text-muted-foreground tabular-nums"><LiveDuration startedAt={job.startedAt} prefix="for " /></span> : null}
      {when ? <span className="text-muted-foreground">· {when}</span> : null}
      {failed && job.error ? <span className="basis-full text-danger-fg/90">{job.error}</span> : null}
    </div>
  );
}
