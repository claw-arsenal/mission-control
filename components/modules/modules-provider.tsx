"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ModuleSummary = {
  id: string;
  name: string;
  description: string;
  core: boolean;
  navUrl: string | null;
  navTitle: string | null;
  enabled: boolean;
  active: boolean;
  available: boolean;
  reason: string | null;
  skill: { key: string; capability: string } | null;
  enabledAt: string | null;
  disabledAt: string | null;
  enabledByName: string | null;
  disabledByName: string | null;
  updatedAt: string | null;
};

type ModulesState = {
  /**
   * True once a load has settled, whether it succeeded or failed. Consumers
   * gate on this, so a failed request must still flip it or they wait forever.
   */
  ready: boolean;
  modules: ModuleSummary[];
  enabledIds: Set<string>;
  /** Set when the last load failed, so consumers can show a reason and a retry. */
  error: string | null;
};

type Ctx = ModulesState & {
  isEnabled: (id: string) => boolean;
  reload: () => Promise<void>;
};

const ModulesContext = createContext<Ctx | null>(null);

export function ModulesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ModulesState>({
    ready: false,
    error: null,
    modules: [],
    // Optimistic default: assume everything is enabled until the GET resolves
    // (matches the seed behavior on first boot). Prevents UI flash during load.
    enabledIds: new Set(["kanban", "agenda", "processes", "system"]),
  });

  // We re-fetch when the window regains focus so a toggle in another tab
  // reflects without a manual refresh.
  const fetchingRef = useRef(false);

  const load = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await fetch("/api/modules", { cache: "reload" });
      if (!res.ok) throw new Error(`The module list request failed (${res.status}).`);
      const json = await res.json();
      if (!json.ok) throw new Error(typeof json.error === "string" ? json.error : "The module list could not be read.");
      const modules = (json.modules || []) as ModuleSummary[];
      const enabledIds = new Set<string>((json.enabledIds || []) as string[]);
      setState({ ready: true, modules, enabledIds, error: null });
    } catch (error) {
      // Keep the last successful snapshot, but never leave consumers waiting:
      // mark the load settled and report why it failed.
      setState((prev) => ({
        ...prev,
        ready: true,
        error: error instanceof Error ? error.message : "The module list could not be loaded.",
      }));
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const poll = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(poll); };
  }, [load]);

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      isEnabled: (id: string) => state.enabledIds.has(id),
      reload: load,
    }),
    [state, load],
  );

  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>;
}

export function useModules(): Ctx {
  const ctx = useContext(ModulesContext);
  if (!ctx) {
    // Defensive fallback so a component used outside the provider still works
    // (e.g. tests). Returns optimistic-all-enabled.
    return {
      ready: false,
      error: null,
      modules: [],
      enabledIds: new Set(["kanban", "agenda", "processes", "documents", "system"]),
      isEnabled: () => true,
      reload: async () => {},
    };
  }
  return ctx;
}
