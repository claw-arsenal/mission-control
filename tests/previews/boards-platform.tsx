import { useSyncExternalStore } from "react";
import type { ComponentProps } from "react";

// In-memory router so the ?board= URL state works inside the fixture preview.
const listeners = new Set<() => void>();
let search = new URLSearchParams(window.location.search);
const notify = () => listeners.forEach((l) => l());

export const useRouter = () => ({
  replace: (href: string) => { search = new URL(href, window.location.origin).searchParams; notify(); },
  push: (href: string) => { search = new URL(href, window.location.origin).searchParams; notify(); },
  refresh: () => {},
});
export const usePathname = () => "/boards";
export const useSearchParams = () =>
  useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => search, () => search);

export default function Link({ href, prefetch, ...props }: ComponentProps<"a"> & { href?: string; prefetch?: boolean }) {
  void prefetch;
  return <a href={typeof href === "string" ? href : "#"} {...props} />;
}

// Stable identities: hooks that return a fresh object each render can drive
// dependency arrays in consumers into a loop, which would be a fixture artifact.
const MODULES = { ready: true, error: null, isEnabled: () => true, reload: async () => {} };
export const useModules = () => MODULES;
export const ModulesProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

const AUTH = {
  user: { name: "Sam Rivera", email: "sam@example.com", avatar: "" },
  loading: false,
  signOut: async () => {},
  refresh: async () => {},
};
export const useAuth = () => AUTH;
