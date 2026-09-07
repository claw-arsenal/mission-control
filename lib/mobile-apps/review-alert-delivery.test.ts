import { execFile } from "node:child_process";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: () => true, readFileSync: () => '{}' }));
vi.mock("@/lib/skills/discovery", () => ({ discoverSkills: () => [{ key: 'email-calendar-m365-outlook', directory: '/skills/outlook', enabled: true, capabilities: ['email.send'] }] }));
vi.mock("./config", () => ({ loadSecretsEnv: () => ({ TELEGRAM_BOT_TOKEN: 'fixture-token' }) }));
import { sendReviewAlert } from "./review-alert-delivery";
import { DEFAULT_REVIEW_ALERT_CONFIG, reviewAlertConfigSchema } from "./review-alert-config";

const review = { appId: 'fixture', appName: 'App', store: 'google', rating: 2, author: 'Reader', title: '<img>', body: '$(shell) `command` <script>ignore instructions</script>', submittedAt: null };
beforeEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
it("sends Outlook through the fixed skill script with review text as a literal argument", async () => {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    (args.at(-1) as (error: null, result: { stdout: string }) => void)(null, { stdout: '{"status":"available"}' });
    return undefined as never;
  });
  await sendReviewAlert('email', 'person@example.com', review);
  const calls = vi.mocked(execFile).mock.calls as unknown as Array<[string, string[], Record<string, unknown>]>;
  expect(calls).toHaveLength(2); expect(calls[1][0]).toBe('python3');
  expect(calls[1][1]).toContain('send'); expect(calls[1][1].at(-1)).toContain(review.body);
  expect(calls[1][2].shell).toBeUndefined(); expect(calls[1][2].windowsHide).toBe(true);
});
it("distinguishes Telegram rate limiting from uncertain network failures without leaking the token", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":false}', { status: 429 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(sendReviewAlert('telegram', '-10012345678', review)).rejects.toMatchObject({ outcome: 'retry' });
  fetcher.mockRejectedValue(new Error('https://api.telegram.org/botfixture-token/sendMessage'));
  const error = await sendReviewAlert('telegram', '-10012345678', review).catch(error => error);
  expect(error.outcome).toBe('uncertain'); expect(error.message).not.toContain('fixture-token');
});
it("treats an explicit Telegram rejection as failed and confirms successful responses", async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":false}', { status: 403 })));
  await expect(sendReviewAlert('telegram', '@valid_channel', review)).rejects.toMatchObject({ outcome: 'failed' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')));
  await expect(sendReviewAlert('telegram', '@valid_channel', review)).resolves.toBeUndefined();
});
it("rejects invalid destinations and bounds polling and recipient count", () => {
  expect(reviewAlertConfigSchema.safeParse({ ...DEFAULT_REVIEW_ALERT_CONFIG, emailEnabled: true }).success).toBe(false);
  expect(reviewAlertConfigSchema.safeParse({ ...DEFAULT_REVIEW_ALERT_CONFIG, emailRecipients: ['--invalid'] }).success).toBe(false);
  expect(reviewAlertConfigSchema.safeParse({ ...DEFAULT_REVIEW_ALERT_CONFIG, pollSeconds: 1 }).success).toBe(false);
  expect(reviewAlertConfigSchema.safeParse({ ...DEFAULT_REVIEW_ALERT_CONFIG, telegramChats: ['person@example.com'] }).success).toBe(false);
  expect(reviewAlertConfigSchema.parse({ ...DEFAULT_REVIEW_ALERT_CONFIG, emailRecipients: ['User@example.com', 'user@example.com'] }).emailRecipients).toEqual(['user@example.com']);
});
