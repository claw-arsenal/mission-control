// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-auth", () => ({ useAuth: vi.fn() }));
import { useAuth } from "@/hooks/use-auth";
import { ReviewNotificationsSection } from "./review-notifications-section";
import { DEFAULT_REVIEW_ALERT_CONFIG } from "@/lib/mobile-apps/review-alert-config";

const status = { ok: true, moduleEnabled: true,
  settings: { config: DEFAULT_REVIEW_ALERT_CONFIG, generation: 'original', heartbeat_at: null, last_checked_at: null, next_poll_at: new Date().toISOString(), last_error: null },
  channels: { email: { ready: true, message: 'Outlook connected' }, telegram: { ready: true, message: 'Telegram configured' } }, deliveries: [],
};
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(useAuth).mockReturnValue({ user: null, role: 'admin', loading: false });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(status))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("saves explicit destinations and preserves the settings revision", async () => {
  render(<ReviewNotificationsSection />);
  const input = await screen.findByLabelText('Email recipients');
  fireEvent.change(input, { target: { value: 'first@example.com; second@example.com' } });
  fireEvent.click(screen.getByRole('switch', { name: 'Outlook email' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save and enable alerts' }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(call => call[1]?.method === 'PUT')).toBe(true));
  const save = vi.mocked(fetch).mock.calls.find(call => call[1]?.method === 'PUT')!;
  expect(JSON.parse(String(save[1]?.body))).toMatchObject({ generation: 'original', config: { emailEnabled: true, emailRecipients: ['first@example.com', 'second@example.com'] } });
});
it("shows API failures while keeping the user's recipient input", async () => {
  render(<ReviewNotificationsSection />);
  fireEvent.change(await screen.findByLabelText('Email recipients'), { target: { value: 'saved-in-form@example.com' } });
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{"ok":false,"error":"Settings changed in another session."}', { status: 409 }));
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Settings changed in another session.');
  expect(screen.getByLabelText('Email recipients')).toHaveProperty('value', 'saved-in-form@example.com');
});
it("does not request private recipient settings for members", () => {
  vi.mocked(useAuth).mockReturnValue({ user: null, role: 'member', loading: false });
  render(<ReviewNotificationsSection />);
  expect(screen.getByText('An administrator can configure email and Telegram recipients.')).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
