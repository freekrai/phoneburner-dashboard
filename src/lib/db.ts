// The sanctioned data path. All dashboard and API queries go through here.
//
// Backed by a local SQLite file (`data.db` at the project root). The seed
// script creates it; `pnpm dev` reads it. Both use the same `getDb()` handle
// below.
//
// Uses Node's built-in `node:sqlite` (stable in Node 22.5+) so there is no
// native compile step on `pnpm install`. Schema is documented in /schema.sql.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "data.db");

let _db: DatabaseSync | null = null;

/**
 * Returns a singleton SQLite handle. Lazy so that `import`-time side effects
 * don't open a file before the seed has had a chance to create it.
 *
 * Configured with WAL journaling and foreign-key enforcement, both of which
 * are off by default in SQLite and surprise people.
 */
export function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
  }
  return _db;
}

// ----- Row types -------------------------------------------------------------

export type AgentRow = {
  id: string;
  name: string;
  team: string;
  hire_date: string;
  created_at: string;
};

export type CallOutcome = "connected" | "voicemail" | "no_answer" | "busy" | "failed";

export type CallRow = {
  id: string;
  agent_id: string;
  customer_phone: string;
  started_at: string; // ISO 8601
  ended_at: string | null; // ISO 8601, null only for failed
  duration_seconds: number;
  outcome: CallOutcome;
  created_at: string;
};

// ============================================================================
// Data layer — the ONE place SQL lives. Pages and API routes call these and
// never touch SQLite directly (per the assessment constraints).
//
// Design decisions:
//  - Every window is a ROLLING window measured from `datetime('now')`, so the
//    numbers are live and stay correct no matter which dataset QA loads. "Last
//    7 days" = the 7*24h ending at the moment of the request.
//  - We compare against ISO-8601 UTC strings produced by strftime so the
//    lexicographic comparison lines up exactly with the `Z`-suffixed
//    `started_at` values stored in the table.
//  - Days are bucketed by UTC calendar date (`date(started_at)`).
// ============================================================================

// strftime pattern that reproduces our stored `2026-07-06T12:00:00.000Z` shape.
const ISO = "%Y-%m-%dT%H:%M:%fZ";
// Lower/upper bound SQL expressions for a rolling N-day window ending now.
const since = (days: number) => `strftime('${ISO}','now','-${days} days')`;
const nowExpr = `strftime('${ISO}','now')`;

export type DailyPoint = { date: string; connected_count: number; total_count: number };

/** Today's UTC date per the database clock — anchors JS-side date spines. */
function todayUTC(): string {
  const row = getDb().prepare(`SELECT date('now') AS d`).get() as { d: string };
  return row.d;
}

/** Build an array of N YYYY-MM-DD dates ending at (and including) `end`, oldest first. */
function dateSpine(end: string, n: number): string[] {
  const out: string[] = [];
  const base = new Date(`${end}T00:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function meta(spine: string[]) {
  return {
    generated_at: new Date().toISOString(),
    window_start: spine[0],
    window_end: spine[spine.length - 1],
  };
}

// ----- The Monday-morning number --------------------------------------------

/**
 * Connected calls in the rolling last 7 days. THE number Dana checks every
 * Monday. Live query, never cached, never hardcoded.
 */
export function getConnectedLast7(): number {
  const row = getDb()
    .prepare(
      `SELECT count(*) AS c FROM calls
       WHERE outcome = 'connected'
         AND started_at >= ${since(7)}
         AND started_at <= ${nowExpr}`,
    )
    .get() as { c: number };
  return row.c;
}

// ----- Dashboard: per-agent week-over-week trend ----------------------------

export type AgentTrend = {
  id: string;
  name: string;
  team: string;
  connected_last_7: number;
  connected_prior_7: number;
  connect_rate_last_7: number; // 0–1
  delta: number; // last_7 - prior_7; negative = slipping
};

/**
 * One row per agent: connected calls this week vs the week before, plus this
 * week's connect rate. This is what answers Dana's real question — who is
 * getting better or worse, and who she should talk to Monday morning.
 */
export function getAgentTrends(): AgentTrend[] {
  const rows = getDb()
    .prepare(
      `SELECT
         a.id, a.name, a.team,
         SUM(CASE WHEN c.outcome='connected' AND c.started_at >= ${since(7)} THEN 1 ELSE 0 END) AS connected_last_7,
         SUM(CASE WHEN c.outcome='connected' AND c.started_at >= ${since(14)} AND c.started_at < ${since(7)} THEN 1 ELSE 0 END) AS connected_prior_7,
         SUM(CASE WHEN c.started_at >= ${since(7)} AND c.started_at <= ${nowExpr} THEN 1 ELSE 0 END) AS total_last_7
       FROM agents a
       LEFT JOIN calls c ON c.agent_id = a.id
       GROUP BY a.id
       ORDER BY a.name`,
    )
    .all() as Array<{
    id: string;
    name: string;
    team: string;
    connected_last_7: number;
    connected_prior_7: number;
    total_last_7: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    team: r.team,
    connected_last_7: r.connected_last_7,
    connected_prior_7: r.connected_prior_7,
    connect_rate_last_7: r.total_last_7 ? r.connected_last_7 / r.total_last_7 : 0,
    delta: r.connected_last_7 - r.connected_prior_7,
  }));
}

// ----- API: /api/weekly-digest ----------------------------------------------

export type TopAgent = { name: string; team: string; connected_count: number };

export function getWeeklyDigest() {
  const db = getDb();
  const spine = dateSpine(todayUTC(), 28);

  // Daily connected/total across the whole team.
  const daily = db
    .prepare(
      `SELECT date(started_at) AS date,
              SUM(CASE WHEN outcome='connected' THEN 1 ELSE 0 END) AS connected_count,
              COUNT(*) AS total_count
       FROM calls
       WHERE started_at >= ${since(28)}
       GROUP BY date(started_at)`,
    )
    .all() as Array<{ date: string; connected_count: number; total_count: number }>;
  const dailyMap = new Map(daily.map((d) => [d.date, d]));

  // Per-day connected counts split by team.
  const teamRows = db
    .prepare(
      `SELECT date(c.started_at) AS date, a.team AS team, COUNT(*) AS connected
       FROM calls c JOIN agents a ON a.id = c.agent_id
       WHERE c.outcome='connected' AND c.started_at >= ${since(28)}
       GROUP BY date(c.started_at), a.team`,
    )
    .all() as Array<{ date: string; team: string; connected: number }>;
  const teamMap = new Map<string, Record<string, number>>();
  for (const r of teamRows) {
    const day = teamMap.get(r.date) ?? {};
    day[r.team] = r.connected;
    teamMap.set(r.date, day);
  }

  const data = spine.map((date) => ({
    date,
    connected_count: dailyMap.get(date)?.connected_count ?? 0,
    total_count: dailyMap.get(date)?.total_count ?? 0,
    by_team: teamMap.get(date) ?? {},
  }));

  const top_agents = db
    .prepare(
      `SELECT a.name, a.team, COUNT(*) AS connected_count
       FROM calls c JOIN agents a ON a.id = c.agent_id
       WHERE c.outcome='connected' AND c.started_at >= ${since(7)} AND c.started_at <= ${nowExpr}
       GROUP BY a.id
       ORDER BY connected_count DESC, a.name
       LIMIT 3`,
    )
    .all() as TopAgent[];

  return { data, top_agents, meta: meta(spine) };
}

// ----- API: /api/agents/[id]/scorecard --------------------------------------

export function getAgentScorecard(id: string) {
  const db = getDb();
  const agent = db
    .prepare(`SELECT id, name, team, hire_date FROM agents WHERE id = ?`)
    .get(id) as { id: string; name: string; team: string; hire_date: string } | undefined;
  if (!agent) return null;

  const spine = dateSpine(todayUTC(), 14);
  const daily = db
    .prepare(
      `SELECT date(started_at) AS date,
              SUM(CASE WHEN outcome='connected' THEN 1 ELSE 0 END) AS connected_count,
              COUNT(*) AS total_count
       FROM calls
       WHERE agent_id = ? AND started_at >= ${since(14)}
       GROUP BY date(started_at)`,
    )
    .all(id) as Array<{ date: string; connected_count: number; total_count: number }>;
  const map = new Map(daily.map((d) => [d.date, d]));

  const last_14_days: DailyPoint[] = spine.map((date) => ({
    date,
    connected_count: map.get(date)?.connected_count ?? 0,
    total_count: map.get(date)?.total_count ?? 0,
  }));

  const t = db
    .prepare(
      `SELECT
         SUM(CASE WHEN outcome='connected' AND started_at >= ${since(7)} THEN 1 ELSE 0 END) AS connected_last_7,
         SUM(CASE WHEN outcome='connected' AND started_at >= ${since(14)} AND started_at < ${since(7)} THEN 1 ELSE 0 END) AS connected_prior_7,
         SUM(CASE WHEN started_at >= ${since(7)} AND started_at <= ${nowExpr} THEN 1 ELSE 0 END) AS total_last_7
       FROM calls WHERE agent_id = ?`,
    )
    .get(id) as { connected_last_7: number; connected_prior_7: number; total_last_7: number };

  return {
    agent,
    last_14_days,
    totals: {
      connected_last_7: t.connected_last_7 ?? 0,
      connected_prior_7: t.connected_prior_7 ?? 0,
      connect_rate_last_7: t.total_last_7 ? (t.connected_last_7 ?? 0) / t.total_last_7 : 0,
    },
    meta: meta(spine),
  };
}

// ----- API: /api/teams/[name]/summary ---------------------------------------

export function getTeamSummary(name: string) {
  const db = getDb();
  const agents = db
    .prepare(`SELECT id, name FROM agents WHERE team = ? ORDER BY name`)
    .all(name) as Array<{ id: string; name: string }>;
  if (agents.length === 0) return null;

  const per = db
    .prepare(
      `SELECT a.id, a.name,
              SUM(CASE WHEN c.outcome='connected' THEN 1 ELSE 0 END) AS connected_count,
              COUNT(c.id) AS total_count
       FROM agents a
       LEFT JOIN calls c ON c.agent_id = a.id
         AND c.started_at >= ${since(7)} AND c.started_at <= ${nowExpr}
       WHERE a.team = ?
       GROUP BY a.id
       ORDER BY connected_count DESC, a.name`,
    )
    .all(name) as Array<{ id: string; name: string; connected_count: number; total_count: number }>;

  const connected_count = per.reduce((s, a) => s + a.connected_count, 0);
  const total_count = per.reduce((s, a) => s + a.total_count, 0);
  const spine = dateSpine(todayUTC(), 7);

  return {
    team: { name, agent_count: agents.length },
    last_7_days: {
      connected_count,
      total_count,
      connect_rate: total_count ? connected_count / total_count : 0,
    },
    agents: per,
    meta: meta(spine),
  };
}
