# Epic: chaseid-launch-readiness (CL)

**Chaseid's engine works — import, nightly sync, the board, the chase, the log and the report all run on stage and prod — but a walk through the live console on 23 September 2026 shows a product a UK practice could not yet be sold: the board counts one human twice when they are both a director and a PSC (and would email them twice), calls a person Companies House said nothing about "unverified", files an overdue statement under the same badge as one due in a month, and lands a new firm on an empty Settings page named after its email address, with baseline plumbing (projects, a bearer-token sign-in, USD plans priced in "projects") where the product should be. This epic makes what the console says true, makes the first ten minutes lead somewhere, gives a firm its team and a plan priced in companies, and puts a public front door on `chaseid.app` — without adding a bounded context: every change lands in `chase-worker`, `packages/contracts`, the console and the edge that already exist.**

Found by browsing the live stage and prod consoles (a fresh sign-up with the on-screen code, a CSV import of the four recorded-fixture companies, every Chaseid page, Settings, Billing and the plan picker) and reading the code behind each surprise. The observations and their evidence are in `design.md` §1.

## Status

| Field | Value |
|-------|-------|
| Status | Draft |
| Cluster | **CL** (CL0–CL4) |
| Owner(s) | `apps/chase-worker` (counting, report, chase idempotency) · `packages/contracts` (the wire) · `apps/web-console-next` (first run, shell, plans, the public pages) · `apps/api-edge` + `infra` (the custom domain) |
| Builds on | `chaseid-director-verification` (CH, ✅ shipped, EP-2) on `cirrus baseline-v12` |
| Changes | No new tables, workers or routes in CL1–CL2. Additive wire fields (`unknownCount`, report `unknownCount`/`unknownNames`, two CSV columns appended at the end). CL3 changes the console profile (Solo → firm) and the plan catalog's display copy. CL4 adds public, unauthenticated console pages and the `chaseid.app` routes. |
| Decisions locked | (1) A **person** is a human per company: officer and PSC rows whose names normalise to the same sorted token set (`normaliseName`, already used for the CSV contact match) are one person for counting, reporting and chasing — the rows stay separate, because each role carries its own verification state. (2) A person's state is the **worst** of their roles (`unverified` > `unknown` > `verified`): a role-level gap is still a gap the filing will trip on. (3) `unknown` is never relabelled `unverified` on any surface; risk still treats it as unaccounted, because nobody has shown it is verified. (4) One email per human per step: the chase's idempotency key is the human's, not the row's. |
| Gate | CL1 changes numbers a firm may already have exported; the CSV only gains columns at the end, so a spreadsheet keyed on the old headers keeps working. |
| Shipped as | — |

## Read order

1. `design.md` — what the walk-through found, and the shape of each fix
2. `implementation-plan.md` — the milestones and what "done" means for each
3. `risks-and-open-questions.md` — what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md` — what actually shipped (kept distinct from intent)

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| CL0 — the spec | this doc set | merged and pushed with `orun spec push` |
| CL1 — a truthful board | person de-duplication across officer/PSC rows in the company counts, the at-risk report and the chase; `unknown` counted apart from `unverified`; an "Overdue" badge and a "Dissolved" badge in the console; a row's risk that matches its company's | the four fixture companies show Tay Valley as 2 people (1 unverified, 1 unknown) and Harbourside as 2 people (1 unverified); the report lists each human once; a human with one address on two roles receives one email per step |
| CL2 — the first ten minutes | the org root lands on the status board; a firm-name + first-import onboarding; the import dialog closes with an imported/updated/skipped/matched summary and takes a file; a legible fixture-data banner; the "Select project" picker gone under the firm profile; company rows open a company page | a new sign-up on stage reaches a populated board in one flow, and nothing on the way mentions projects |
| CL3 — the firm, its team and its plan | the console's firm profile (members, invitations and the audit trail visible; Solo off); the plan picker in companies and GBP (£29/100, £79/500, £199 unlimited) with a companies-used meter; platform-only entitlements hidden; the chase policy (window, interval) editable in Settings | an owner invites a colleague who signs in and sees the same board; Billing shows "4 of 10 companies"; the plan cards never say "projects" |
| CL4 — the front door | a public landing page at `/` for signed-out visitors, pricing, privacy, terms and the AUP (linked from sign-in); Chaseid's own favicon, logo and meta; no bearer-token tab and no env badge in prod; `app.chaseid.app` / `api.chaseid.app` live; a LICENSE in the repo | a signed-out visitor to prod sees what Chaseid does and what it costs before a sign-in form, and `https://api.chaseid.app/health` answers 200 |
