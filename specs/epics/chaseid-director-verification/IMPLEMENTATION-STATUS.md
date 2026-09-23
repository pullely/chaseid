# chaseid-director-verification (CH) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| CH0 — the spec | ✅ shipped | [#8](https://github.com/pullely/chaseid/pull/8) |
| CH1 — the register and the nightly sync | ✅ shipped | [#9](https://github.com/pullely/chaseid/pull/9) |
| CH2 — the status board and the chase | ✅ shipped | [#10](https://github.com/pullely/chaseid/pull/10) |
| CH3 — the at-risk report, the digest and the firm's roles | ✅ shipped | [#11](https://github.com/pullely/chaseid/pull/11) (org, invitations and roles on D1), [#12](https://github.com/pullely/chaseid/pull/12) (report, digest, quota) |

## Departures from the design

### CH1 — `CHASE_CACHE` is the api-edge idempotency namespace, not a new one

**Design:** a new `CHASE_CACHE` KV namespace provisioned by
`infra/terraform/cloudflare-kv` through a `chase_cache_kv_id` wiring key.
**Built:** `CHASE_CACHE` is bound to the existing
`api_edge_idempotency_kv_id` namespace in both envs, and every key the worker
writes is prefixed `ch:v1:`. **Why:** no infrastructure change inside CH1's
landing, and the prefix keeps the two uses disjoint. A dedicated namespace is a
one-line wiring change later if the idempotency namespace's size ever matters.

### CH1 — the import route syncs inline

The import route runs the provider sweep for the companies it just wrote, in
the same request, before matching contact addresses — Companies House publishes
no personal addresses, and the people those addresses belong to do not exist
as rows until the sync has run. Sync runs it creates carry `trigger: "import"`
(the design listed `cron | manual`).

### CH2 — the baseline's `appendEventWithAudit` did not run on D1 (fixed here)

**Found:** the cirrus baseline's `packages/db/src/events/repository.ts` wrote
`appendEventWithAudit` as ONE Postgres data-modifying CTE
(`WITH inserted_event AS (INSERT …) … row_to_json(…) … FULL JOIN`). D1 is
SQLite: asked to `EXPLAIN` it, stage D1 answered
`near "INSERT": syntax error` and `no such function: row_to_json`. Every
audited write therefore fell into the repository's catch and returned an error
— silently for callers that ignore it (CH1's `chase.company.imported` never
reached the audit surface), fatally for callers that throw on it.
**Built:** two statements, `INSERT … ON CONFLICT (id) DO NOTHING RETURNING *`
into `events_event_log`, then the same into `events_audit_entries`; portable to
both engines, asserted against real SQLite in `tests/db` and end to end in
`tests/chase-worker/src/chase-sqlite.test.ts`. **Not fixed here** (see
`CH-J`): the fix reaches only the workers this PR redeploys (`chase-worker`);
the other baseline workers bundle `@saas/db` at build time and keep the broken
statement until they are next deployed.

### CH2 — "in the same transaction" is ordered, not atomic

D1 has no interactive transactions; the baseline's `executor.transaction` runs
the callback's statements in order with no rollback. A chase therefore writes
`chase_messages` first, then advances `chase_step`, then appends
`chase.director.chased`. A failure part-way leaves the message on the AML file
and the step unadvanced, so the next sweep retries the same step — and the
notifications idempotency key `chase:<prs>:<step>` collapses the resend.

### CH2 — a failed enqueue does not advance the step

The design had every send advance the step. As built, only an enqueue the
notifications worker accepted moves the clock; a failed one (`no_binding`,
`non_2xx`, …) is still recorded on `chase_messages` with its verdict, and the
same step is retried next morning. Advancing on failure would skip a notice the
person never received.

### CH2 — who is chased

Only `verification_state = 'unverified'`; an `unknown` person is shown on the
board but never emailed, because `unknown` means the provider did not say, and
chasing someone who may already have verified is the complaint `CH-D` warns
about. "Chase now" (`POST …/directors/{prs}/chase`) skips the 30-day window and
the seven-day interval but never the verified/resigned/no-address checks, and
answers `200` with `skippedReason` rather than an error when it sends nothing.
A human who is both an officer and a PSC of one company is two rows and, given
an address on both, receives two chases per step.

### CH3 — the firm's front doors fixed on D1, and two workers redeployed by hand

`membership.bootstrapOrganization` and the invitation-accept statement were the
same kind of Postgres data-modifying CTE as the audit append (`CH-J`); on D1 no
organization could be created and no invitation accepted. Both are now
sequential statements with compensation on failure (the accept's guarded
`UPDATE … WHERE status = 'pending' …` still admits one winner), tested against
real SQLite. `membership-worker` and `policy-worker` are redeployed in the same
landing by touching their `component.yaml`: a change to a shared package
deploys only components whose own paths changed, so the `chase.read` /
`chase.write` permissions CH1 added to `@saas/policy-engine` had never reached
the live policy worker — every chase route answered the deny-by-default 404
live until this landing.

### CH3 — the plan allowance maps onto the baseline's plan codes

**Design:** £29 / £79 / £199 tiers at 100 / 500 / unlimited companies.
**Built:** a `limit.chase_companies` entitlement on the baseline's existing plan
catalog — `pro` 100, `business` 500, `enterprise` unlimited, and `free` 10 (plus
the same 10 in billing-worker's implicit default tier) so a firm can try the
product. The catalog's display prices are the baseline's and were not changed:
prices belong to the payment provider's products, which this account has not
configured. Only NEW company numbers count against the allowance; a re-import is
free. The refusal is the baseline's `precondition_failed` (412) with
`reason: "limit_reached"`, returned before any row is written.

### CH3 — metering and the digest read other contexts' tables directly

`companies_under_management` is written through `@saas/db`'s metering
repository from chase-worker, not through metering-worker's HTTP route: that
route authorizes `organization.metering.write`, which a firm's staff do not hold
and the cron's system actor cannot. It is a daily gauge — one reading per org per
UTC day, keyed `companies_under_management:<date>` — written by the nightly sweep
or, on a day without one, by an import. The Monday digest likewise reads the
org's active user members and their addresses through the membership and
identity repositories, because neither worker exposes an internal "members with
addresses" route. Both are reads (or an idempotent insert) through the baseline's
own repositories on the shared D1 database.

### CH3 — no new permissions; the roles were already there

The design spoke of `chaseid.*` permissions and a "reviewer" role. As built,
CH1 registered `chase.read` and `chase.write` on the baseline's existing roles
(owner/admin/builder read and write, viewer reads, billing_admin neither), and
CH3 made them live (see the redeploy above) and pinned the matrix in
`tests/policy-engine/src/chase-roles.test.ts`. The baseline's `viewer` is the
reviewer: board, chase log and report, and a 404 on import, remove, mark-verified
and chase.

## What was verified live, and what was not

Verified on the live stack: `/health` on stage and prod; the four `chase_*`
tables present on both D1 databases; each merge's deploy run; and, read-only
against stage D1, that the baseline's CTE SQL fails and its replacement parses.
Not exercised end to end live: the authenticated chase routes. Signing in takes a
magic-link email to a real inbox, and no test user or inbox was available to this
build, so the "on stage and prod" parts of each milestone's done-when list are
covered by route-level tests on real SQLite with the real policy engine
(`tests/chase-worker/src/ch3-routes.test.ts`, `chase-sqlite.test.ts`), not by
calls against the deployed workers. The first real sign-up is the first live test.

