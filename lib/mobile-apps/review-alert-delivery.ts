import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { discoverSkills } from "@/lib/skills/discovery";
import { loadSecretsEnv } from "./config";
import { formatReviewAlert, type ReviewAlertPayload } from "./review-alert-config";

const exec = promisify(execFile);
const OUTLOOK = "email-calendar-m365-outlook";
type Readiness = { ready: boolean; message: string };

export class DeliveryError extends Error {
  constructor(message: string, public outcome: "retry" | "failed" | "uncertain") { super(message); }
}

function outlookSkill() {
  return discoverSkills().find(skill => skill.key === OUTLOOK && skill.enabled && skill.capabilities.includes("email.send"));
}

function telegramToken() {
  const env = loadSecretsEnv();
  const explicit = env.MOBILE_REVIEW_TELEGRAM_BOT_TOKEN?.trim() || env.TELEGRAM_BOT_TOKEN?.trim();
  if (explicit) return explicit;
  try {
    const home = process.env.OPENCLAW_HOME || join(homedir(), ".openclaw");
    const raw = readFileSync(/*turbopackIgnore: true*/ process.env.OPENCLAW_CONFIG_PATH || join(home, "openclaw.json"), "utf8");
    const telegram = JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1"))?.channels?.telegram;
    if (telegram?.enabled === false) return null;
    if (typeof telegram?.botToken === "string" && !telegram.botToken.includes("${")) return telegram.botToken.trim() || null;
    if (typeof telegram?.tokenFile === "string") return readFileSync(/*turbopackIgnore: true*/ telegram.tokenFile.replace(/^~(?=$|[\\/])/, homedir()), "utf8").trim() || null;
  } catch { /* A dedicated token can be configured when OpenClaw has no default bot. */ }
  return null;
}

export async function outlookReadiness(): Promise<Readiness> {
  try {
    const skill = outlookSkill();
    if (!skill || !existsSync(/*turbopackIgnore: true*/ join(skill.directory, "scripts/mail.py"))) return { ready: false, message: `Install and enable ${OUTLOOK} with email.send support.` };
    const script = join(skill.directory, "scripts/status.py");
    let stdout = "";
    try { stdout = (await exec("python3", [script], { cwd: skill.directory, timeout: 15_000, maxBuffer: 128_000, windowsHide: true })).stdout; }
    catch (error) { stdout = String((error as { stdout?: string }).stdout || ""); }
    const status = JSON.parse(stdout).status;
    return status === "available" ? { ready: true, message: "Outlook skill is authenticated." }
      : { ready: false, message: `Outlook skill needs setup (${["needs_auth", "misconfigured", "disabled", "degraded", "adapter_missing"].includes(status) ? status : "not ready"}). Run its status.py and auth.py login on the server.` };
  } catch { return { ready: false, message: "Outlook readiness could not be checked. Verify python3 and the skill configuration on the server." }; }
}

export async function reviewChannelReadiness() {
  return { email: await outlookReadiness(), telegram: telegramToken()
    ? { ready: true, message: "Telegram bot token is configured. The bot needs access to each destination chat." }
    : { ready: false, message: "Configure the OpenClaw Telegram bot or TELEGRAM_BOT_TOKEN in server secrets.env." } };
}

export async function sendReviewAlert(channel: "email" | "telegram", recipient: string, review: ReviewAlertPayload) {
  const { subject, body } = formatReviewAlert(review);
  if (channel === "email") {
    const readiness = await outlookReadiness();
    if (!readiness.ready) throw new DeliveryError(readiness.message, "retry");
    const skill = outlookSkill();
    if (!skill) throw new DeliveryError("Outlook skill is no longer available.", "retry");
    try {
      // Fixed interpreter and argument vector: review text never becomes shell code or an agent prompt.
      await exec("python3", [join(skill.directory, "scripts/mail.py"), "send", "--to", recipient, "--subject", subject, "--body", body.slice(0, 20_000)], {
        cwd: skill.directory, timeout: 60_000, maxBuffer: 256_000, windowsHide: true,
      });
    } catch {
      throw new DeliveryError("Outlook send did not return a confirmed result. Check Sent Items before sending again.", "uncertain");
    }
    return;
  }
  const token = telegramToken();
  if (!token) throw new DeliveryError("Telegram bot is not configured.", "retry");
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: recipient, text: `${subject}\n\n${body}`.slice(0, 4000) }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new DeliveryError("Telegram send outcome is unknown. Check the chat before sending again.", "uncertain"); }
  let result: { ok?: boolean } = {};
  try { result = await response.json(); } catch { /* No confirmed provider result. */ }
  if (response.ok && result.ok === true) return;
  if (response.status === 429) throw new DeliveryError("Telegram rate limit reached; delivery will be retried.", "retry");
  if (response.status >= 400 && response.status < 500) throw new DeliveryError("Telegram rejected the destination or credentials. Check bot access and the chat ID.", "failed");
  throw new DeliveryError("Telegram did not confirm delivery. Check the chat before sending again.", "uncertain");
}
