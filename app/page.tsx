import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/auth/login-screen";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export default async function HomePage() {
  await cookies();
  const supabase = await getServerSupabaseClient();
  const { data } = await supabase.auth.getUser();

  if (data.user) {
    redirect("/dashboard");
  }

  return <LoginScreen />;
}
