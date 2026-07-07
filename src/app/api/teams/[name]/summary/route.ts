import { getTeamSummary } from "@/lib/db";

export const dynamic = "force-dynamic";

// Team names arrive URL-encoded (e.g. "West%20Coast"); Next decodes params for us.
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const result = getTeamSummary(name);
  if (!result) {
    return Response.json(
      { error: "team_not_found", name },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
