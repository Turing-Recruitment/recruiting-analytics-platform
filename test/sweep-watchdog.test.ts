// The alarm that speaks when a sweep lane goes quiet.
//
// Nothing has ever pushed sweep failure anywhere: computeSweepHealth classifies a lane as
// degraded, but its only consumer is a dashboard nobody is watching. That gap has now cost two
// silent outages — eleven days in June 2026 (sweep-health.ts:30) and 30 unbroken hours on
// 2026-08-16/17, the latter found only because someone went looking for an unrelated reason.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const HOUR = 3_600_000
const NOW = Date.parse("2026-08-18T22:00:00Z")
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString()

const sb = vi.hoisted(() => {
  const state = { rows: [] as Array<Record<string, unknown>>, failWith: null as string | null }
  function from() {
    const chain: Record<string, unknown> = {
      select: () => chain, eq: () => chain, order: () => chain,
      limit: () => Promise.resolve(
        state.failWith ? { data: null, error: { message: state.failWith } } : { data: state.rows, error: null }
      ),
    }
    return chain
  }
  return { client: { from }, state, reset() { state.rows = []; state.failWith = null } }
})
vi.mock("../lib/supabase", () => ({ supabase: sb.client, getSupabase: () => sb.client }))

const slack = vi.hoisted(() => ({ posts: [] as Array<{ user: string; text: string }>, throwOn: false }))
vi.mock("../lib/notification-delivery", () => ({
  postSlackDm: vi.fn(async (user: string, text: string) => {
    if (slack.throwOn) throw new Error("slack down")
    slack.posts.push({ user, text })
    return "1234.5678"
  }),
}))

import { evaluateSweepStall, runSweepWatchdog, shouldSpeak } from "../lib/sweep-watchdog"

beforeEach(() => { sb.reset(); slack.posts = []; slack.throwOn = false })
afterEach(() => vi.clearAllMocks())

describe("shouldSpeak — cadence-scaled stateless throttle", () => {
  test("the hourly lane fires at 3, 6, 12 and daily thereafter", () => {
    for (const h of [3, 6, 12, 24, 48, 72]) expect(shouldSpeak(h, 1)).toBe(true)
    for (const h of [0, 1, 2, 4, 5, 7, 11, 13, 23, 25, 47, 49]) expect(shouldSpeak(h, 1)).toBe(false)
  })

  test("the 4-hourly agency lane does NOT fire at 3 hours — that is one normal gap", () => {
    // The regression this test exists for: a flat 3h threshold pages a healthy agency lane
    // between two normal runs. Agency must miss THREE of its own cycles first.
    for (const h of [1, 2, 3, 4, 5, 6, 8, 11]) expect(shouldSpeak(h, 4)).toBe(false)
    expect(shouldSpeak(12, 4)).toBe(true)
    expect(shouldSpeak(24, 4)).toBe(true)
    expect(shouldSpeak(48, 4)).toBe(true)
  })

  test("fires once per threshold across a continuous hourly walk, on both lanes", () => {
    // 96 hourly checks with the quarter-hour drift the :15 drain actually samples at
    const walk = (cadence: number) => {
      const fired: number[] = []
      for (let h = 0; h < 96; h++) if (shouldSpeak(h + 0.25, cadence)) fired.push(h)
      return fired
    }
    expect(walk(1)).toEqual([3, 6, 12, 24, 48, 72])
    expect(walk(4)).toEqual([12, 24, 48, 72])
  })

  test("negative, non-finite, and nonsense cadences stay silent", () => {
    for (const h of [-1, NaN, Infinity]) expect(shouldSpeak(h, 1)).toBe(false)
    for (const c of [0, -4, NaN]) expect(shouldSpeak(12, c)).toBe(false)
  })
})

describe("evaluateSweepStall — pure verdict", () => {
  const base = {
    sweepType: "referral" as const,
    oldestAttemptAt: at(200),
    latestAttempt: { started_at: at(0), status: "failed", error_message: "503 Service Unavailable" },
    consecutiveFailures: 3,
    nowMs: NOW,
  }

  test("a lane that succeeded an hour ago says nothing", () => {
    const v = evaluateSweepStall({ ...base, latestSuccessAt: at(1) })
    expect(v.speak).toBe(false)
    expect(v.text).toBeNull()
  })

  test("three hours without a success speaks, naming the count and the error", () => {
    const v = evaluateSweepStall({ ...base, latestSuccessAt: at(3) })
    expect(v.speak).toBe(true)
    expect(v.text).toContain("has not completed successfully in 3 hours")
    expect(v.text).toContain("Consecutive failed runs: 3")
    expect(v.text).toContain("503 Service Unavailable")
    // the operator consequence, stated
    expect(v.text).toContain("not being detected")
  })

  test("a lane that has NEVER succeeded still raises, measured from its oldest attempt", () => {
    const v = evaluateSweepStall({ ...base, latestSuccessAt: null, oldestAttemptAt: at(12) })
    expect(v.speak).toBe(true)
    expect(v.text).toContain("never recorded a successful run")
  })

  test("no history at all stays silent rather than inventing an outage", () => {
    const v = evaluateSweepStall({ ...base, latestSuccessAt: null, oldestAttemptAt: null })
    expect(v.speak).toBe(false)
    expect(v.hoursSinceSuccess).toBeNull()
  })
})

describe("runSweepWatchdog — orchestration", () => {
  test("posts one DM when the referral lane has been quiet for three hours", async () => {
    sb.state.rows = [
      { started_at: at(0), status: "failed", error_message: "503" },
      { started_at: at(1), status: "failed", error_message: "503" },
      { started_at: at(2), status: "failed", error_message: "503" },
      { started_at: at(3), status: "completed", error_message: null },
    ]
    const r = await runSweepWatchdog(NOW)
    // Both lanes read the same stubbed rows, but only the HOURLY lane is quiet at 3 hours —
    // 3h is a single normal gap for the 4-hourly agency lane, so exactly one DM goes out.
    expect(slack.posts).toHaveLength(1)
    expect(slack.posts[0].text).toContain("referral sweep has not completed successfully in 3 hours")
    expect(slack.posts[0].text).toContain("Consecutive failed runs: 3")
    expect(r.errors).toEqual([])
  })

  test("stays silent when the lane succeeded recently", async () => {
    sb.state.rows = [
      { started_at: at(0), status: "completed", error_message: null },
      { started_at: at(1), status: "failed", error_message: "503" },
    ]
    await runSweepWatchdog(NOW)
    expect(slack.posts).toEqual([])
  })

  test("consecutive-failure count stops at the most recent success", async () => {
    sb.state.rows = [
      { started_at: at(0), status: "failed", error_message: "e" },
      { started_at: at(1), status: "failed", error_message: "e" },
      { started_at: at(2), status: "failed", error_message: "e" },
      { started_at: at(3), status: "completed", error_message: null },
      { started_at: at(4), status: "failed", error_message: "e" },
      { started_at: at(5), status: "failed", error_message: "e" },
    ]
    await runSweepWatchdog(NOW)
    expect(slack.posts[0].text).toContain("Consecutive failed runs: 3")
  })

  test("a database error is captured, never thrown — the drain must survive the watchdog", async () => {
    sb.state.failWith = "connection refused"
    const r = await runSweepWatchdog(NOW)
    expect(r.errors.length).toBe(2)
    expect(r.errors[0]).toContain("connection refused")
    expect(slack.posts).toEqual([])
  })

  test("a Slack failure is captured, never thrown", async () => {
    sb.state.rows = [
      { started_at: at(0), status: "failed", error_message: "503" },
      { started_at: at(3), status: "completed", error_message: null },
    ]
    slack.throwOn = true
    const r = await runSweepWatchdog(NOW)
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.errors[0]).toContain("slack down")
    expect(r.errors[0]).toContain("referral")
  })
})
