# chaseid-launch-readiness — implementation plan

Milestones land in order. Each is one or more tasks, each task one pull
request, landed with `orun pr land`. A milestone is marked ✅ here when its
"done when" list is true, and recorded in `IMPLEMENTATION-STATUS.md`.

## CL0 — the spec

This doc set, merged to `main` and attached to the epic with `orun spec push`.

**Done when**
- the five documents are on `main`
- `orun spec list --epic chaseid-launch-readiness` shows them

## CL1 — a truthful board

`apps/chase-worker/src/people.ts` (the person, §2.1); `present.ts` and
`report.ts` count persons and split `unknown`; `chase.ts` keys the notification
on the person; `packages/contracts/src/chase.ts` gains `unknownCount` on the
company and `unknownCount`/`unknownNames` on the report row; the console's
companies and report pages and `components/chase/chase.ts` show them, with the
Overdue and Dissolved badges. Row risk follows company risk (§2.5).

**Done when**
- against the recorded fixtures, `presentCompany` reports Tay Valley as 2 people, 1 unverified, 1 unknown and Harbourside as 2 people, 1 unverified — asserted in `tests/chase-worker`
- the at-risk report names each human once, with `unknown` people in their own column, and the CSV header is the old six columns followed by `unknown_count,unknown_names`
- two rows of one human with one address produce one notification idempotency key per step; two different addresses produce two
- a verified person on an at-risk company badges "At risk" on the board
- the console shows "Overdue" for an at-risk filing whose date has passed, and "Dissolved" for a dissolved company

## CL2 — the first ten minutes

Org root → status board; onboarding (firm name + first import); the import
dialog's file input, template, success summary and query invalidation; the
fixture banner's contrast; the project picker hidden; the company page.

**Done when**
- a new stage sign-up reaches a populated status board in one flow
- the import dialog closes on success and the new rows are on screen without a reload
- no surface a firm reaches mentions projects

## CL3 — the firm, its team and its plan

The firm console profile; the plan picker in companies and GBP; the companies
meter; hidden platform entitlements; Settings › Chase policy.

**Done when**
- an owner invites a colleague who signs in and sees the same board, and the viewer role cannot import
- Billing shows "N of 10 companies" on the free plan and the plan cards say companies and £
- changing the chase window to 45 days changes which companies badge "At risk"

## CL4 — the front door

The public landing, pricing and legal pages; Chaseid's metadata, favicon and
mark; prod sign-in without the bearer tab; the custom domain; the licence.

**Done when**
- a signed-out visit to the prod console shows the landing page, and `/pricing`, `/privacy`, `/terms`, `/aup` answer 200
- the prod sign-in page has no bearer-token tab and no env badge
- `https://api.chaseid.app/health` and `https://app.chaseid.app` answer 200
- the repository has a LICENSE the openproduct listing detects

## Sequencing

CL1 first: it changes numbers, and every later screenshot, onboarding and
landing page should show the true ones. CL2 before CL3 because the firm profile
switch (CL3) re-exposes baseline pages that CL2's shell work has to hide
correctly. CL4 last; its landing page reuses CL2's screens.
