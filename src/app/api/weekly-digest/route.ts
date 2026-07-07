import { getWeeklyDigest } from "@/lib/db";

// Live JSON digest: 28 days of activity + this week's top 3 agents.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getWeeklyDigest(), {
    headers: { "Cache-Control": "no-store" },
  });
}
