# Epic: chaseid-director-verification (CH)

**Since 18 November 2025 every UK company director and PSC must verify their identity with Companies House, and one unverified person blocks their company's whole confirmation-statement filing — yet the firms carrying that risk, accountancy and company-secretarial practices with hundreds of limited-company clients, track it in spreadsheets that nobody re-reads. Chaseid makes the register the machine's job: import client companies by company number, pull officers, PSCs and the next confirmation-statement date from public Companies House data every night, derive a per-person verification state, and chase the unverified ones by email on a schedule the firm sets. The design idea that makes it affordable is that all of it is public data on a nightly clock, so the product needs no customer credential, no inbound mail domain and no document store — a D1 register, a KV response cache, two cron triggers and the baseline's own notification and audit contexts are the entire machine.**

Chaseid is for UK accountancy practices and company-secretarial firms with 50–2,000 limited-company clients. When this epic ships, a practice can upload a CSV of client company numbers, see every director and PSC across the whole book ranked by how close their company's filing is and whether they have verified, let the product send the official GOV.UK verification instructions to the ones who have not, escalate on a clock, and hand an auditor a per-person chase log and an at-risk-this-month export — none of which it can do today without a spreadsheet and a person to re-read it.

## Status

| Field | Value |
|-------|-------|
| Status | Draft |
| Cluster | **CH** (CH0–CH3) |
| Owner(s) | `apps/chase-worker` (the register, the sync, the chases) · `packages/db` (the migrations) · `packages/contracts` + `packages/sdk` (the wire) · `apps/notifications-worker` (the chase templates) · `apps/web-console-next` (the surface) |
| Builds on | `cirrus baseline-v12` — extends identity/membership (the firm is an org, its staff are members), config (the chase policy), notifications (the chase emails), audit + domain events (the AML file), metering + quotas (the plan tiers), webhooks (at-risk fan-out) |
| Changes | Adds one bounded context — the client register and its verification chase — as new D1 tables, new `/v1/organizations/{org}` route groups, two cron triggers and four console pages. No baseline table, route or worker contract is changed. |
| Decisions locked | (1) Companies House is reached only through a `CompaniesHouseProvider` interface, and the build ships a recorded-fixture implementation alongside the HTTP one, so every milestone is demonstrably done without an API key. (2) Contact email addresses for directors come from the firm's own CSV, never from Companies House, which does not publish them. (3) Exports are streamed as CSV from a route; nothing is stored, because R2 is not enabled on this account. |
| Gate | CH1 is invisible (the register, the provider and the nightly sync). CH2 is the first user-visible change (the status board and the chase). |
| Shipped as | |

## Read order

1. `design.md` — the resource, the routes, the surfaces, what is out of scope
2. `implementation-plan.md` — the milestones and what "done" means for each
3. `risks-and-open-questions.md` — what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md` — what actually shipped (kept distinct from intent)

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| CH0 — the spec | this doc set | merged and pushed with `orun spec push` |
| CH1 — the register and the nightly sync | `chase_companies`, `chase_people`, `chase_sync_runs` on D1; the `CompaniesHouseProvider` seam with an HTTP and a recorded-fixture implementation; CSV/JSON import; a nightly cron that re-syncs every company | a CSV of company numbers imported through the API produces officer and PSC rows with a verification state and a next-confirmation-statement date, on stage and prod, with no Companies House key present |
| CH2 — the status board and the chase | the derived risk view, the chase-step state machine, `chase_messages`, the GOV.UK chase templates in `notifications-worker`, a daily chase cron, audit events | an unverified director on a company filing within 30 days receives a step-1 chase, the send is in the chase log and in the audit trail, and a second sweep escalates rather than repeats |
| CH3 — the at-risk report, the digest and the firm's roles | the at-risk report route with a streamed CSV rendering, a weekly firm digest email, the `chaseid.*` permissions on the baseline's RBAC, metering of companies under management against the plan quota | a firm member with the reviewer role can download this month's at-risk CSV and cannot import; the weekly digest names the filings at risk; importing past the plan's company quota is refused with the baseline's quota error |
