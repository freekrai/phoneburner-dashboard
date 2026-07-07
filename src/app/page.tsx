import Image from "next/image";
import { getConnectedLast7, getAgentTrends, type AgentTrend } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Always render live — Dana's numbers must never be cached/stale.
export const dynamic = "force-dynamic";

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

// Dana asked two questions: "are my agents getting better or worse" and "who do
// I talk to Monday". We answer both by ranking agents on week-over-week change.
//   - "Talk to on Monday" = biggest DROP in connects vs last week (needs help).
//   - "Improving" = biggest gains (worth recognising, or learning from).
export default function Page() {
  const connectedLast7 = getConnectedLast7();
  const trends = getAgentTrends();

  const active = trends.filter((t) => t.connected_last_7 > 0 || t.connected_prior_7 > 0);
  const needsAttention = [...active]
    .filter((t) => t.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 3);
  const improving = [...active]
    .filter((t) => t.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);

  const byConnects = [...trends].sort((a, b) => b.connected_last_7 - a.connected_last_7);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Header with ArmorHQ logo */}
      <header className="mb-8 flex items-center gap-3">
        <Image src="/logo.png" alt="ArmorHQ" width={36} height={36} className="rounded" priority />
        <div>
          <h1 className="text-lg font-semibold leading-tight sm:text-xl">Sales Floor</h1>
          <p className="text-xs text-muted sm:text-sm">Week-over-week, at a glance</p>
        </div>
      </header>

      {/* THE Monday-morning number — live-queried connected calls, last 7 days. */}
      <Card className="mb-8 border-indigo-500/30 bg-indigo-500/5">
        <CardContent className="p-6">
          <p className="text-sm text-muted">Connected calls · last 7 days</p>
          <p className="mt-1 font-mono text-5xl font-bold tabular-nums sm:text-6xl">
            {connectedLast7.toLocaleString()}
          </p>
          <p className="mt-2 text-xs text-muted">
            Real conversations across the floor. Live from the database.
          </p>
        </CardContent>
      </Card>

      {/* Who to talk to Monday */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-rose-400">Talk to these on Monday</CardTitle>
            <p className="text-xs text-muted">Biggest drop in connects vs the prior week</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {needsAttention.length === 0 && (
              <p className="text-sm text-muted">Nobody slipped this week. 🎉</p>
            )}
            {needsAttention.map((t) => (
              <AgentDelta key={t.id} t={t} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-emerald-400">Trending up</CardTitle>
            <p className="text-xs text-muted">Most improved vs the prior week</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {improving.length === 0 && (
              <p className="text-sm text-muted">No gainers this week.</p>
            )}
            {improving.map((t) => (
              <AgentDelta key={t.id} t={t} />
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Full roster — the detail behind the callouts. Scrolls fine at 375px. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Every agent · this week</CardTitle>
          <p className="text-xs text-muted">Sorted by connected calls, last 7 days</p>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-2 py-2 font-medium">Agent</th>
                  <th className="px-2 py-2 font-medium">Team</th>
                  <th className="px-2 py-2 text-right font-medium">Conn.</th>
                  <th className="px-2 py-2 text-right font-medium">Rate</th>
                  <th className="px-2 py-2 text-right font-medium">WoW</th>
                </tr>
              </thead>
              <tbody>
                {byConnects.map((t) => (
                  <tr key={t.id} className="border-b border-border/50">
                    <td className="px-2 py-2 font-medium">{t.name}</td>
                    <td className="px-2 py-2 text-muted">{t.team}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {t.connected_last_7}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-muted">
                      {pct(t.connect_rate_last_7)}
                    </td>
                    <td
                      className={`px-2 py-2 text-right font-mono tabular-nums ${
                        t.delta > 0
                          ? "text-emerald-400"
                          : t.delta < 0
                            ? "text-rose-400"
                            : "text-muted"
                      }`}
                    >
                      {t.delta > 0 ? "+" : ""}
                      {t.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function AgentDelta({ t }: { t: AgentTrend }) {
  const up = t.delta > 0;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{t.name}</p>
        <p className="text-xs text-muted">
          {t.team} · {t.connected_last_7} conn · {pct(t.connect_rate_last_7)} rate
        </p>
      </div>
      <span
        className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
          up ? "text-emerald-400" : "text-rose-400"
        }`}
      >
        {up ? "+" : ""}
        {t.delta}
      </span>
    </div>
  );
}
