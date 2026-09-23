# chaseid-director-verification — implementation plan

Milestones land in order. Each is one or more tasks, each task one pull
request, each pull request landed with `orun pr land`. A milestone is marked
✅ here when its "done when" list is true, and recorded in
`IMPLEMENTATION-STATUS.md`.

## CH0 — the spec ✅

This doc set, merged to `main` and attached to the epic with `orun spec push`.

**Done when**
- the five documents are on `main`
- `orun spec list --epic chaseid-director-verification` shows them

## CH1 — the register and the nightly sync ✅

The invisible milestone: everything the product is, with no screen on it. A new
Worker `apps/chase-worker` on the baseline's canonical worker shape
(`src/{index,router,env,http,ids,pagination}.ts`, `src/handlers/*`,
`src/membership-client.ts`, `src/policy-client.ts`), a new `chase` context in
`packages/db` (`src/chase/{types,repository,index}.ts` plus a subpath export),
and four migrations in `packages/db/src/migrations/` registered with their
sha256 in `packages/db/src/manifest.ts` — `200_chase_companies`,
`210_chase_people`, `220_chase_sync_runs`, `230_chase_messages`. The
`CompaniesHouseProvider` interface lands with both implementations and the
recorded fixtures, and `resolveProvider(env)` picks the fixture one whenever
`COMPANIES_HOUSE_API_KEY` is absent — which, on this account, is always.
`apps/api-edge` gains `chase-facade.ts`, a `CHASE_WORKER` binding in `env.ts`
and in both env blocks of `wrangler.template.jsonc`, and the matching assertion
in `scripts/verify-bindings.mjs`. A `CHASE_CACHE` KV namespace is added to
`infra/terraform/cloudflare-kv` and wired through a `chase_cache_kv_id` key.
`SOLO_MODE` goes to `"false"` — Chaseid is a firm product, not a single-user
one. The nightly `15 2 * * *` cron sweeps every company in every org through
the provider and upserts officers, PSCs and the next confirmation-statement
date.

**Done when**
- `200_…`–`230_…` are applied on stage and prod (`db-migrate` plan on the PR, apply on merge to `main`)
- `POST /v1/organizations/{org}/chase/companies/import` with a `text/csv` body of company numbers answers `200` on `https://chaseid-api-edge-stage.nexo-7be.workers.dev` and on `…-prod.…`, and `GET …/chase/companies` then lists them with officer and PSC counts
- a company imported that way carries a `nextStatementDue` and each of its people a `verificationState`, with `COMPANIES_HOUSE_API_KEY` unset — the fixture provider served it, and `GET …/chase/sync-runs` says `provider: "fixture"`
- `tests/chase-worker` is green in CI, covering the risk derivation, the CSV parser, the upsert idempotency and both provider implementations
- the audit read surface shows `chase.company.imported` for the import

## CH2 — the status board and the chase ✅

The first user-visible milestone. `GET …/chase/directors` joins people to their
company and derives `daysUntilDue` and `risk` in `src/risk.ts`; `PATCH` sets a
contact email or marks a person verified by hand. The chase is a three-step
state machine on `chase_people.chase_step`, driven by the `0 9 * * *` cron and
by an explicit `POST …/chase/directors/{prs}/chase`: step 1 when a person is
unverified and their company files within 30 days, step 2 after seven days
without a change, step 3 after seven more. Every send goes through
`enqueueNotification` with an idempotency key of
`buildIdempotencyKey("chase", personPublicId, String(step))`, writes a
`chase_messages` row, and appends `chase.director.chased` through
`appendEventWithAudit` in the same transaction. Three templates —
`chase.first_notice`, `chase.reminder`, `chase.escalation` — join the
`TEMPLATES` record in `apps/notifications-worker/src/templates/index.ts`, each
carrying the official GOV.UK verification instructions and no token of any
kind. The console gains `chase/companies`, `chase/directors` and
`chase/messages` under `orgs/[orgSlug]/`, with the `chase` client on
`packages/sdk` and `qk` entries for the cache.

**Done when**
- a sweep against a fixture-seeded org moves an unverified person on a company due within 30 days from `chaseStep: 0` to `1`, writes one `chase_messages` row, and a second sweep on the same day writes none
- after the reminder interval a third sweep moves the same person to step 2 rather than re-sending step 1
- `GET …/chase/messages` returns the chase log on stage and prod, and `GET …/audit` carries the matching `chase.director.chased` entries
- the three templates render `{ subject, html, text }` with every substitution escaped, asserted in `tests/notifications-worker`
- the status board page lists directors filtered by `state` and `risk`, and marking a person verified updates the row optimistically

## CH3 — the at-risk report, the digest and the firm's roles

The milestone that makes Chaseid sellable to a firm rather than to a person.
`GET …/chase/report/at-risk` returns this month's at-risk companies with their
unverified people, and the same route with `?format=csv` (or
`Accept: text/csv`) streams a `text/csv` attachment generated per request —
nothing stored, because there is no R2 (`CH-B`). The Monday run of the `0 9`
cron sends `chase.firm_digest` to every member of every org with at-risk
filings. The `chase.*` actions are registered as permissions on the baseline's
policy worker so the firm's existing roles mean something here — a member with
a read-only role can open the board and the report and cannot import, remove or
chase — and `companies_under_management` is metered on every import and sweep,
with the import path calling the baseline's quota check before its first insert
so the £29 / £79 / £199 tiers (100 / 500 / unlimited) are enforced by the
baseline's own billing context.

**Done when**
- `GET …/chase/report/at-risk?format=csv` answers `200` with `content-type: text/csv` and `content-disposition: attachment` on stage and prod, and the rows match the JSON rendering of the same route
- a member holding only the read role gets `404` from `POST …/chase/companies/import` (the baseline's deny-by-default shape) and `200` from the report
- the Monday digest enqueues one `chase.firm_digest` notification per member of an org that has at-risk filings, and none for an org that has none
- importing past the plan's company allowance is refused before any row is written, with the baseline's quota error, and `companies_under_management` appears on `GET …/usage`
- the report page renders this month's at-risk filings and its Download CSV button returns the file

## Sequencing note

CH1 has to be first and has to be whole: CH2 and CH3 are both pure reads and
writes over the tables, the provider seam and the cron entrypoint it creates,
and neither touches infrastructure again. CH2 depends on CH1 for
`chase_people.verification_state` and `chase_companies.next_statement_due` —
without a sync there is nobody to chase — and on the notifications context,
which the baseline already ships. CH3 depends on CH2 only for
`chase_messages` (the digest counts chases sent) and could otherwise run in
parallel with it; it is sequenced after because the console navigation and the
SDK client are cheaper to extend once than to merge twice. Nothing here is
gated on a provider or a credential: the Companies House key is deliberately
optional at every step (`CH-A`), and the R2-shaped work was cut rather than
deferred into a dependency (`CH-B`).
