import { NextResponse } from "next/server";
import { getCachedAgents, getCachedSessions, getAgentStatuses } from "@/lib/runtime/cache";

export async function GET() {
  try {
    const [registeredAgents] = await Promise.all([
      getCachedAgents(),
      getCachedSessions(), // ensures sessions cache is populated
    ]);

    // Derive status from session activity timestamps
    const agentStatuses = getAgentStatuses();

    const agents = registeredAgents.map((a) => {
      const runtime = agentStatuses[a.id];
      return {
        id: a.id,
        name: a.identityName || a.name || a.id,
        model: a.model ?? null,
        status: runtime?.status ?? "idle",
        lastHeartbeatAt: runtime?.lastHeartbeatAt ?? null,
        isDefault: a.isDefault ?? false,
      };
    });

    return NextResponse.json({ agents });
  } catch (err) {
    console.error("[/api/agents]", err);
    return NextResponse.json({ agents: [] });
  }
}
