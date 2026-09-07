import { createRoot } from "react-dom/client";
import { ModulesProvider } from "@/components/modules/modules-provider";
import { ModulesSection } from "@/components/settings/modules-section";
import { ReviewNotificationsSection } from "@/components/settings/review-notifications-section";
import { DEFAULT_REVIEW_ALERT_CONFIG } from "@/lib/mobile-apps/review-alert-config";
import { MODULES } from "@/lib/modules/registry";
import "@/app/globals.css";

let config = { ...DEFAULT_REVIEW_ALERT_CONFIG, emailRecipients: ['reviews@example.com'], telegramChats: ['-1001234567890'] };
let generation = crypto.randomUUID();
const modules = MODULES.map(def => ({ ...def, icon: undefined, enabled: true, active: true, available: true, reason: null as string | null }));
modules[4] = { ...modules[4], available: false, active: false, reason: 'Update the mission-control skill to support metrics.read.' };
window.fetch = async (input, options) => {
  const url = String(input);
  let data: unknown;
  if (url === '/api/auth/session') data = { ok: true, role: 'admin', user: { sub: 'fixture', name: 'Preview Admin', email: 'admin@example.com' } };
  else if (url === '/api/modules') {
    if (options?.method === 'POST') { const body = JSON.parse(String(options.body)); const mod = modules.find(mod => mod.id === body.moduleId); if (mod) mod.enabled = mod.active = body.action === 'enable'; }
    data = { ok: true, modules, enabledIds: modules.filter(mod => mod.enabled && mod.available).map(mod => mod.id) };
  } else if (url === '/api/mobile-apps/notifications') {
    if (options?.method === 'PUT') { config = JSON.parse(String(options.body)).config; generation = crypto.randomUUID(); }
    data = { ok: true, moduleEnabled: modules.find(mod => mod.id === 'mobile-apps')?.enabled,
      settings: { config, generation, heartbeat_at: new Date().toISOString(), last_checked_at: new Date().toISOString(), next_poll_at: new Date(Date.now() + 60_000).toISOString(), last_error: null },
      channels: { email: { ready: true, message: 'Outlook skill is authenticated.' }, telegram: { ready: true, message: 'Telegram bot token is configured. The bot needs access to each destination chat.' } },
      deliveries: [{ id: 'example', channel: 'email', recipient: 'reviews@example.com', status: 'sent', created_at: new Date().toISOString(), error: null }],
    };
  } else return new Response('{"ok":false}', { status: 404 });
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
};
createRoot(document.getElementById('root')!).render(<ModulesProvider><main className="mx-auto max-w-3xl px-5 py-10"><h1 className="mb-8 text-2xl font-semibold">Settings</h1><ModulesSection /><ReviewNotificationsSection /></main></ModulesProvider>);
