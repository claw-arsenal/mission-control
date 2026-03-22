import type { TaskDataAdapter } from "@/lib/db/adapter";

const adapter: TaskDataAdapter | null = null;

export function getDataAdapter(): TaskDataAdapter {
  return adapter as TaskDataAdapter;
}
