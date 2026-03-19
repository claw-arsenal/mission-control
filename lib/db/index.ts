import type { TaskDataAdapter } from "@/lib/db/adapter";
import { createSupabaseAdapter } from "@/lib/db/supabase-adapter";

let adapter: TaskDataAdapter | null = null;

export function getDataAdapter(): TaskDataAdapter {
  if (!adapter) {
    adapter = createSupabaseAdapter();
  }
  return adapter;
}
