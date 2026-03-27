import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";

const execFileAsync = promisify(execFile);

type ProcessStep = {
  title?: string;
  step_title?: string;
  instruction?: string;
  agent_id?: string;
  agentId?: string;
  skill_key?: string;
  skillKey?: string;
  model_override?: string;
  modelOverride?: string;
  timeout_seconds?: number | null;
  timeoutSeconds?: number | null;
};

export async function POST(request: Request) {
  const sql = getSql();
  const body = await request.json();

  let steps: ProcessStep[] = [];
  if (body?.processId) {
    const [latestPv] = await sql`select id from process_versions where process_id = ${body.processId} order by version_number desc limit 1`;
    if (!latestPv) return NextResponse.json({ ok: false, error: "Process not found" });
    steps = await sql`select * from process_steps where process_version_id = ${latestPv.id} order by step_order asc`;
  } else if (Array.isArray(body?.steps)) {
    steps = body.steps;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const allFiles: string[] = [];
      const pathRegex = /(\/(?:home|storage|tmp|var|opt|root)[^\s\`"')\]>]+\.\w{1,10})/g;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const agentId = step.agent_id || step.agentId || "main";
        const instruction = step.instruction || "";
        const skillKey = step.skill_key || step.skillKey || "";
        const modelOverride = step.model_override || step.modelOverride || "";
        const timeout = (step.timeout_seconds || step.timeoutSeconds || 300) * 1000;

        send({
          stepIndex: i,
          status: "running",
          title: step.title || step.step_title || `Step ${i + 1}`,
          instruction: instruction.slice(0, 500),
          agentId,
          skillKey: skillKey || null,
          modelOverride: modelOverride || null,
        });

        const args = ["agent", "--agent", agentId, "--message", `[SIMULATION MODE — do not make permanent changes, only show what you would do]\n\n${instruction}`, "--json"];
        if (skillKey) args.push("--skill", skillKey);
        if (modelOverride) args.push("--model", modelOverride);

        try {
          const { stdout } = await execFileAsync("openclaw", args, { timeout, env: process.env, maxBuffer: 50 * 1024 * 1024 });
          const parsed = JSON.parse(stdout);
          const payloads = parsed?.result?.payloads ?? parsed?.payloads ?? [];
          const output = payloads.map((p: { text?: string }) => p.text ?? "").join("\n").trim() || JSON.stringify(parsed);
          const detected = [...new Set((output.match(pathRegex) || []) as string[])].map((p: string) => p.replace(/[.,;:!?)}\]]+$/, ""));
          const stepFiles: Array<{ path: string; name: string; size: number }> = [];
          for (const p of detected) {
            try {
              const s = await stat(p);
              if (s.isFile()) stepFiles.push({ path: p, name: p.split("/").pop() || p, size: s.size });
            } catch {
              // ignore
            }
          }
          allFiles.push(...stepFiles.map(f => f.path));
          send({
            stepIndex: i,
            status: "succeeded",
            output,
            filesCreated: stepFiles,
            title: step.title || step.step_title || `Step ${i + 1}`,
            instruction: instruction.slice(0, 500),
            agentId,
            skillKey: skillKey || null,
            modelOverride: modelOverride || null,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          send({
            stepIndex: i,
            status: "failed",
            error: msg,
            title: step.title || step.step_title || `Step ${i + 1}`,
            instruction: instruction.slice(0, 500),
            agentId,
            skillKey: skillKey || null,
            modelOverride: modelOverride || null,
          });
        }
      }

      send({ done: true, allFilesCreated: allFiles });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
