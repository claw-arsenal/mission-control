import { z } from "zod";

export const reviewAlertConfigSchema = z.object({
  monitoring: z.boolean(),
  pollSeconds: z.number().int().min(60).max(3600),
  maxRating: z.number().int().min(1).max(5),
  emailEnabled: z.boolean(),
  emailRecipients: z.array(z.email().max(254).transform(value => value.toLowerCase())).max(25),
  telegramEnabled: z.boolean(),
  telegramChats: z.array(z.string().regex(/^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/, "Use a numeric chat ID or @channel username.")).max(25),
}).strict().superRefine((value, ctx) => {
  if (value.emailEnabled && !value.emailRecipients.length) ctx.addIssue({ code: "custom", path: ["emailRecipients"], message: "Add at least one email recipient." });
  if (value.telegramEnabled && !value.telegramChats.length) ctx.addIssue({ code: "custom", path: ["telegramChats"], message: "Add at least one Telegram chat." });
}).transform(value => ({ ...value, emailRecipients: [...new Set(value.emailRecipients)], telegramChats: [...new Set(value.telegramChats)] }));

export type ReviewAlertConfig = z.infer<typeof reviewAlertConfigSchema>;
export const DEFAULT_REVIEW_ALERT_CONFIG: ReviewAlertConfig = {
  monitoring: true, pollSeconds: 60, maxRating: 5,
  emailEnabled: false, emailRecipients: [], telegramEnabled: false, telegramChats: [],
};

export type ReviewAlertPayload = {
  appId: string; appName: string; store: string; rating: number | null;
  author: string | null; title: string | null; body: string | null; submittedAt: string | null;
};

export function formatReviewAlert(review: ReviewAlertPayload) {
  const store = review.store === "apple" ? "App Store" : "Google Play";
  const subject = `[Mission Control] ${review.appName.replace(/[\r\n]/g, " ").slice(0, 120)}: ${review.rating ?? "Unrated"}/5 review`;
  const body = [review.appName, `${store} · ${review.rating ?? "Unrated"}/5`, review.author ? `By ${review.author}` : "", review.submittedAt || "", review.title || "", review.body || "(No written comment)"]
    .filter(Boolean).join("\n\n");
  return { subject, body };
}
