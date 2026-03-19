import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

const protectedPrefixes = ["/dashboard", "/boards", "/agents", "/logs", "/settings", "/setup"];

export async function proxy(request: NextRequest) {
  const { url, anonKey, isConfigured } = getSupabaseConfig();
  if (!isConfigured) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtectedRoute = protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtectedRoute && !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!user) {
    return response;
  }

  const { data: configuredRows, error: configuredError } = await supabase
    .from("user_workspace_settings")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("setup_completed", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (configuredError) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let workspaceId = configuredRows?.[0]?.workspace_id as string | undefined;

  if (!workspaceId) {
    const { data: membershipRows, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .order("workspace_id", { ascending: true })
      .limit(1);

    if (membershipError) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    workspaceId = membershipRows?.[0]?.workspace_id as string | undefined;
  }
  const setupRequiredPrefixes = ["/dashboard", "/boards", "/agents", "/logs", "/settings"];
  const requiresSetup = setupRequiredPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (workspaceId) {
    const { data: setupRows, error: setupError } = await supabase
      .from("user_workspace_settings")
      .select("setup_completed")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .limit(1);

    if (setupError) {
      return NextResponse.redirect(new URL("/setup", request.url));
    }

    const setupCompleted = setupRows?.[0]?.setup_completed === true;

    if (requiresSetup && !setupCompleted) {
      return NextResponse.redirect(new URL("/setup", request.url));
    }

    if (pathname === "/setup" && setupCompleted) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/boards/:path*",
    "/agents/:path*",
    "/logs/:path*",
    "/settings/:path*",
    "/setup/:path*",
    "/login",
  ],
};
