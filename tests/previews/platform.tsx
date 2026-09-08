import { useSyncExternalStore, type ComponentProps } from "react";

// In-memory router so URL-synced state works inside the fixture preview.
const listeners = new Set<() => void>();
let search = new URLSearchParams(window.location.search);
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const apply = (href: string) => { search = new URL(href, window.location.origin).searchParams; notify(); };
const router = { replace: apply, push: apply };

export const useRouter = () => router;
export const usePathname = () => "/mobile-apps/fixture";
export const useSearchParams = () => useSyncExternalStore(subscribe, () => search, () => search);
// Module-level constant: returning a fresh object per render pushes consumer
// dependency arrays into an update loop and blanks the fixture page.
const modules = { ready: true, isEnabled: () => true };
export const useModules = () => modules;
// Next-only props must not reach the DOM, or React logs an attribute warning.
export default function Link({ prefetch, replace, scroll, shallow, ...props }: ComponentProps<"a"> & Record<string, unknown>) {
  void prefetch; void replace; void scroll; void shallow;
  return <a {...props} />;
}
