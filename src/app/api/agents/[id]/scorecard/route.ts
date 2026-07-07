import { getAgentScorecard } from "@/lib/db";

export const dynamic = "force-dynamic";

// Next 15 passes route params as a Promise — await before use.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = getAgentScorecard(id);
  if (!result) {
    return Response.json(
      { error: "agent_not_found", id },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
