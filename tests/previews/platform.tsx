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
export const useModules = () => ({ ready: true, isEnabled: () => true });
export default function Link(props: ComponentProps<"a">) { return <a {...props} />; }
