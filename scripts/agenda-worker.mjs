#!/usr/bin/env node
/**
 * Agenda Execution Worker — consumes jobs from BullMQ agenda queue.
 * Runs free prompts and process steps via openclaw agent CLI.
 * v2: Resilient orchestration — execution windows, claim locks, auto-retry,
 *     fallback models, telegram notifications, service heartbeat.
 */
import postgres from "postgres";
import { Worker } from "bullmq";
import { execFile } from "node:child_process";
import { mkdir, writeFile, readFile, stat, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import * as dns from "node:dns";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const lookupAsync = promisify(dns.lookup.bind(dns));

const connectionString = process.env.DATABASE_URL?.trim() || process.env.OPENCLAW_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("[agenda-worker] Missing DATABASE_URL / OPENCLAW_DATABASE_URL");
  process.exit(1);
}

const REDIS_HOST = process.env.REDIS_HOST || process.env.REDIS_URL?.replace(/^redis:\/\//, "").split(":")[0] || "localhost";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const SERVICE_NAME = "agenda-worker";

const sql = postgres(connectionString, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });

// ── Service heartbeat ─────────────────────────────────────────────────────────
async function writeHeartbeat(status = "running", lastError = null) {
  try {
    await sql`
      INSERT INTO service_health (name, status, pid, last_heartbeat_at, last_error, started_at, updated_at)
      VALUES (${SERVICE_NAME}, ${status}, ${process.pid}, now(), ${lastError}, now(), now())
      ON CONFLICT (name) DO UPDATE SET
        status = ${status},
        pid = ${process.pid},
        last_heartbeat_at = now(),
        last_error = COALESCE(${lastError}, service_health.last_error),
        updated_at = now()
    `;
  } catch (err) {
    console.warn("[agenda-worker] Heartbeat write failed:", err.message);
  }
}

// ── Telegram notification helper ──────────────────────────────────────────────
async function sendTelegramNotification(message) {
  try {
    await execFileAsync("openclaw", [
      "message", "send",
      "--channel", "telegram",
      "--message", message,
      "--json",
    ], { timeout: 30000, env: process.env });
  } catch (err) {
    console.warn("[agenda-worker] Telegram notification failed:", err.message);
  }
}

const agendaWorker = new Worker(
  "agenda",
  async (job) => {
    const { occurrenceId, eventId, title, freePrompt, agentId, processes, scheduledFor, executionWindowMinutes, fallbackModel } = job.data;

    console.log(`[agenda-worker] Processing occurrence ${occurrenceId} — "${title}"`);

    // ── Execution window check ────────────────────────────────────────────────
    const scheduledTime = new Date(scheduledFor || job.timestamp);
    const windowMinutes = executionWindowMinutes || 30;
    const diffMinutes = (Date.now() - scheduledTime.getTime()) / 60000;
    if (diffMinutes > windowMinutes) {
      // Mark as needs_retry (not expired) — user can press Retry to run it now
      await sql`UPDATE agenda_occurrences SET status = 'needs_retry' WHERE id = ${occurrenceId}`;
      // Create a run attempt with the reason logged
      const missedAttemptNo = ((await sql`SELECT latest_attempt_no FROM agenda_occurrences WHERE id = ${occurrenceId}`)[0]?.latest_attempt_no ?? 0) + 1;
      await sql`
        INSERT INTO agenda_run_attempts (occurrence_id, attempt_no, status, started_at, finished_at, error_message)
        VALUES (${occurrenceId}, ${missedAttemptNo}, 'failed', now(), now(), ${`Missed execution window — ${Math.round(diffMinutes)}min past ${windowMinutes}min limit`})
      `;
      await sql`UPDATE agenda_occurrences SET latest_attempt_no = ${missedAttemptNo} WHERE id = ${occurrenceId}`;
      console.warn(`[agenda-worker] Occurrence ${occurrenceId} needs retry (${diffMinutes.toFixed(1)}m past window of ${windowMinutes}m)`);
      await sendTelegramNotification(`⚠️ Agenda event "${title}" missed execution window (${Math.round(diffMinutes)}m late) — needs manual retry in Mission Control`);
      return { skipped: true, reason: 'missed_window' };
    }

    // ── Postgres-level claim lock ─────────────────────────────────────────────
    const [claimed] = await sql`
      UPDATE agenda_occurrences SET status = 'running', locked_at = now()
      WHERE id = ${occurrenceId} AND status IN ('scheduled', 'queued', 'needs_retry')
      RETURNING id, latest_attempt_no
    `;
    if (!claimed) {
      console.log(`[agenda-worker] Occurrence ${occurrenceId} already claimed, skipping`);
      return { skipped: true, reason: 'already_claimed' };
    }
    await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "running", occurrenceId })})`;

    const attemptNo = (claimed.latest_attempt_no ?? 0) + 1;

    // ── Create run attempt ────────────────────────────────────────────────────
    const [attempt] = await sql`
      insert into agenda_run_attempts (occurrence_id, attempt_no, status, started_at)
      values (${occurrenceId}, ${attemptNo}, 'running', now())
      returning *
    `;

    const runAttemptId = attempt.id;
    let overallSuccess = true;
    const stepSummaries = [];

    // ── Long-running failsafe: alert after 5 minutes ────────────────────────
    let longRunAlerted = false;
    const longRunTimer = setTimeout(async () => {
      longRunAlerted = true;
      const elapsed = "5+ minutes";
      const msg = `⏱️ Long-running agenda event alert\n\n` +
        `Event: "${title}"\n` +
        `Occurrence: ${occurrenceId}\n` +
        `Attempt: #${attemptNo}\n` +
        `Running for: ${elapsed}\n` +
        `Started: ${attempt.started_at}\n\n` +
        `This event is taking longer than expected. Check Mission Control for details or use Force Retry to restart it.`;
      await sendTelegramNotification(msg);
      console.warn(`[agenda-worker] Long-running alert sent for "${title}" (occurrence ${occurrenceId})`);
    }, 5 * 60 * 1000); // 5 minutes

    try {
      // ── 1. Execute free prompt ─────────────────────────────────────────────
      if (freePrompt) {
        const stepResult = await runAgentStep({
          runAttemptId,
          processVersionId: null,
          processStepId: null,
          stepOrder: 0,
          agentId: agentId || "main",
          skillKey: null,
          instruction: freePrompt,
          timeoutSeconds: null,
          fallbackModel: fallbackModel || null,
          sql,
        });

        stepSummaries.push({
          type: "free_prompt",
          success: stepResult.success,
          summary: stepResult.output.slice(0, 200),
        });

        if (!stepResult.success) {
          overallSuccess = false;
        }
      }

      // ── 2. Execute attached processes sequentially (with cumulative context) ──
      const sorted = [...(processes ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      // Build cumulative context so each step can reference previous outputs
      let cumulativeContext = "";
      if (freePrompt && stepSummaries.length > 0 && stepSummaries[0].success) {
        cumulativeContext = `Previous output (free prompt):\n${stepSummaries[0].summary || ""}\n\n`;
      }

      for (const proc of sorted) {
        const pvId = proc.process_version_id;

        const stepRows = await sql`
          select ps.*
          from process_steps ps
          where ps.process_version_id = ${pvId}
          order by ps.step_order asc
        `;

        for (const stepRow of stepRows) {
          // Prepend cumulative context so step can reference previous outputs
          const contextualInstruction = cumulativeContext
            ? `Context from previous steps:\n${cumulativeContext}---\nCurrent step instruction:\n${stepRow.instruction}`
            : stepRow.instruction;

          const stepResult = await runAgentStep({
            runAttemptId,
            processVersionId: pvId,
            processStepId: stepRow.id,
            stepOrder: stepRow.step_order,
            agentId: stepRow.agent_id || agentId || "main",
            skillKey: stepRow.skill_key,
            instruction: contextualInstruction,
            timeoutSeconds: stepRow.timeout_seconds,
            fallbackModel: stepRow.fallback_model || fallbackModel || null,
            sql,
          });

          stepSummaries.push({
            type: "process_step",
            processVersionId: pvId,
            stepId: stepRow.id,
            stepTitle: stepRow.title,
            success: stepResult.success,
            summary: stepResult.output.slice(0, 200),
            error: stepResult.error,
          });

          // Accumulate context for next step
          cumulativeContext += `Previous output (${stepRow.title || 'Step ' + stepRow.step_order}):\n${stepResult.output.slice(0, 500)}\n\n`;

          if (!stepResult.success) {
            overallSuccess = false;
          }
        }
      }

      // ── Inline retry logic (no backoff) ──────────────────────────────────
      if (!overallSuccess) {
        // Instant retry — re-run all steps
        console.log(`[agenda-worker] First attempt failed for ${occurrenceId}, instant retry...`);
        overallSuccess = true;
        stepSummaries.length = 0;
        cumulativeContext = "";

        // Re-run free prompt
        if (freePrompt) {
          const stepResult = await runAgentStep({
            runAttemptId, processVersionId: null, processStepId: null, stepOrder: 0,
            agentId: agentId || "main", skillKey: null, instruction: freePrompt,
            timeoutSeconds: null, fallbackModel: fallbackModel || null, sql,
          });
          stepSummaries.push({ type: "free_prompt", success: stepResult.success, summary: stepResult.output.slice(0, 200) });
          if (!stepResult.success) overallSuccess = false;
          else cumulativeContext = `Previous output (free prompt):\n${stepResult.output.slice(0, 500)}\n\n`;
        }
        // Re-run attached processes
        if (overallSuccess || !freePrompt) {
          for (const proc of sorted) {
            const pvId = proc.process_version_id;
            const stepRows = await sql`select ps.* from process_steps ps where ps.process_version_id = ${pvId} order by ps.step_order asc`;
            for (const stepRow of stepRows) {
              const contextualInstruction = cumulativeContext
                ? `Context from previous steps:\n${cumulativeContext}---\nCurrent step instruction:\n${stepRow.instruction}`
                : stepRow.instruction;
              const stepResult = await runAgentStep({
                runAttemptId, processVersionId: pvId, processStepId: stepRow.id, stepOrder: stepRow.step_order,
                agentId: stepRow.agent_id || agentId || "main", skillKey: stepRow.skill_key,
                instruction: contextualInstruction, timeoutSeconds: stepRow.timeout_seconds,
                fallbackModel: stepRow.fallback_model || fallbackModel || null, sql,
              });
              stepSummaries.push({ type: "process_step", processVersionId: pvId, stepId: stepRow.id, stepTitle: stepRow.title, success: stepResult.success, summary: stepResult.output.slice(0, 200), error: stepResult.error });
              cumulativeContext += `Previous output (${stepRow.title || 'Step ' + stepRow.step_order}):\n${stepResult.output.slice(0, 500)}\n\n`;
              if (!stepResult.success) { overallSuccess = false; break; }
            }
            if (!overallSuccess) break;
          }
        }
      }

      // Fallback model retry if still failing and fallbackModel is set
      if (!overallSuccess && fallbackModel) {
        console.log(`[agenda-worker] Retry failed for ${occurrenceId}, trying fallback model: ${fallbackModel}`);
        overallSuccess = true;
        stepSummaries.length = 0;
        cumulativeContext = "";

        if (freePrompt) {
          const stepResult = await runAgentStep({
            runAttemptId, processVersionId: null, processStepId: null, stepOrder: 0,
            agentId: agentId || "main", skillKey: null, instruction: freePrompt,
            timeoutSeconds: null, fallbackModel: null, overrideModel: fallbackModel, sql,
          });
          stepSummaries.push({ type: "free_prompt", success: stepResult.success, summary: stepResult.output.slice(0, 200) });
          if (!stepResult.success) overallSuccess = false;
          else cumulativeContext = `Previous output (free prompt):\n${stepResult.output.slice(0, 500)}\n\n`;
        }
        if (overallSuccess || !freePrompt) {
          for (const proc of sorted) {
            const pvId = proc.process_version_id;
            const stepRows = await sql`select ps.* from process_steps ps where ps.process_version_id = ${pvId} order by ps.step_order asc`;
            for (const stepRow of stepRows) {
              const contextualInstruction = cumulativeContext
                ? `Context from previous steps:\n${cumulativeContext}---\nCurrent step instruction:\n${stepRow.instruction}`
                : stepRow.instruction;
              const stepResult = await runAgentStep({
                runAttemptId, processVersionId: pvId, processStepId: stepRow.id, stepOrder: stepRow.step_order,
                agentId: stepRow.agent_id || agentId || "main", skillKey: stepRow.skill_key,
                instruction: contextualInstruction, timeoutSeconds: stepRow.timeout_seconds,
                fallbackModel: null, overrideModel: stepRow.fallback_model || fallbackModel, sql,
              });
              stepSummaries.push({ type: "process_step", processVersionId: pvId, stepId: stepRow.id, stepTitle: stepRow.title, success: stepResult.success, summary: stepResult.output.slice(0, 200), error: stepResult.error });
              cumulativeContext += `Previous output (${stepRow.title || 'Step ' + stepRow.step_order}):\n${stepResult.output.slice(0, 500)}\n\n`;
              if (!stepResult.success) { overallSuccess = false; break; }
            }
            if (!overallSuccess) break;
          }
        }
      }

      // ── Finalize after retries ──────────────────────────────────────────────
      const summaryText = stepSummaries
        .map((s) => {
          const ok = s.success ? "✅" : "❌";
          if (s.type === "free_prompt") return `${ok} Free prompt`;
          return `${ok} ${s.stepTitle || "Step"}`;
        })
        .join(" | ");

      await sql`
        update agenda_run_attempts
        set status = ${overallSuccess ? "succeeded" : "failed"},
            finished_at = now(),
            summary = ${summaryText}
        where id = ${runAttemptId}
      `;

      if (overallSuccess) {
        await sql`
          update agenda_occurrences
          set status = 'succeeded', latest_attempt_no = ${attemptNo}
          where id = ${occurrenceId}
        `;
        await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "succeeded", occurrenceId })})`;
        console.log(`[agenda-worker] Completed occurrence ${occurrenceId} — succeeded`);
      } else {
        // All retries exhausted → needs_retry
        await sql`
          update agenda_occurrences
          set status = 'needs_retry', latest_attempt_no = ${attemptNo}
          where id = ${occurrenceId}
        `;
        await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "needs_retry", occurrenceId })})`;
        console.warn(`[agenda-worker] Occurrence ${occurrenceId} needs manual retry (all retries exhausted)`);
        await sendTelegramNotification(`⚠️ Agenda event "${title}" needs manual retry (all retries exhausted)`);
      }

      clearTimeout(longRunTimer);
      return { success: overallSuccess, summary: summaryText };
    } catch (error) {
      clearTimeout(longRunTimer);
      const msg = error instanceof Error ? error.message : String(error);
      await sql`
        update agenda_run_attempts
        set status = 'failed', finished_at = now(), error_message = ${msg}
        where id = ${runAttemptId}
      `;

      // Fatal error → needs_retry directly
      await sql`
        update agenda_occurrences
        set status = 'needs_retry', latest_attempt_no = ${attemptNo}
        where id = ${occurrenceId}
      `;
      await sql`select pg_notify('agenda_change', ${JSON.stringify({ action: "failed", occurrenceId })})`;
      await sendTelegramNotification(`❌ Agenda event "${title}" failed: ${msg.slice(0, 200)}`);

      console.error(`[agenda-worker] Fatal error on ${occurrenceId}:`, msg);
      throw error;
    }
  },
  {
    connection: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
    concurrency: parseInt(process.env.AGENDA_CONCURRENCY || "5", 10),
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  }
);

agendaWorker.on("completed", (job, result) => {
  console.log(`[agenda-worker] Job ${job.id} completed:`, result);
});

agendaWorker.on("failed", (job, err) => {
  console.error(`[agenda-worker] Job ${job?.id} failed:`, err.message);
});

// ── Step execution helper ─────────────────────────────────────────────────────

function isRateLimitError(errorMsg) {
  const lower = (errorMsg || "").toLowerCase();
  return lower.includes("429") || lower.includes("rate limit") || lower.includes("quota") || lower.includes("too many");
}

async function runAgentStep({
  runAttemptId,
  processVersionId,
  processStepId,
  stepOrder,
  agentId,
  skillKey,
  instruction,
  timeoutSeconds,
  fallbackModel,
  overrideModel,
  sql,
}) {
  const effectiveAgentId = (agentId && agentId !== "null") ? agentId : "main";
  const effectiveTimeout = Math.max(timeoutSeconds ?? 300, 60);
  const skillArg = skillKey ? ["--skill", skillKey] : [];

  let output = "";
  let errorMsg = null;
  let success = true;
  let artifactData = null;
  let usedFallback = false;

  async function executeAgent(modelOverride = null) {
    const effectiveModel = modelOverride || overrideModel || null;
    const modelArg = effectiveModel ? ["--model", effectiveModel] : [];
    const args = [
      "agent",
      "--agent", effectiveAgentId,
      "--message", instruction,
      "--json",
      ...skillArg,
      ...modelArg,
    ];

    return execFileAsync("openclaw", args, {
      timeout: effectiveTimeout * 1000,
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
    });
  }

  try {
    let raw;
    try {
      const result = await executeAgent();
      raw = result.stdout;
    } catch (primaryErr) {
      const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      // If rate limit error and fallback model available, retry with fallback
      if (fallbackModel && isRateLimitError(primaryMsg)) {
        console.log(`[agenda-worker] Rate limit hit, retrying with fallback model: ${fallbackModel}`);
        usedFallback = true;
        const result = await executeAgent(fallbackModel);
        raw = result.stdout;
      } else {
        throw primaryErr;
      }
    }

    const parsed = JSON.parse(raw);
    const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? [];

    // Separate text vs file payloads
    const textParts = [];
    const filePayloads = [];

    if (Array.isArray(payloads)) {
      for (const p of payloads) {
        if (p.type === "file" && p.data) {
          filePayloads.push({
            name: p.name || p.filename || `file-${Date.now()}`,
            mimeType: p.mimeType || p.contentType || "application/octet-stream",
            data: p.data,
          });
        } else {
          textParts.push(p.text ?? "");
        }
      }
    }

    output = textParts.join("\n").trim() || (parsed?.result ?? parsed?.text ?? JSON.stringify(parsed));

    // Save file artifacts from structured payloads
    if (filePayloads.length > 0) {
      const artifactDir = resolve("/storage/mission-control/artifacts", runAttemptId);
      await mkdir(artifactDir, { recursive: true });

      const savedFiles = [];
      for (const art of filePayloads) {
        const filePath = resolve(artifactDir, art.name);
        const buffer = Buffer.from(art.data, "base64");
        await writeFile(filePath, buffer);
        savedFiles.push({
          name: art.name,
          mimeType: art.mimeType,
          size: buffer.length,
          path: filePath,
        });
      }
      artifactData = { files: savedFiles };
    }

    // ── Detect files mentioned in agent text output ───────────────────────
    if (success && output) {
      const pathRegex = /(\/(?:home|storage|tmp|var|opt|root)[^\s`"')\]>]+\.\w{1,10})/g;
      const detectedPaths = [...new Set((output.match(pathRegex) || []))];
      const discoveredFiles = [];

      for (const p of detectedPaths) {
        try {
          const cleaned = p.replace(/[.,;:!?)}\]]+$/, "");
          if (!existsSync(cleaned)) continue;
          const fstat = await stat(cleaned);
          if (!fstat.isFile() || fstat.size > 50 * 1024 * 1024) continue;

          const fname = basename(cleaned);
          const ext = extname(fname).toLowerCase().slice(1);
          const mimeMap = {
            md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json",
            pdf: "application/pdf", html: "text/html", xml: "text/xml", yaml: "text/yaml", yml: "text/yaml",
            png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
            svg: "image/svg+xml", ico: "image/x-icon",
            zip: "application/zip", tar: "application/x-tar", gz: "application/gzip",
            js: "text/javascript", ts: "text/typescript", py: "text/x-python", sh: "text/x-shellscript",
            doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          };
          const mimeType = mimeMap[ext] || "application/octet-stream";

          discoveredFiles.push({ sourcePath: cleaned, name: fname, mimeType, size: fstat.size });
        } catch { /* skip inaccessible paths */ }
      }

      if (discoveredFiles.length > 0) {
        const artifactDir = resolve("/storage/mission-control/artifacts", runAttemptId);
        await mkdir(artifactDir, { recursive: true });

        const existingFiles = artifactData?.files ?? [];
        const existingNames = new Set(existingFiles.map((f) => f.name));

        for (const df of discoveredFiles) {
          if (existingNames.has(df.name)) continue;
          const destPath = resolve(artifactDir, df.name);
          await copyFile(df.sourcePath, destPath);
          existingFiles.push({
            name: df.name,
            mimeType: df.mimeType,
            size: df.size,
            path: destPath,
          });
        }

        artifactData = { files: existingFiles };
      }
    }
  } catch (err) {
    success = false;
    errorMsg = err instanceof Error ? err.message : String(err);
    output = `Error: ${errorMsg}`;
  }

  // Handle empty response
  if (success && (!output || output.trim() === "")) {
    output = "(Agent returned empty response)";
  }

  // Persist step result
  await sql`
    insert into agenda_run_steps (
      run_attempt_id, process_version_id, process_step_id, step_order,
      agent_id, skill_key, input_payload, output_payload, artifact_payload, status,
      started_at, finished_at, error_message
    ) values (
      ${runAttemptId},
      ${processVersionId ?? null},
      ${processStepId ?? null},
      ${stepOrder},
      ${effectiveAgentId},
      ${skillKey ?? null},
      ${sql.json({ instruction, skillKey, agentId, timeoutSeconds, usedFallback })},
      ${sql.json({ output })},
      ${artifactData ? sql.json(artifactData) : null},
      ${success ? "succeeded" : "failed"},
      now(),
      now(),
      ${errorMsg}
    )
  `;

  return { success, output, error: errorMsg, artifacts: artifactData };
}

// ── Stale lock recovery ───────────────────────────────────────────────────────
async function recoverStaleLocks() {
  try {
    const stale = await sql`
      update agenda_occurrences
      set status = 'scheduled', locked_at = null
      where status = 'running'
        and locked_at < now() - interval '15 minutes'
      returning id
    `;
    if (stale.length > 0) {
      console.log(`[agenda-worker] Recovered ${stale.length} stale lock(s)`);
    }
  } catch (err) {
    console.warn("[agenda-worker] Stale lock recovery failed:", err.message);
  }
}

// Run recovery on startup + every 5 minutes
await mkdir("/storage/mission-control/artifacts", { recursive: true }).catch(() => {});
await recoverStaleLocks();
setInterval(recoverStaleLocks, 5 * 60 * 1000);

// ── Healthcheck ───────────────────────────────────────────────────────────────
async function checkRedis() {
  try {
    await lookupAsync(REDIS_HOST);
    return true;
  } catch {
    return false;
  }
}

setInterval(async () => {
  const ok = await checkRedis();
  if (!ok) {
    console.warn("[agenda-worker] Redis unreachable — worker may be stalled");
  }
}, 30_000);

// ── Service heartbeat on startup + every 30s ──────────────────────────────────
await writeHeartbeat("running");
const heartbeatInterval = setInterval(() => writeHeartbeat("running"), 30_000);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[agenda-worker] Shutting down...");
  clearInterval(heartbeatInterval);
  await writeHeartbeat("stopped").catch(() => {});
  await agendaWorker.close();
  await sql.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("[agenda-worker] Started — agenda queue consumer active (concurrency: 5)");
