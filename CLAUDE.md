@AGENTS.md

# CLAUDE.md

Working notes for agents and new contributors. The README is the engineering
overview; this file is the mechanics. `AGENTS.md` (imported above) carries the
Next.js version warning — read the vendored docs before writing framework code.

## Commands

```bash
npm run dev          # Dev server on localhost:3000
npm run build        # Production build (CI builds with --webpack)
npm run typecheck    # tsc --noEmit; globs test/red too
npm test             # Vitest green board (excludes test/red)
npm run test:red     # Quarantined red specs — must FAIL by assertion when non-empty
npm run test:mutation                     # Seeded mutations must all be caught
npm run check:recruiting-ops-architecture # AST rule engine over the real repo
```

All of the credential-free tier runs on a fresh clone with no environment
configured, and currently reports 1,895 passing tests across 197 files, 160
implementation files checked by the architecture rules, and 8 of 8 seeded
mutations caught. Suites that need credentials or a database skip or are
excluded by design. The boundary suites derive their file set from
`git ls-files`, so they require a git working tree — run them from a checkout,
never a tarball. `npm run lint` is not a CI gate and does not pass; see the
README for the breakdown.

## Environment

Copy `env.example` to `.env.local`. Supabase (URL + service-role key for project
`ilkbfyubwvbpsevybsfe`), Greenhouse (OAuth2 client credentials against the
Turing tenant), a Slack bot token, and a Google service-account key cover the
live paths. The delivery and notification capabilities are gated by their own
flags — `RECOPS_EXEC_ENABLED`, `NOTIFY_DELIVERY_ENABLED`,
`EMPLOYEE_REFERRAL_REPORT_SEND_ENABLED`, `IDENTITY_RECONCILE_ENABLED`, and the
per-artifact `RECOPS_HYDRATE_*` switches — all of which default off. The full
list is in `env.example`.

Two values are compiled in rather than configured, on purpose. The head-of-TA
Slack id (`U07RJJ6RLN6`) lives in `lib/sweep-config.ts` because alert routing
must not vary by environment, and the referral-report recipient gate in
`lib/recruiting-ops/employee-referral-report-runner.ts` hard-codes `@turing.com`
because those reports carry pre-payroll compensation data.

## Layout and boundaries

- `app/` — nine dashboard routes plus 35 HTTP handlers. **Never holds
  business logic**; handlers parse, authorize, and delegate to `lib/`.
- `lib/` — the domain: sweeps, YTD facts, identity resolution, notification
  outbox, Greenhouse client, and the sweep watchdog.
- `lib/recruiting-ops/` — the control plane: capability registry, 26 module
  definitions (`modules/`), governed dimensions (`dimensions/config/`), and
  the delivery pipeline (`delivery/`) that writes to Google Workspace under
  structural write permits.
- `supabase/migrations/` — 26 hand-written SQL migrations, applied in
  filename order; headers argue the schema decisions. Two files share the
  `015` ordinal, which is a fact about the real lineage rather than a
  numbering mistake to fix here.
- `scripts/` — the architecture checker, control-plane preflight, and
  operational CLIs (`scripts/recruiting-ops/`).
- `test/` — Vitest suites, boundary suites, fixtures; `test/red/` is the
  quarantined backlog (empty = goal state, and CI enforces its semantics).
- `docs/recruiting-ops/` — specs, runbooks, and `monitoring/` alert policies
  checked in beside the outage narratives they close.

The architecture checker enforces the boundaries above (and more) at the AST
level; its behavioral suite mutates a scratch repo to prove each rule fires.
If a change trips a rule, the rule is telling you where the code belongs —
change the design, not the checker, unless the rule itself is the defect.

## Conventions that bite

- **Write permits are not optional.** Anything that mutates a Google
  Workspace artifact goes through the delivery pipeline's permit path —
  fingerprinted source cut, HMAC grant, revision pin. No direct `googleapis`
  writes outside `lib/recruiting-ops/delivery/`.
- **Scheduled routes verify identity twice.** The OIDC token's
  service-account is checked against a pinned constant, and the environment's
  declared value against the same constant. Cloud Scheduler sends the SHORT job id in
  `X-CloudScheduler-JobName` — compare with `schedulerJobNameMatches`, which
  accepts both forms, because comparing against the full resource path once
  rejected the scheduler's only lifetime fire.
- **Scheduler jitter lands inside the schedule time.** Cloud Scheduler stamps
  whole seconds of delivery jitter into the header itself (an observed fire
  time was `06:30:03.469627Z`), and refusing those as off-cadence stopped
  every scheduled run between 2026-08-14 and 2026-08-18. The slot minute is
  the cycle's identity; seconds inside it are transport noise and get floored.
- **The referral census must be scoped to open job ids.** `listApplicationsForJobs`
  batches at 50 ids. An unscoped `status` + `stage_name` scan asks Greenhouse to
  walk the whole tenant and comes back a 503; the open-job fetch therefore has
  to resolve BEFORE the census, because it is the census's scope and not a
  post-filter.
- **Departed owners never get messaged.** `/v3/users` carries `deactivated`,
  and both the sweep and the identity resolver consult it. A user id absent
  from the map is treated as ACTIVE — a missing record is not evidence of
  departure, and dropping an owner on missing evidence would silently
  un-notify a live recruiter.
- **Unresolved beats misresolved.** Identity resolution and the roster
  dimension return explicit `unresolved` defects rather than sentinel
  buckets; surfaces render those honestly (no `Unknown` placeholders — the
  DataTable contract forbids them).
- **Public output is redaction-checked.** Anything rendered outside the
  operator surface passes `safe-public-output` and its word-level
  vocabulary drift-lock; person names may appear only via exact canonical
  phrases.
- **Config here is real, fixtures are not.** The roster
  (`lib/recruiting-ops/dimensions/config/recruiter-team-hod.v1.ts`), the artifact registry's Drive
  ids, requisition ids, module names, and the `kelsey` recipient slot are the
  live values — treat them as operational config and keep them accurate. Test
  fixtures stay synthetic and shaped like the real thing so permit and parity
  paths still exercise; no candidate personal data belongs in this repository.
