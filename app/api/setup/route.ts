import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SetupPayload = {
  setupCompleted?: boolean;
  bridgeEmail?: string;
};

async function getContext() {
  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  if (!user) {
    return { supabase, user: null, workspaceId: "" };
  }

  const { data: configuredRows, error: configuredError } = await supabase
    .from("user_workspace_settings")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("setup_completed", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (configuredError) {
    throw new Error(configuredError.message);
  }

  const configuredWorkspaceId = configuredRows?.[0]?.workspace_id as string | undefined;
  if (configuredWorkspaceId) {
    return {
      supabase,
      user,
      workspaceId: configuredWorkspaceId,
    };
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .order("workspace_id", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  return {
    supabase,
    user,
    workspaceId: (memberships?.[0]?.workspace_id as string | undefined) ?? "",
  };
}

export async function GET() {
  try {
    const { supabase, user, workspaceId } = await getContext();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("user_workspace_settings")
      .select("setup_completed, settings")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      setupCompleted: data?.setup_completed === true,
      settings: (data?.settings as Record<string, unknown> | null) ?? {},
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load setup." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user, workspaceId } = await getContext();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!workspaceId) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const payload = ((await request.json().catch(() => ({}))) ?? {}) as SetupPayload;

    const bridgeEmail = String(payload.bridgeEmail || "").trim();
    if (bridgeEmail && !emailPattern.test(bridgeEmail)) {
      return NextResponse.json({ error: "Bridge email is invalid." }, { status: 400 });
    }

    const settings = {
      bridgeEmail,
    };

    const { error } = await supabase.from("user_workspace_settings").upsert(
      {
        workspace_id: workspaceId,
        user_id: user.id,
        setup_completed: payload.setupCompleted === true,
        settings,
      },
      { onConflict: "workspace_id,user_id" },
    );

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save setup." },
      { status: 500 },
    );
  }
}
