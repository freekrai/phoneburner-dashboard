import { getWeeklyDigest } from "@/lib/db";

export const dynamic = "force-dynamic";

// RFC-4180 CSV escaping: wrap in quotes and double any embedded quotes.
// Team names contain spaces ("West Coast") and could contain commas.
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Same daily data as /api/weekly-digest, flattened for Google Sheets. Each row
// also carries that day's single strongest team and its connect count.
export function GET() {
  const { data } = getWeeklyDigest();
  const header = ["date", "connected_count", "total_count", "top_team", "top_team_connects"];
  const lines = [header.join(",")];

  for (const day of data) {
    let topTeam = "";
    let topConnects = 0;
    for (const [team, connects] of Object.entries(day.by_team)) {
      if (connects > topConnects) {
        topTeam = team;
        topConnects = connects;
      }
    }
    lines.push(
      [day.date, day.connected_count, day.total_count, topTeam, topConnects]
        .map(csvCell)
        .join(","),
    );
  }

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv",
      "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="weekly-digest.csv"',
    },
  });
}
