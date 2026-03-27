"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ProcessSimulateModal } from "@/components/processes/process-simulate-modal";
import {
  IconGripVertical,
  IconTrash,
  IconPlus,
  IconStack2,
  IconRobot,
  IconCode,
  IconFileText,
  IconCheck,
  IconChevronRight,
  IconChevronLeft,
  IconCpu,
  IconListDetails,
  IconPlayerPlay,
} from "@tabler/icons-react";

// ── Types ────────────────────────────────────────────────────────────────────

export type ProcessStep = {
  id: string;
  title: string;
  instruction: string;
  skillKey: string;
  agentId: string;
  timeoutSeconds: number | null;
  modelOverride: string;
};

export type ProcessFormData = {
  name: string;
  description: string;
  versionLabel: string;
  steps: ProcessStep[];
  status: "draft" | "published";
};

type AgentOption = { id: string; name: string; model: string | null };
type SkillOption = { key: string; name: string; description: string };

type Props = {
  open: boolean;
  initialData?: Partial<ProcessFormData>;
  agents?: AgentOption[];
  skills?: SkillOption[];
  onClose: () => void;
  onSave: (data: ProcessFormData) => void | Promise<void>;
};

// ── Constants ────────────────────────────────────────────────────────────────

const MODELS = [
  { id: "anthropic/claude-opus-4-6", alias: "Claude Opus 4" },
  { id: "openrouter/deepseek/deepseek-chat-v3", alias: "deepseek3chat" },
  { id: "openrouter/auto", alias: "OpenRouter" },
  { id: "openrouter/deepseek/deepseek-v3.2", alias: "deepseek3.2" },
  { id: "openrouter/minimax/minimax-m2.5", alias: "Minimax2.5" },
  { id: "openrouter/minimax/minimax-m2.7", alias: "Minimax2.7" },
  { id: "openrouter/openai/gpt-5.4", alias: "gpt5.4" },
  { id: "openrouter/openai/gpt-oss-120b", alias: "gptoss120b" },
  { id: "openrouter/openai/gpt-oss-20b:nitro", alias: "gptoss20bnitro" },
  { id: "openrouter/google/gemini-3-flash-preview", alias: "gemini3flash" },
  { id: "openrouter/google/gemini-3.1-pro-preview", alias: "gemini3pro" },
  { id: "openrouter/openai/gpt-5.4-nano", alias: "gpt5.4-nano" },
  { id: "openrouter/openai/gpt-5.4-mini", alias: "gpt5.4-mini" },
  { id: "openrouter/stepfun/step-3.5-flash:free", alias: "Step Flash Free" },
  { id: "openrouter/mistralai/devstral-2512:free", alias: "Devstral Free" },
  { id: "openrouter/qwen/qwen3-coder:free", alias: "Qwen3 Coder" },
  { id: "openrouter/deepseek/deepseek-chat-v3:free", alias: "Deepseek Chat V3 Free" },
];

const WIZARD_STEPS = [
  { key: "info", label: "Info", icon: IconFileText },
  { key: "steps", label: "Steps", icon: IconListDetails },
  { key: "review", label: "Review", icon: IconCheck },
] as const;

const emptyStep = (): ProcessStep => ({
  id: crypto.randomUUID(),
  title: "",
  instruction: "",
  skillKey: "",
  agentId: "",
  timeoutSeconds: null,
  modelOverride: "",
});

const EMPTY_AGENTS: AgentOption[] = [];
const EMPTY_SKILLS: SkillOption[] = [];

const defaultForm: ProcessFormData = {
  name: "",
  description: "",
  versionLabel: "",
  steps: [emptyStep()],
  status: "published",
};

// ── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ currentStep, canAdvanceTo, onStepClick }: { currentStep: number; canAdvanceTo: number; onStepClick: (i: number) => void }) {
  return (
    <div className="flex gap-1.5 w-full">
      {WIZARD_STEPS.map((step, i) => {
        const Icon = step.icon;
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        const isLocked = i > canAdvanceTo;
        return (
          <button
            key={step.key}
            type="button"
            disabled={isLocked}
            onClick={() => { if (!isLocked) onStepClick(i); }}
            className={[
              "flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all duration-200 border",
              isLocked
                ? "bg-muted/20 text-muted-foreground/40 border-transparent cursor-not-allowed opacity-50"
                : isActive
                  ? "bg-primary text-primary-foreground border-primary shadow-sm cursor-pointer"
                  : isDone
                    ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 cursor-pointer"
                    : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/60 cursor-pointer",
            ].join(" ")}
          >
            <div className={[
              "flex items-center justify-center size-6 rounded-full text-[10px] font-bold shrink-0",
              isLocked
                ? "bg-muted-foreground/10 text-muted-foreground/40"
                : isActive
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : isDone
                    ? "bg-primary/20 text-primary"
                    : "bg-muted-foreground/15 text-muted-foreground",
            ].join(" ")}>
              {isDone ? <IconCheck className="size-3" /> : i + 1}
            </div>
            <span className="text-[11px] font-semibold leading-tight truncate">{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Review row ───────────────────────────────────────────────────────────────

function ReviewRow({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className="text-xs font-semibold text-muted-foreground w-24 shrink-0 pt-0.5">{label}</span>
      <span className={["text-sm text-foreground flex-1", truncate ? "line-clamp-2" : ""].join(" ")}>
        {value}
      </span>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function ProcessEditorModal({ open, initialData, agents = EMPTY_AGENTS, skills = EMPTY_SKILLS, onClose, onSave }: Props) {
  const [form, setForm] = useState<ProcessFormData>(defaultForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [simulateOpen, setSimulateOpen] = useState(false);

  const initialDataRef = useRef(initialData);
  useEffect(() => {
    if (open) initialDataRef.current = initialData;
  }, [open, initialData]);

  const isEditing = !!initialData?.name;

  useEffect(() => {
    if (open) {
      const data = initialDataRef.current;
      setForm({
        name: data?.name ?? "",
        description: data?.description ?? "",
        versionLabel: data?.versionLabel ?? "",
        steps: data?.steps?.map((s) => ({ ...s, id: s.id || crypto.randomUUID() })) ?? [emptyStep()],
        status: "published",
      });
      setError("");
      setStep(0);
      setDragIndex(null);
      setDragOverIndex(null);
    }
  }, [open]);

  // ── Validation ─────────────────────────────────────────────────────────────

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!form.name.trim()) return "Process name is required";
    }
    if (s === 1) {
      if (form.steps.length === 0) return "At least one step is required";
    }
    return null;
  };

  // Compute highest step the user can navigate to (all previous steps must be valid)
  const canAdvanceTo = (() => {
    for (let i = 0; i < WIZARD_STEPS.length; i++) {
      if (validateStep(i)) return i;
    }
    return WIZARD_STEPS.length - 1;
  })();

  const goNext = () => {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    setError("");
    setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  };

  const goBack = () => {
    setError("");
    setStep((s) => Math.max(s - 1, 0));
  };

  const goToStep = (i: number) => {
    if (i <= step) { setError(""); setStep(i); return; }
    for (let s = step; s < i; s++) {
      const err = validateStep(s);
      if (err) { setError(err); return; }
    }
    setError("");
    setStep(i);
  };

  const handleSave = async () => {
    const err = validateStep(0) || validateStep(1);
    if (err) { setError(err); return; }
    setSaving(true);
    try {
      await onSave({ ...form, status: "published" });
    } catch {
      // handled by parent
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setForm(defaultForm);
    setError("");
    setStep(0);
    onClose();
  };

  // ── Step helpers ───────────────────────────────────────────────────────────

  const updateStep2 = (index: number, patch: Partial<ProcessStep>) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  };

  const addStep = () => {
    setForm((prev) => ({ ...prev, steps: [...prev.steps, emptyStep()] }));
  };

  const deleteStep = (index: number) => {
    if (form.steps.length <= 1) return;
    setForm((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
  };

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback((index: number) => { setDragIndex(index); }, []);
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => { e.preventDefault(); setDragOverIndex(index); }, []);
  const handleDrop = useCallback((dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex) { setDragIndex(null); setDragOverIndex(null); return; }
    setForm((prev) => {
      const steps = [...prev.steps];
      const [moved] = steps.splice(dragIndex, 1);
      steps.splice(dropIndex, 0, moved);
      return { ...prev, steps };
    });
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex]);
  const handleDragEnd = useCallback(() => { setDragIndex(null); setDragOverIndex(null); }, []);

  // ── Step 1: Info ───────────────────────────────────────────────────────────

  const renderInfoStep = () => (
    <div className="flex flex-col gap-4">
      <div className="text-center mb-1">
        <h3 className="text-base font-bold text-foreground">Process info</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Name, describe, and version your process</p>
      </div>

      {/* Name — full width */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pe-name" className="text-xs font-semibold text-foreground/80">
          Name <span className="text-destructive ml-0.5">*</span>
        </Label>
        <Input
          id="pe-name"
          placeholder="e.g. Website health check"
          value={form.name}
          onChange={(e) => { setForm((prev) => ({ ...prev, name: e.target.value })); setError(""); }}
          className="h-10"
          autoFocus
        />
      </div>

      {/* Description — full width */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pe-desc" className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
          <IconFileText className="size-3.5 text-primary" />
          Description
        </Label>
        <Textarea
          id="pe-desc"
          placeholder="What does this process do?"
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          rows={3}
          className="resize-none"
        />
      </div>

      {/* Version label — full width */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pe-version-label" className="text-xs font-semibold text-foreground/80">
          Version label
        </Label>
        <Input
          id="pe-version-label"
          placeholder="e.g. v1.2 - added retry logic"
          value={form.versionLabel}
          onChange={(e) => setForm((prev) => ({ ...prev, versionLabel: e.target.value }))}
          className="h-10"
        />
      </div>
    </div>
  );

  // ── Step 2: Steps ──────────────────────────────────────────────────────────

  const renderStepsStep = () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-foreground">Build your steps</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Drag to reorder. Each step runs in sequence.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 text-xs cursor-pointer"
          onClick={addStep}
        >
          <IconPlus className="size-3" />
          Add Step
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {form.steps.map((s, index) => (
          <div
            key={s.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={() => handleDrop(index)}
            onDragEnd={handleDragEnd}
            className={[
              "group rounded-xl border bg-card transition-all duration-150",
              dragIndex === index ? "opacity-40 scale-[0.98]" : "",
              dragOverIndex === index && dragIndex !== index ? "ring-2 ring-primary/40 border-primary/40" : "",
            ].join(" ")}
          >
            {/* Step header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-muted/20 rounded-t-xl">
              <div className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                <IconGripVertical className="size-4" />
              </div>
              <Badge variant="outline" className="size-6 p-0 flex items-center justify-center text-[10px] font-bold tabular-nums shrink-0">
                {index + 1}
              </Badge>
              <Input
                placeholder="Step title"
                value={s.title}
                onChange={(e) => updateStep2(index, { title: e.target.value })}
                className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0 px-1 text-sm font-medium"
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 text-muted-foreground/40 hover:text-destructive cursor-pointer"
                onClick={() => deleteStep(index)}
                disabled={form.steps.length === 1}
              >
                <IconTrash className="size-3.5" />
              </Button>
            </div>

            {/* Step body */}
            <div className="px-3 py-3 flex flex-col gap-3">
              {/* Instruction — full width */}
              <Textarea
                placeholder="Instruction for this step..."
                value={s.instruction}
                onChange={(e) => updateStep2(index, { instruction: e.target.value })}
                rows={2}
                className="resize-none text-sm"
              />

              {/* Skill / Agent / Model — 33% each */}
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1 min-w-0">
                  <Label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                    <IconCode className="size-2.5" />
                    Skill
                  </Label>
                  <Select
                    value={s.skillKey || "__none__"}
                    onValueChange={(v) => updateStep2(index, { skillKey: v === "__none__" ? "" : v })}
                  >
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {skills.map((sk) => (
                        <SelectItem key={sk.key} value={sk.key}>{sk.name || sk.key}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1 min-w-0">
                  <Label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                    <IconRobot className="size-2.5" />
                    Agent
                  </Label>
                  <Select
                    value={s.agentId || "__default__"}
                    onValueChange={(v) => updateStep2(index, { agentId: v === "__default__" ? "" : v })}
                  >
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue placeholder="Default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">Default</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name || a.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1 min-w-0">
                  <Label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                    <IconCpu className="size-2.5" />
                    Model
                  </Label>
                  <Select
                    value={s.modelOverride || "__default__"}
                    onValueChange={(v) => updateStep2(index, { modelOverride: v === "__default__" ? "" : v })}
                  >
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue placeholder="Default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">Default</SelectItem>
                      {MODELS.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.alias}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add step bottom */}
      <Button
        variant="ghost"
        className="w-full border border-dashed border-border/60 hover:border-primary/40 hover:bg-primary/5 h-10 text-xs text-muted-foreground gap-1.5 cursor-pointer"
        onClick={addStep}
      >
        <IconPlus className="size-3.5" />
        Add another step
      </Button>
    </div>
  );

  // ── Step 3: Review ─────────────────────────────────────────────────────────

  const renderReviewStep = () => (
    <div className="flex flex-col gap-3">
      <div className="text-center mb-1">
        <h3 className="text-base font-bold text-foreground">Review & save</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Check everything before saving</p>
      </div>

      <div className="rounded-xl border bg-muted/20 divide-y">
        <ReviewRow label="Name" value={form.name} />
        {form.description && <ReviewRow label="Description" value={form.description} truncate />}
        {form.versionLabel && <ReviewRow label="Version" value={form.versionLabel} />}
        <ReviewRow label="Steps" value={`${form.steps.length} step${form.steps.length === 1 ? "" : "s"}`} />
      </div>

      {/* Simulate section */}
      {form.steps.length > 0 && (
        <div className="flex flex-col gap-3 p-4 border rounded-xl bg-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Simulate this process</p>
              <p className="text-xs text-muted-foreground">
                Run a test execution to preview agent responses and file outputs before saving.
              </p>
            </div>
            <Button
              size="sm"
              onClick={(e) => { e.preventDefault(); setSimulateOpen(true); }}
              className="gap-1.5 cursor-pointer shrink-0"
            >
              <IconPlayerPlay className="size-3.5" />
              Run Simulation
            </Button>
          </div>
        </div>
      )}

      {/* Step summary cards */}
      <div className="flex flex-col gap-2 mt-1">
        {form.steps.map((s, i) => {
          const agentName = s.agentId ? (agents.find((a) => a.id === s.agentId)?.name || s.agentId) : "Default";
          const skillName = s.skillKey ? (skills.find((sk) => sk.key === s.skillKey)?.name || s.skillKey) : "—";
          const modelName = s.modelOverride ? (MODELS.find((m) => m.id === s.modelOverride)?.alias || s.modelOverride) : "Default";
          return (
            <div key={s.id} className="rounded-lg border bg-card px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="size-5 p-0 flex items-center justify-center text-[9px] font-bold shrink-0">
                  {i + 1}
                </Badge>
                <span className="text-sm font-semibold truncate">{s.title || "Untitled step"}</span>
              </div>
              {s.instruction && (
                <p className="text-xs text-muted-foreground line-clamp-1 mb-1.5">{s.instruction}</p>
              )}
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                <span>Skill: {skillName}</span>
                <span>Agent: {agentName}</span>
                <span>Model: {modelName}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="sm:max-w-[640px] max-h-[92vh] overflow-y-auto p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-0">
          <div className="flex items-center gap-3 mb-1">
            <div className={[
              "flex items-center justify-center size-9 rounded-lg shrink-0",
              isEditing ? "bg-primary/10" : "bg-primary",
            ].join(" ")}>
              <IconStack2 className={[
                "size-4.5",
                isEditing ? "text-primary" : "text-primary-foreground",
              ].join(" ")} />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {isEditing ? "Edit process" : "New process"}
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {isEditing
                  ? "Update the process steps. Changes create a new version."
                  : "Build a reusable step-by-step blueprint — follow the steps below."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Step indicator */}
        <div className="px-6 pt-3">
          <StepIndicator currentStep={step} canAdvanceTo={canAdvanceTo} onStepClick={goToStep} />
        </div>

        {/* Step content */}
        <div className="px-6 py-4 min-h-[280px]">
          {step === 0 && renderInfoStep()}
          {step === 1 && renderStepsStep()}
          {step === 2 && renderReviewStep()}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs text-destructive mt-4">
              {error}
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <DialogFooter className="px-6 pb-6 pt-0">
          <div className="flex items-center justify-between w-full gap-2">
            <div>
              {step > 0 && (
                <Button variant="ghost" onClick={goBack} className="gap-1.5 cursor-pointer">
                  <IconChevronLeft className="size-3.5" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={handleClose} disabled={saving} className="cursor-pointer">
                Cancel
              </Button>
              {step < WIZARD_STEPS.length - 1 ? (
                <Button onClick={goNext} className="gap-1.5 cursor-pointer">
                  Next
                  <IconChevronRight className="size-3.5" />
                </Button>
              ) : (
                <Button onClick={handleSave} disabled={saving} className="gap-1.5 cursor-pointer">
                  {saving ? (
                    <>
                      <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" d="M12 2a10 10 0 0 1 10 10" />
                      </svg>
                      Saving...
                    </>
                  ) : (
                    <>
                      <IconStack2 className="size-3.5" />
                      {isEditing ? "Save changes" : "Create process"}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>

        <ProcessSimulateModal
          open={simulateOpen}
          processName={form.name}
          autoStart
          steps={form.steps.map((s) => ({
            title: s.title,
            instruction: s.instruction,
            skillKey: s.skillKey,
            agentId: s.agentId,
            modelOverride: s.modelOverride,
            timeoutSeconds: s.timeoutSeconds,
          }))}
          onClose={() => setSimulateOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
