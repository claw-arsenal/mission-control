"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useModules } from "@/components/modules/modules-provider";
import { useAuth } from "@/hooks/use-auth";

export function ModulesSection() {
  const { modules, reload } = useModules();
  const { role } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function toggle(id: string, enabled: boolean) {
    setBusy(id); setError(null);
    try {
      const response = await fetch("/api/modules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ moduleId: id, action: enabled ? "disable" : "enable" }) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "Could not update module.");
      await reload();
      toast.success(enabled ? "Module disabled. Your data is preserved." : "Module enabled.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update module."); }
    finally { setBusy(null); }
  }
  return <section id="modules" className="space-y-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Modules</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">Installed skills unlock supported modules. Enable the ones you need in the sidebar. Disabling preserves your data and pauses background work.</p>
      </div>
      <Button variant="outline" onClick={() => void reload()}>Check skills</Button>
    </div>
    {role !== "admin" && <p className="text-sm text-muted-foreground">An administrator can change module settings.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {modules.length === 0 ? <p role="status" className="text-sm text-muted-foreground">Loading modules. If this persists, check the connection and try Check skills.</p> :
      <div className="divide-y rounded-xl border bg-card">{modules.map(mod => <div key={mod.id} className="flex items-start justify-between gap-5 p-4">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold">{mod.name} <span className="ml-2 text-xs font-normal text-muted-foreground">{mod.core ? "Core" : !mod.available ? "Skill required" : mod.enabled ? "Enabled" : "Disabled"}</span></h3>
          <p className="max-w-prose text-sm text-muted-foreground">{mod.description}</p>
          {mod.skill && <p className="text-xs text-muted-foreground">Skill: {mod.skill.key}</p>}
          {mod.reason && <p className="text-sm text-muted-foreground">{mod.reason}{mod.enabled ? " Your enabled preference is saved and resumes when the skill is available." : ""}</p>}
        </div>
        <Switch aria-label={`Enable ${mod.name}`} checked={mod.core || mod.enabled} disabled={mod.core || role !== "admin" || busy !== null || (!mod.available && !mod.enabled)} onCheckedChange={() => void toggle(mod.id, mod.enabled)} />
      </div>)}</div>}
  </section>;
}
