import { NextResponse } from "next/server";
import { getSql } from "@/lib/local-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = getSql();
  const exists = await sql`select to_regclass('public.app_settings') as exists`;
  if (!exists[0]?.exists) {
    return NextResponse.json({ setupCompleted: false, settings: { gatewayToken: "" } });
  }
  const rows = await sql`select setup_completed, gateway_token from app_settings where id = 1 limit 1`;
  const row = rows[0] ?? { setup_completed: false, gateway_token: "" };
  return NextResponse.json({
    setupCompleted: Boolean(row.setup_completed),
    settings: { gatewayToken: String(row.gateway_token || "").trim() },
  });
}

export async function POST(request: Request) {
  const sql = getSql();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const gatewayToken = String(body.gatewayToken || "").trim();

  await sql`create table if not exists app_settings (id integer primary key default 1, gateway_token text not null default '', setup_completed boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), constraint app_settings_single_row check (id = 1))`;
  await sql`
    insert into app_settings (id, gateway_token, setup_completed)
    values (1, ${gatewayToken}, ${gatewayToken.length > 0})
    on conflict (id) do update
      set gateway_token = excluded.gateway_token,
          setup_completed = excluded.setup_completed,
          updated_at = now()
  `;

  const saved = await sql`select setup_completed, gateway_token from app_settings where id = 1 limit 1`;
  return NextResponse.json({ ok: true, saved: saved[0] ?? null });
}
