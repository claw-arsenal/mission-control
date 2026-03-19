import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { assertSupabaseConfig } from "@/lib/supabase/config";

export async function getServerSupabaseClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = assertSupabaseConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // No-op in read-only server contexts.
        }
      },
    },
  });
}
