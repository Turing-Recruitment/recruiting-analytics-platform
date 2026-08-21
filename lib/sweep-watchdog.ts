import { supabase } from "./supabase"
import { SWEEP_CONFIG } from "./sweep-config"
import { SWEEP_CADENCE_HOURS } from "./sweep-health"
import { postSlackDm } from "./notification-delivery"
import type { SweepRunSummary } from "./sweep-types"

/**
 * Sweep watchdog — the thing that speaks when a sweep lane goes quiet.
 *
 * Nothing has ever pushed sweep failure anywhere. `computeSweepHealth` classifies a lane as
 * degraded correctly, but its only consumer is the dashboard, so a lane can fail indefinitely and
 * the first sign is a human noticing alerts stopped arriving. That has now happened twice: the
 * June 2026 Greenhouse-401 outage ran unnoticed for eleven days (sweep-health.ts:30), and the
 * unscoped-census 503s produced a 30-hour unbroken silence on 2026-08-16/17 that surfaced only
 * because someone went looking for an unrelated reason.
 *
 * This runs inside the notify-drain cron, NOT inside a sweep — a check that lives in the process
 * being watched cannot report that process failing to start. The drain is hourly and independent.
 *
 * THROTTLE, and why it needs no state. The alarm speaks at fixed hours-since-last-success
 * thresholds (3, 6, 12, then daily). The check runs hourly, so hours-since-success advances by
 * about one per run and each threshold is crossed exactly once — no "last alerted" row, no
 * migration, and no hourly repeat while an outage persists. A skipped drain tick can skip a
 * threshold; the next one still fires, which is the right failure direction for an alarm.
 */

const HOUR_MS = 3_600_000

/** Thresholds in whole hours since the last successful run, SCALED BY THE LANE'S OWN CADENCE.
 *
 *  Quiet means "has missed several of its own cycles", not a fixed wall-clock age. Referral runs
 *  hourly and agency every four hours (SWEEP_CADENCE_HOURS), so a flat 3-hour threshold would page
 *  on a perfectly healthy agency lane between two normal runs — a false alarm on the first night,
 *  which is exactly how an alarm gets ignored. Scaling gives referral 3/6/12h and agency 12/24/48h.
 *
 *  Comparing whole hours (not fractional cycles) is what keeps the throttle stateless: the check
 *  runs hourly, so `whole` advances by one per run and lands on any given threshold exactly once.
 *  Testing `floor(hours / cadence)` instead would hold the same value for `cadence` consecutive
 *  runs and speak that many times. */
export function shouldSpeak(hoursSinceSuccess: number, cadenceHours: number): boolean {
  if (!Number.isFinite(hoursSinceSuccess) || hoursSinceSuccess < 0) return false
  if (!Number.isFinite(cadenceHours) || cadenceHours <= 0) return false
  const whole = Math.floor(hoursSinceSuccess)
  const cadence = Math.max(1, Math.round(cadenceHours))
  for (const missedCycles of [3, 6, 12]) {
    if (whole === missedCycles * cadence) return true
  }
  // Past the fixed thresholds, a daily nudge on the wall clock for every lane.
  return whole >= 12 * cadence && whole % 24 === 0
}

export interface SweepStallVerdict {
  speak: boolean
  hoursSinceSuccess: number | null
  text: string | null
}

/** PURE. Decide whether the lane is quiet enough to warrant speaking, and what to say.
 *  `latestSuccessAt` null means the lane has never completed a run; the reference then falls back
 *  to the oldest attempt we can see, so a lane that has never once succeeded still raises. */
export function evaluateSweepStall(input: {
  sweepType: SweepRunSummary["sweep_type"]
  latestSuccessAt: string | null
  oldestAttemptAt: string | null
  latestAttempt: { started_at: string; status: string; error_message?: string | null } | null
  consecutiveFailures: number
  nowMs: number
}): SweepStallVerdict {
  const { sweepType, latestSuccessAt, oldestAttemptAt, latestAttempt, consecutiveFailures, nowMs } = input

  const referenceIso = latestSuccessAt ?? oldestAttemptAt
  if (!referenceIso) return { speak: false, hoursSinceSuccess: null, text: null }
  const referenceMs = Date.parse(referenceIso)
  if (!Number.isFinite(referenceMs)) return { speak: false, hoursSinceSuccess: null, text: null }

  const hours = (nowMs - referenceMs) / HOUR_MS
  const cadence = SWEEP_CADENCE_HOURS[sweepType] ?? 1
  if (!shouldSpeak(hours, cadence)) return { speak: false, hoursSinceSuccess: hours, text: null }

  const whole = Math.floor(hours)
  const never = latestSuccessAt === null
  const err = latestAttempt?.error_message?.trim()
  const lines = [
    `:rotating_light: *${sweepType} sweep has not completed successfully in ${whole} hours*`,
    never
      ? "This lane has never recorded a successful run."
      : `Last success: ${new Date(referenceMs).toISOString().replace("T", " ").slice(0, 16)} UTC.`,
    `Consecutive failed runs: ${consecutiveFailures}.`,
    err ? `Latest error: ${err}` : "Latest run recorded no error message.",
    "New candidates are not being detected while this persists. Alerts already queued still send.",
  ]
  return { speak: true, hoursSinceSuccess: hours, text: lines.join("\n") }
}

export interface SweepWatchdogResult {
  checked: Array<{ sweepType: string; hoursSinceSuccess: number | null; spoke: boolean }>
  errors: string[]
}

/** Read each lane's run history, evaluate, and DM the rec-ops recipient when a lane is quiet.
 *  Never throws: a watchdog that can break the drain is worse than one that misses a tick. */
export async function runSweepWatchdog(nowMs = Date.now()): Promise<SweepWatchdogResult> {
  const result: SweepWatchdogResult = { checked: [], errors: [] }
  const recipient = SWEEP_CONFIG.slack.recruitingOpsAlertUserId?.trim()

  for (const sweepType of ["referral", "agency"] as const) {
    try {
      // One read per lane: the recent run tail, newest first. 200 rows covers >8 days of the
      // hourly referral lane, far past any threshold we act on.
      const { data, error } = await supabase
        .from("sweep_runs")
        .select("started_at, status, error_message")
        .eq("sweep_type", sweepType)
        .order("started_at", { ascending: false })
        .limit(200)
      // Throw a real Error, not the PostgREST error object: `String({message})` is
      // "[object Object]", which would land in result.errors and destroy the one diagnostic a
      // silent-failure alarm exists to carry.
      if (error) throw new Error(`sweep_runs read failed: ${error.message ?? String(error)}`)
      const rows = (data ?? []) as Array<{ started_at: string; status: string; error_message: string | null }>
      if (rows.length === 0) {
        result.checked.push({ sweepType, hoursSinceSuccess: null, spoke: false })
        continue
      }

      const latestSuccess = rows.find((r) => r.status === "completed") ?? null
      let consecutiveFailures = 0
      for (const r of rows) {
        if (r.status === "completed") break
        if (r.status === "failed") consecutiveFailures += 1
      }

      const verdict = evaluateSweepStall({
        sweepType,
        latestSuccessAt: latestSuccess?.started_at ?? null,
        oldestAttemptAt: rows[rows.length - 1]?.started_at ?? null,
        latestAttempt: rows[0] ?? null,
        consecutiveFailures,
        nowMs,
      })

      if (verdict.speak && verdict.text && recipient) {
        await postSlackDm(recipient, verdict.text)
      }
      result.checked.push({
        sweepType,
        hoursSinceSuccess: verdict.hoursSinceSuccess,
        spoke: Boolean(verdict.speak && recipient),
      })
    } catch (err) {
      result.errors.push(`${sweepType}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}
