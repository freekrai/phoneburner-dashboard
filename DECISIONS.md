# What I built for Dana, and why

Dana said: *"I just want to know — week to week — whether my agents are getting
better or worse, and who I should be talking to on Monday morning."* So the
dashboard is built around **change**, not raw totals.

## The dashboard (`/`)

1. **The Monday number** — connected calls in the rolling last 7 days, one big
   figure. Live-queried in `getConnectedLast7()`. This is the number Dana asks
   her ops lead for; it's the first thing on the page.
2. **"Talk to these on Monday"** — the 3 agents whose connected calls dropped
   most vs the prior week. This *is* her Monday-morning list.
3. **"Trending up"** — the 3 most-improved agents (recognise them / learn from
   them).
4. **Full roster** — every agent, connected calls, connect rate, and
   week-over-week delta (green up / red down). The detail behind the callouts.

"Better or worse" = **week-over-week delta in connected calls** (last 7 days vs
the 7 before). It's the simplest honest signal and it's what she actually asked
for. Connect *rate* is shown alongside so a low-volume week isn't mistaken for a
bad one.

## Decisions worth knowing

- **Rolling windows, measured from `datetime('now')`.** Every "last N days" is a
  live rolling window, so numbers stay correct whatever dataset QA loads — no
  hardcoded dates.
- **One data module.** All SQL lives in `src/lib/db.ts`. Pages and the four API
  routes are thin callers. No SQL or numbers anywhere else.
- **Days bucketed by UTC calendar date**, and time comparisons use ISO-8601 `Z`
  strings so they line up with stored `started_at` values.

## Reporting API

`/api/weekly-digest` (JSON), `/api/weekly-digest.csv`, `/api/agents/[id]/scorecard`,
`/api/teams/[name]/summary`. All live-queried, all `Cache-Control: no-store`,
404s for unknown agent/team. CSV escapes team names (spaces/commas) per RFC-4180.

## Tests

`pnpm test` — the metric tests re-derive each number with an independent query
and assert the data layer matches, so they hold on any dataset. (`vitest.config.ts`
carries a small shim so Vitest can load the `node:sqlite` builtin.)

## Run

`pnpm dev` → `/`. Node 22.5+ required (`node:sqlite`).
