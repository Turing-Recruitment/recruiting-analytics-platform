// Two fixes verified together because both live in the referral sweep's fetch/enrich path.
//
// (1) CENSUS SCOPE — the census asked Greenhouse for every active referral in Application
//     Review across the whole tenant and then discarded the ~97% sitting on closed reqs
//     client-side. Greenhouse answers that scan with a ~28s gateway timeout and a 503: measured
//     2026-08-18, the unscoped query failed 4 of 4 trials while the same query scoped to the 51
//     open job ids succeeded 4 of 4 in 1.5-3.7s. Sweep failure rate had climbed 0% -> 96% over
//     six days with a 30-hour unbroken silence on Aug 16-17. Scoping server-side by the open job
//     ids we already fetch is what makes the census viable at all, not a cadence tradeoff.
//
// (2) DEPARTED OWNERS — a deactivated Greenhouse user still seated as a Recruiter kept the
//     fan-out addressing DMs to someone who had left; unreachable recipients fall back to the
//     head-of-TA, so those copies landed on Sam (Alia North, 3 sends / 2 applications).
//     /v3/users carries `deactivated` and the sweep ALREADY fetches it for name resolution —
//     it was simply never consulted. Sam's rule (2026-08-14): if someone has departed, no
//     message should be sent for them at all.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const HOUR = 60 * 60 * 1000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

const sb = vi.hoisted(() => {
  const state = { sweepItemInserts: [] as Array<Record<string, unknown>> }
  const ok = (data: unknown) => ({ data, error: null })
  function from(table: string) {
    const chain: Record<string, unknown> = {
      select: () => chain, eq: () => chain, in: () => chain, update: () => chain,
      insert: (rows: unknown) => {
        if (table === "sweep_items" && Array.isArray(rows)) {
          state.sweepItemInserts.push(...(rows as Array<Record<string, unknown>>))
        }
        return chain
      },
      upsert: () => chain,
      single: () => Promise.resolve(ok({ id: "run-1", started_at: iso(0) })),
      then<R>(onf: (v: { data: unknown; error: unknown }) => R) {
        return Promise.resolve(ok(table === "alert_ledger" ? [] : null)).then(onf)
      },
    }
    return chain
  }
  return { client: { from }, state, reset() { state.sweepItemInserts = [] } }
})
vi.mock("../lib/supabase", () => ({ supabase: sb.client, getSupabase: () => sb.client }))

const gh = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ path: string; params: Record<string, unknown> }>,
    censusCalls: [] as Array<Array<number | null | undefined>>,
    recent: [] as unknown[],
    census: [] as unknown[],
    openJobs: [] as Array<{ id: number; name: string }>,
    owners: [] as Array<Record<string, unknown>>,
    users: [] as Array<Record<string, unknown>>,
  }
  return { state, reset() {
    state.calls = []; state.censusCalls = []; state.recent = []; state.census = []
    state.openJobs = []; state.owners = []; state.users = []
  } }
})
vi.mock("../lib/greenhouse-client", () => ({
  greenhouseGetAll: vi.fn(async (path: string, params: Record<string, unknown>) => {
    gh.state.calls.push({ path, params })
    if (path === "/applications" && "created_at" in params) return gh.state.recent
    if (path === "/applications") return gh.state.census // an UNSCOPED census would land here
    if (path === "/jobs" && params.status === "open") return gh.state.openJobs
    return []
  }),
}))
vi.mock("../lib/greenhouse-evidence", () => ({
  listApplicationsForJobs: vi.fn(async (jobIds: Array<number | null | undefined>) => {
    gh.state.censusCalls.push(jobIds)
    const ids = new Set(jobIds.filter((i): i is number => typeof i === "number"))
    return (gh.state.census as Array<{ job_id: number }>).filter((a) => ids.has(a.job_id))
  }),
  listJobOwners: async () => gh.state.owners,
  listUsers: async () => gh.state.users,
  listReferrers: async () => [],
  listJobsByIds: async () => [],
  listCandidatesByIds: async () => [],
}))

import { runReferralSweep } from "../lib/sweep-referral"

function app(o: { id: number; job_id: number; ageMs: number }) {
  return {
    id: o.id, candidate_id: o.id + 1000, job_id: o.job_id, status: "in_process",
    current_stage: null, stage_name: "Application Review",
    source: { id: 4000194004, name: "Referral" }, credited_to: null, referrer_id: null,
    applied_at: iso(o.ageMs), created_at: iso(o.ageMs), last_activity_at: null,
    current_stage_at: iso(o.ageMs),
  }
}
const owner = (job_id: number, user_id: number, type = "recruiter", responsible = false) =>
  ({ job_id, user_id, type, responsible, active: undefined })
const user = (id: number, deactivated: boolean | null) =>
  ({ id, name: `User ${id}`, primary_email: `u${id}@x.com`, deactivated })

beforeEach(() => { sb.reset(); gh.reset() })
afterEach(() => vi.unstubAllEnvs())

describe("census is scoped to open requisitions server-side", () => {
  test("the census is requested by job_ids, and no unscoped /applications scan is issued", async () => {
    gh.state.openJobs = [{ id: 10, name: "A" }, { id: 11, name: "B" }]
    gh.state.census = [app({ id: 1, job_id: 10, ageMs: 90 * 24 * HOUR })]
    await runReferralSweep({})

    // the census went through the id-batched fetcher, carrying exactly the open job ids
    expect(gh.state.censusCalls).toHaveLength(1)
    expect([...gh.state.censusCalls[0]].sort()).toEqual([10, 11])

    // and NOTHING issued a tenant-wide /applications scan (the query that 503s)
    const unscoped = gh.state.calls.filter(
      (c) => c.path === "/applications" && !("created_at" in c.params)
    )
    expect(unscoped).toEqual([])
  })

  test("a sitting referral on an open req is still found (the fix must not lose coverage)", async () => {
    gh.state.openJobs = [{ id: 10, name: "AI/ML Engineer" }]
    gh.state.census = [app({ id: 1, job_id: 10, ageMs: 90 * 24 * HOUR })]
    const r = await runReferralSweep({})
    expect(r.items.map((i) => i.application_id)).toEqual([1])
    expect(r.items[0].urgency_tier).toBe("breach")
  })

  test("no open requisitions means no census call at all", async () => {
    gh.state.openJobs = []
    const r = await runReferralSweep({})
    expect(gh.state.censusCalls).toEqual([])
    expect(r.items).toEqual([])
  })
})

describe("departed recruiters are dropped from the alert fan-out", () => {
  test("a deactivated recruiter is excluded; the live one survives", async () => {
    gh.state.openJobs = [{ id: 10, name: "Staff FDE - India" }]
    gh.state.census = [app({ id: 1, job_id: 10, ageMs: 3 * HOUR })]
    gh.state.owners = [owner(10, 500, "recruiter", true), owner(10, 501, "recruiter")]
    gh.state.users = [user(500, false), user(501, true)] // 501 has left
    const r = await runReferralSweep({})
    expect(r.items[0].recruiter_ids).toEqual([500])
  })

  test("a requisition whose only recruiters departed yields an EMPTY list, not a departed one", async () => {
    gh.state.openJobs = [{ id: 10, name: "Orphaned Req" }]
    gh.state.census = [app({ id: 2, job_id: 10, ageMs: 3 * HOUR })]
    gh.state.owners = [owner(10, 501, "recruiter", true)]
    gh.state.users = [user(501, true)]
    const r = await runReferralSweep({})
    expect(r.items[0].recruiter_ids).toEqual([])
    // and the elected primary must not be a departed person either
    expect(r.items[0].recruiter_name).toBeNull()
  })

  test("an owner with no user record is treated as ACTIVE — absence is not evidence of departure", async () => {
    gh.state.openJobs = [{ id: 10, name: "Req" }]
    gh.state.census = [app({ id: 3, job_id: 10, ageMs: 3 * HOUR })]
    gh.state.owners = [owner(10, 700, "recruiter", true)]
    gh.state.users = [] // no record fetched for 700
    const r = await runReferralSweep({})
    expect(r.items[0].recruiter_ids).toEqual([700])
  })

  test("deactivated=null/undefined counts as active", async () => {
    gh.state.openJobs = [{ id: 10, name: "Req" }]
    gh.state.census = [app({ id: 4, job_id: 10, ageMs: 3 * HOUR })]
    gh.state.owners = [owner(10, 800, "recruiter", true)]
    gh.state.users = [user(800, null)]
    const r = await runReferralSweep({})
    expect(r.items[0].recruiter_ids).toEqual([800])
  })
})
