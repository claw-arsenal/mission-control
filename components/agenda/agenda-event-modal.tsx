"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  IconX,
  IconMicrophone,
  IconRobot,
  IconCalendarTime,
  IconCalendarPlus,
  IconRepeat,
  IconCalendarEvent,
  IconChevronRight,
  IconChevronLeft,
  IconCheck,
  IconStack2,
  IconCpu,
} from "@tabler/icons-react";

// ── Types ────────────────────────────────────────────────────────────────────

type RecurrenceType = "none" | "daily" | "weekly" | "monthly";
type TaskType = "one_time" | "repeatable";
type StartDateMode = "now" | "specific";
type EndDateMode = "forever" | "specific";
type Frequency = "daily" | "weekly";

export type AgendaEventFormData = {
  title: string;
  freePrompt: string;
  agentId: string;
  processVersionIds: string[];
  status: "draft" | "active";
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  recurrence: RecurrenceType;
  weekdays: string[];
  recurrenceUntil: string;
  editOccurrenceId?: string;
  editScope?: "single" | "this_and_future";
  taskType: TaskType;
  modelOverride: string;
  startDateMode: StartDateMode;
  endDateMode: EndDateMode;
  frequency: Frequency;
};

type AgentOption = { id: string; name: string };
type ProcessOption = { id: string; name: string; version_number: number };

type Props = {
  open: boolean;
  agents?: AgentOption[];
  processes?: ProcessOption[];
  initialData?: Partial<AgendaEventFormData>;
  onClose: () => void;
  onSave: (data: AgendaEventFormData) => void;
};

// ── Constants ────────────────────────────────────────────────────────────────

const EMPTY_AGENTS: AgentOption[] = [];
const EMPTY_PROCESSES: ProcessOption[] = [];

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

const TIMEZONES = [
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam (CET)" },
  { value: "Europe/London", label: "Europe/London (GMT)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET)" },
  { value: "America/New_York", label: "America/New_York (EST)" },
  { value: "America/Chicago", label: "America/Chicago (CST)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PST)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST)" },
  { value: "UTC", label: "UTC" },
];

const WEEKDAYS = [
  { value: "1", label: "Mon" },
  { value: "2", label: "Tue" },
  { value: "3", label: "Wed" },
  { value: "4", label: "Thu" },
  { value: "5", label: "Fri" },
  { value: "6", label: "Sat" },
  { value: "0", label: "Sun" },
];

const STEPS = [
  { key: "type", label: "Type", icon: IconCalendarEvent },
  { key: "details", label: "Details", icon: IconMicrophone },
  { key: "schedule", label: "Schedule", icon: IconCalendarTime },
  { key: "review", label: "Review", icon: IconCheck },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const defaultForm: AgendaEventFormData = {
  title: "",
  freePrompt: "",
  agentId: "",
  processVersionIds: [],
  status: "draft",
  startDate: "",
  startTime: "10:00",
  endDate: "",
  endTime: "",
  timezone: "Europe/Amsterdam",
  recurrence: "none",
  weekdays: [],
  recurrenceUntil: "",
  taskType: "one_time",
  modelOverride: "",
  startDateMode: "now",
  endDateMode: "forever",
  frequency: "daily",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseRecurrence(recurrenceRule: string | null): { type: RecurrenceType; weekdays: string[] } {
  if (!recurrenceRule || recurrenceRule === "none") return { type: "none", weekdays: [] };
  const bydayMatch = recurrenceRule.match(/BYDAY=([^;]+)/);
  if (bydayMatch) {
    const dayMap: Record<string, string> = { SU: "0", MO: "1", TU: "2", WE: "3", TH: "4", FR: "5", SA: "6" };
    const days = bydayMatch[1].split(",").map((d) => dayMap[d] ?? d);
    return { type: "weekly", weekdays: days };
  }
  if (recurrenceRule.includes("FREQ=DAILY")) return { type: "daily", weekdays: [] };
  if (recurrenceRule.includes("FREQ=WEEKLY")) return { type: "weekly", weekdays: [] };
  if (recurrenceRule.includes("FREQ=MONTHLY")) return { type: "monthly", weekdays: [] };
  return { type: "none", weekdays: [] };
}

function buildInitialForm(data: Partial<AgendaEventFormData>): AgendaEventFormData {
  const validTypes: RecurrenceType[] = ["none", "daily", "weekly", "monthly"];
  const isValidType = validTypes.includes(data.recurrence as RecurrenceType);

  const parsed = isValidType
    ? { type: data.recurrence as RecurrenceType, weekdays: data.weekdays ?? [] }
    : parseRecurrence(data.recurrence as unknown as string | null);

  let taskType: TaskType = data.taskType ?? "one_time";
  let frequency: Frequency = data.frequency ?? "daily";
  if (!data.taskType) {
    if (parsed.type === "daily" || parsed.type === "weekly") {
      taskType = "repeatable";
      frequency = parsed.type;
    } else {
      taskType = "one_time";
    }
  }

  const startDateMode: StartDateMode = data.startDateMode ?? (data.startDate ? "specific" : "now");
  const endDateMode: EndDateMode = data.endDateMode ?? (data.endDate ? "specific" : "forever");

  return {
    ...defaultForm,
    ...data,
    recurrence: parsed.type,
    weekdays: parsed.weekdays,
    recurrenceUntil: data.recurrenceUntil ?? "",
    taskType,
    frequency,
    modelOverride: data.modelOverride ?? "",
    startDateMode,
    endDateMode,
  };
}

// ── Step indicator (floating cards) ─────────────────────────────────────────

function StepIndicator({ currentStep, onStepClick }: { currentStep: number; onStepClick: (i: number) => void }) {
  return (
    <div className="flex gap-1.5 w-full">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        return (
          <button
            key={step.key}
            type="button"
            onClick={() => onStepClick(i)}
            className={[
              "flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer border",
              isActive
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : isDone
                  ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/60",
            ].join(" ")}
          >
            <div className={[
              "flex items-center justify-center size-6 rounded-full text-[10px] font-bold shrink-0",
              isActive
                ? "bg-primary-foreground/20 text-primary-foreground"
                : isDone
                  ? "bg-primary/20 text-primary"
                  : "bg-muted-foreground/15 text-muted-foreground",
            ].join(" ")}>
              {isDone ? <IconCheck className="size-3" /> : i + 1}
            </div>
            <div className="flex flex-col items-start min-w-0">
              <span className="text-[11px] font-semibold leading-tight truncate">{step.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function AgendaEventModal({ open, agents = EMPTY_AGENTS, processes = EMPTY_PROCESSES, initialData, onClose, onSave }: Props) {
  const isEditing = !!initialData?.title;
  const [form, setForm] = useState<AgendaEventFormData>(initialData ? buildInitialForm(initialData) : defaultForm);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);

  const initialDataRef = useRef(initialData);
  useEffect(() => {
    if (open) {
      initialDataRef.current = initialData;
    }
  }, [open, initialData]);

  useEffect(() => {
    if (open) {
      const data = initialDataRef.current;
      setForm(data ? buildInitialForm(data) : defaultForm);
      setError("");
      // When editing, skip to details step since type is already set
      setStep(isEditing ? 1 : 0);
    }
  }, [open]);

  const updateField = <K extends keyof AgendaEventFormData>(key: K, value: AgendaEventFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError("");
  };

  const toggleWeekday = (day: string) => {
    const current = form.weekdays;
    updateField(
      "weekdays",
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    );
  };

  const removeProcess = (pid: string) => {
    updateField("processVersionIds", form.processVersionIds.filter((id) => id !== pid));
  };

  // ── Validation per step ────────────────────────────────────────────────────

  const validateStep = (s: number): string | null => {
    if (s === 1) {
      if (!form.title.trim()) return "Title is required";
      if (!form.freePrompt.trim() && form.processVersionIds.length === 0) {
        return "A free prompt or at least one process is required";
      }
    }
    if (s === 2) {
      if (form.taskType === "one_time" && !form.startDate) return "Date is required for one-time events";
      if (form.taskType === "repeatable" && form.startDateMode === "specific" && !form.startDate) return "Start date is required";
      if (form.taskType === "repeatable" && form.endDateMode === "specific" && !form.endDate) return "End date is required";
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    setError("");
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setError("");
    setStep((s) => Math.max(s - 1, 0));
  };

  const goToStep = (i: number) => {
    // Only allow going backward or to current step freely
    if (i <= step) {
      setError("");
      setStep(i);
      return;
    }
    // Going forward — validate all intermediate steps
    for (let s = step; s < i; s++) {
      const err = validateStep(s);
      if (err) { setError(err); return; }
    }
    setError("");
    setStep(i);
  };

  const handleSave = () => {
    const err = validateStep(1) || validateStep(2);
    if (err) { setError(err); return; }

    let derivedRecurrence: RecurrenceType = "none";
    if (form.taskType === "repeatable") {
      derivedRecurrence = form.frequency;
    }

    const saveData: AgendaEventFormData = {
      ...form,
      recurrence: derivedRecurrence,
      startDate: form.startDateMode === "now" && form.taskType === "repeatable" ? "" : form.startDate,
      endDate: form.endDateMode === "forever" ? "" : form.endDate,
    };

    onSave(saveData);
    setForm(defaultForm);
    setError("");
    setStep(0);
  };

  const handleClose = () => {
    setForm(defaultForm);
    setError("");
    setStep(0);
    onClose();
  };

  // ── Step renderers ─────────────────────────────────────────────────────────

  const renderTypeStep = () => (
    <div className="flex flex-col gap-4">
      <div className="text-center mb-2">
        <h3 className="text-base font-bold text-foreground">What kind of task is this?</h3>
        <p className="text-xs text-muted-foreground mt-1">Choose how this event should run</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => { updateField("taskType", "one_time"); goNext(); }}
          className={[
            "group relative flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all duration-200 cursor-pointer",
            form.taskType === "one_time"
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border hover:border-primary/40 hover:bg-muted/40",
          ].join(" ")}
        >
          <div className={[
            "flex items-center justify-center size-14 rounded-xl transition-colors",
            form.taskType === "one_time" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
          ].join(" ")}>
            <IconCalendarEvent className="size-7" />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold">One-time</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Runs once on a specific date</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => { updateField("taskType", "repeatable"); goNext(); }}
          className={[
            "group relative flex flex-col items-center gap-3 rounded-xl border-2 p-6 transition-all duration-200 cursor-pointer",
            form.taskType === "repeatable"
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border hover:border-primary/40 hover:bg-muted/40",
          ].join(" ")}
        >
          <div className={[
            "flex items-center justify-center size-14 rounded-xl transition-colors",
            form.taskType === "repeatable" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
          ].join(" ")}>
            <IconRepeat className="size-7" />
          </div>
          <div className="text-center">
            <p className="text-sm font-bold">Repeatable</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Runs daily or weekly on a schedule</p>
          </div>
        </button>
      </div>
    </div>
  );

  const renderDetailsStep = () => (
    <div className="flex flex-col gap-4">
      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ae-title" className="text-xs font-semibold text-foreground/80">
          Title <span className="text-destructive ml-0.5">*</span>
        </Label>
        <Input
          id="ae-title"
          placeholder="e.g. Morning briefing"
          value={form.title}
          onChange={(e) => updateField("title", e.target.value)}
          className="h-10"
          autoFocus
        />
      </div>

      {/* Free prompt */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ae-prompt" className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
          <IconMicrophone className="size-3.5 text-primary" />
          Free prompt
        </Label>
        <Textarea
          id="ae-prompt"
          placeholder="Give the agent a free-text instruction..."
          value={form.freePrompt}
          onChange={(e) => updateField("freePrompt", e.target.value)}
          rows={3}
          className="resize-none"
        />
      </div>

      {/* Attached processes */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
          <IconStack2 className="size-3.5 text-primary" />
          Attached processes
        </Label>

        {form.processVersionIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.processVersionIds.map((pid) => {
              const proc = processes.find((p) => p.id === pid);
              return (
                <Badge
                  key={pid}
                  variant="secondary"
                  className="gap-1.5 pl-2.5 pr-1.5 py-1 text-xs font-semibold"
                >
                  {proc ? `${proc.name}${proc.version_number ? ` v${proc.version_number}` : ""}` : pid}
                  <button
                    type="button"
                    onClick={() => removeProcess(pid)}
                    className="ml-0.5 cursor-pointer hover:text-destructive rounded-sm transition-colors"
                  >
                    <IconX className="size-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        )}

        <Select
          onValueChange={(v) => {
            if (v && !form.processVersionIds.includes(v)) {
              updateField("processVersionIds", [...form.processVersionIds, v]);
            }
          }}
        >
          <SelectTrigger className="h-10 w-full cursor-pointer">
            <SelectValue placeholder="Attach a process..." />
          </SelectTrigger>
          <SelectContent>
            {processes.filter((p) => !form.processVersionIds.includes(p.id)).length === 0 ? (
              <SelectItem value="__empty__" disabled>
                {processes.length === 0 ? "No processes available" : "All processes attached"}
              </SelectItem>
            ) : (
              processes
                .filter((p) => !form.processVersionIds.includes(p.id))
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{p.version_number ? ` (v${p.version_number})` : ""}
                  </SelectItem>
                ))
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Agent + Model — 50/50 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
            <IconRobot className="size-3.5 text-primary" />
            Agent
          </Label>
          <Select value={form.agentId || "__none__"} onValueChange={(v) => {
            updateField("agentId", v === "__none__" ? "" : v);
            if (v === "__none__") updateField("modelOverride", "");
          }}>
            <SelectTrigger className="h-10 w-full cursor-pointer">
              <SelectValue placeholder="System default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">System default</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name || a.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5 min-w-0">
          <Label className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
            <IconCpu className="size-3.5 text-primary" />
            Model override
          </Label>
          <Select
            value={form.modelOverride || "__default__"}
            onValueChange={(v) => updateField("modelOverride", v === "__default__" ? "" : v)}
          >
            <SelectTrigger className="h-10 w-full cursor-pointer">
              <SelectValue placeholder="Agent default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">Agent default</SelectItem>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.alias}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Status — full width */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-semibold text-foreground/80">Status</Label>
        <Select value={form.status} onValueChange={(v) => updateField("status", v as "draft" | "active")}>
          <SelectTrigger className="h-10 w-full cursor-pointer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const renderScheduleStep = () => (
    <div className="flex flex-col gap-4">
      {/* ── One-time: just date + time ─────────────────────────────── */}
      {form.taskType === "one_time" && (
        <>
          <div className="text-center mb-1">
            <h3 className="text-base font-bold text-foreground">When should it run?</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Pick the date and time for this one-time task</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ae-ot-date" className="text-xs font-semibold text-foreground/80">
                Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ae-ot-date"
                type="date"
                value={form.startDate}
                onChange={(e) => updateField("startDate", e.target.value)}
                className="h-10"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ae-ot-time" className="text-xs font-semibold text-foreground/80">
                Time
              </Label>
              <Input
                id="ae-ot-time"
                type="time"
                value={form.startTime}
                onChange={(e) => updateField("startTime", e.target.value)}
                className="h-10"
              />
            </div>
          </div>
        </>
      )}

      {/* ── Repeatable: frequency, time, start/end ─────────────────── */}
      {form.taskType === "repeatable" && (
        <>
          <div className="text-center mb-1">
            <h3 className="text-base font-bold text-foreground">Set the schedule</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Configure frequency, timing, and duration</p>
          </div>

          {/* Frequency + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 min-w-0">
              <Label className="text-xs font-semibold text-foreground/80">Frequency</Label>
              <Select value={form.frequency} onValueChange={(v) => updateField("frequency", v as Frequency)}>
                <SelectTrigger className="h-10 w-full cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ae-rep-time" className="text-xs font-semibold text-foreground/80">
                Time
              </Label>
              <Input
                id="ae-rep-time"
                type="time"
                value={form.startTime}
                onChange={(e) => updateField("startTime", e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          {/* Weekly: weekday toggle */}
          {form.frequency === "weekly" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-foreground/80">Days</Label>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((day) => (
                  <Button
                    key={day.value}
                    size="sm"
                    variant={form.weekdays.includes(day.value) ? "default" : "outline"}
                    onClick={() => toggleWeekday(day.value)}
                    className="h-9 text-xs font-semibold cursor-pointer w-full"
                  >
                    {day.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Start date: Now or specific */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-foreground/80">Starts</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                variant={form.startDateMode === "now" ? "default" : "outline"}
                onClick={() => { updateField("startDateMode", "now"); updateField("startDate", ""); }}
                className="h-9 cursor-pointer w-full"
              >
                Now
              </Button>
              <Button
                size="sm"
                variant={form.startDateMode === "specific" ? "default" : "outline"}
                onClick={() => updateField("startDateMode", "specific")}
                className="h-9 cursor-pointer w-full"
              >
                Specific date
              </Button>
            </div>
            {form.startDateMode === "specific" && (
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => updateField("startDate", e.target.value)}
                className="h-10"
              />
            )}
          </div>

          {/* End date: Forever or specific */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-foreground/80">Ends</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                variant={form.endDateMode === "forever" ? "default" : "outline"}
                onClick={() => { updateField("endDateMode", "forever"); updateField("endDate", ""); }}
                className="h-9 cursor-pointer w-full"
              >
                Forever
              </Button>
              <Button
                size="sm"
                variant={form.endDateMode === "specific" ? "default" : "outline"}
                onClick={() => updateField("endDateMode", "specific")}
                className="h-9 cursor-pointer w-full"
              >
                Specific date
              </Button>
            </div>
            {form.endDateMode === "specific" && (
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => updateField("endDate", e.target.value)}
                className="h-10"
              />
            )}
          </div>
        </>
      )}

      {/* Timezone — always full width */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ae-tz" className="text-xs font-semibold text-foreground/80">
          Timezone
        </Label>
        <Select value={form.timezone} onValueChange={(v) => updateField("timezone", v)}>
          <SelectTrigger id="ae-tz" className="h-10 w-full cursor-pointer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const renderReviewStep = () => {
    const agentName = form.agentId ? (agents.find((a) => a.id === form.agentId)?.name || form.agentId) : "System default";
    const modelName = form.modelOverride ? (MODELS.find((m) => m.id === form.modelOverride)?.alias || form.modelOverride) : "Agent default";
    const processNames = form.processVersionIds.map((pid) => {
      const proc = processes.find((p) => p.id === pid);
      return proc ? proc.name : pid;
    });
    const weekdayLabels = form.weekdays.map((v) => WEEKDAYS.find((w) => w.value === v)?.label ?? v).join(", ");

    return (
      <div className="flex flex-col gap-3">
        <div className="text-center mb-1">
          <h3 className="text-base font-bold text-foreground">Review & create</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Make sure everything looks right</p>
        </div>

        <div className="rounded-xl border bg-muted/20 divide-y">
          <ReviewRow label="Type" value={form.taskType === "one_time" ? "One-time" : "Repeatable"} />
          <ReviewRow label="Title" value={form.title} />
          {form.freePrompt && <ReviewRow label="Prompt" value={form.freePrompt} truncate />}
          {processNames.length > 0 && <ReviewRow label="Processes" value={processNames.join(", ")} />}
          <ReviewRow label="Agent" value={agentName} />
          {form.modelOverride && <ReviewRow label="Model" value={modelName} />}
          <ReviewRow label="Status" value={form.status === "draft" ? "Draft" : "Active"} />

          {form.taskType === "one_time" ? (
            <>
              <ReviewRow label="Date" value={form.startDate || "—"} />
              <ReviewRow label="Time" value={form.startTime || "—"} />
            </>
          ) : (
            <>
              <ReviewRow label="Frequency" value={form.frequency === "daily" ? "Daily" : "Weekly"} />
              {form.frequency === "weekly" && weekdayLabels && (
                <ReviewRow label="Days" value={weekdayLabels} />
              )}
              <ReviewRow label="Time" value={form.startTime || "—"} />
              <ReviewRow label="Starts" value={form.startDateMode === "now" ? "Immediately" : (form.startDate || "—")} />
              <ReviewRow label="Ends" value={form.endDateMode === "forever" ? "Runs forever" : (form.endDate || "—")} />
            </>
          )}

          <ReviewRow label="Timezone" value={form.timezone} />
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="sm:max-w-[600px] max-h-[92vh] overflow-y-auto p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-0">
          <div className="flex items-center gap-3 mb-1">
            <div className={[
              "flex items-center justify-center size-9 rounded-lg shrink-0",
              isEditing ? "bg-primary/10" : "bg-primary",
            ].join(" ")}>
              <IconCalendarPlus className={[
                "size-4.5",
                isEditing ? "text-primary" : "text-primary-foreground",
              ].join(" ")} />
            </div>
            <div>
              <DialogTitle className="text-lg">
                {isEditing ? "Edit event" : "New agenda event"}
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {isEditing
                  ? "Update the event. For recurring events you'll choose how to apply changes."
                  : "Schedule a task to run automatically — follow the steps below."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Step indicator */}
        <div className="px-6 pt-3">
          <StepIndicator currentStep={step} onStepClick={goToStep} />
        </div>

        {/* Step content */}
        <div className="px-6 py-4 min-h-[280px]">
          {step === 0 && renderTypeStep()}
          {step === 1 && renderDetailsStep()}
          {step === 2 && renderScheduleStep()}
          {step === 3 && renderReviewStep()}

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
              <Button variant="ghost" onClick={handleClose} className="cursor-pointer">
                Cancel
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={goNext} className="gap-1.5 cursor-pointer">
                  Next
                  <IconChevronRight className="size-3.5" />
                </Button>
              ) : (
                <Button onClick={handleSave} className="gap-1.5 cursor-pointer">
                  <IconCalendarPlus className="size-3.5" />
                  {isEditing ? "Save changes" : "Create event"}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Review row helper ────────────────────────────────────────────────────────

function ReviewRow({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className="text-xs font-semibold text-muted-foreground w-20 shrink-0 pt-0.5">{label}</span>
      <span className={["text-sm text-foreground flex-1", truncate ? "line-clamp-2" : ""].join(" ")}>
        {value}
      </span>
    </div>
  );
}
