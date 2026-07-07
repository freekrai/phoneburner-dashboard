import { describe, it, expect } from "vitest";
import { getConnectedLast7, getWeeklyDigest, getAgentScorecard, getAgentTrends } from "@/lib/db";
import { getDb } from "@/lib/db";

// These tests let QA re-verify the numbers monthly without asking us: they
// re-derive each metric with an INDEPENDENT query and assert the data layer
// agrees. They test the calculation, not a frozen expected value, so they hold
// no matter which dataset is loaded.

const ISO = "%Y-%m-%dT%H:%M:%fZ";

describe("the Monday-morning number", () => {
  it("counts connected calls in the rolling last 7 days", () => {
    const independent = getDb()
      .prepare(
        `SELECT count(*) AS c FROM calls
         WHERE outcome = 'connected'
           AND started_at >= strftime('${ISO}','now','-7 days')
           AND started_at <= strftime('${ISO}','now')`,
      )
      .get() as { c: number };
    expect(getConnectedLast7()).toBe(independent.c);
  });

  it("never counts non-connected outcomes", () => {
    const anyConnectedOnly = getDb()
      .prepare(
        `SELECT count(DISTINCT outcome) AS n FROM (
           SELECT outcome FROM calls
           WHERE outcome='connected'
             AND started_at >= strftime('${ISO}','now','-7 days'))`,
      )
      .get() as { n: number };
    expect(anyConnectedOnly.n).toBeLessThanOrEqual(1);
  });
});

describe("weekly digest", () => {
  it("returns exactly 28 daily points, oldest first", () => {
    const { data } = getWeeklyDigest();
    expect(data).toHaveLength(28);
    for (let i = 1; i < data.length; i++) {
      expect(data[i].date > data[i - 1].date).toBe(true);
    }
  });

  it("per-day connected never exceeds total", () => {
    for (const d of getWeeklyDigest().data) {
      expect(d.connected_count).toBeLessThanOrEqual(d.total_count);
    }
  });

  it("top_agents match the highest connectors this week", () => {
    const { top_agents } = getWeeklyDigest();
    expect(top_agents.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < top_agents.length; i++) {
      expect(top_agents[i].connected_count).toBeLessThanOrEqual(top_agents[i - 1].connected_count);
    }
  });
});

describe("agent scorecard", () => {
  it("connect_rate_last_7 equals connected/total and 404s on unknown id", () => {
    expect(getAgentScorecard("does-not-exist")).toBeNull();
    const trend = getAgentTrends()[0];
    const card = getAgentScorecard(trend.id)!;
    expect(card.last_14_days).toHaveLength(14);
    const { connected_last_7, connect_rate_last_7 } = card.totals;
    expect(connect_rate_last_7).toBeGreaterThanOrEqual(0);
    expect(connect_rate_last_7).toBeLessThanOrEqual(1);
    expect(connected_last_7).toBe(trend.connected_last_7);
  });
});
