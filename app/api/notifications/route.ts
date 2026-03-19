import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";

type NotificationPayload = {
  provider?: string;
  target?: string;
  enabled?: boolean;
  events?: string[];
};

async function getContext() {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);
  if (!user) return { supabase, user: null, workspaceId: "" };

  const { data: configuredRows, error: configuredError } = await supabase
    .from("user_workspace_settings")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("setup_completed", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (configuredError) throw new Error(configuredError.message);

  const workspaceId = (configuredRows?.[0]?.workspace_id as string | undefined) ?? "";
  return { supabase, user, workspaceId };
}

export async function GET() {
  try {
    const { supabase, user, workspaceId } = await getContext();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!workspaceId) return NextResponse.json({ channels: [] });

    const { data, error } = await supabase
      .from("notification_channels")
      .select("id,provider,target,enabled,events")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ channels: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load notification channels." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user, workspaceId } = await getContext();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!workspaceId) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });

    const payload = ((await request.json().catch(() => ({}))) ?? {}) as NotificationPayload;
    const provider = String(payload.provider || "telegram").trim().toLowerCase();
    const target = String(payload.target || "").trim();
    const enabled = payload.enabled === true;
    const events = Array.isArray(payload.events)
      ? payload.events.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    if (!target) {
      return NextResponse.json({ error: "Notification target is required." }, { status: 400 });
    }

    const { error } = await supabase.from("notification_channels").upsert(
      {
        workspace_id: workspaceId,
        user_id: user.id,
        provider,
        target,
        enabled,
        events,
      },
      { onConflict: "workspace_id,user_id,provider,target" },
    );

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save notification channel." },
      { status: 500 },
    );
  }
}
