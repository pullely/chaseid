# chaseid-launch-readiness — design

No new bounded context. Every change lands in a Worker, package or console
surface CH already built or the cirrus baseline already ships.

## 1. What the walk-through found

Browsed on 2026-09-23 against `chaseid-web-console-next-{stage,prod}.nexo-7be.workers.dev`
and `chaseid-api-edge-{stage,prod}…/health`. Stage: a fresh sign-up with the
on-screen debug code, then a CSV import of the four recorded-fixture companies
(`00000001`, `00000002`, `SC000003`, `00000004`) with two contact rows.

| # | Where | What a firm sees | Why (code) | Milestone |
|---|---|---|---|---|
| F1 | Companies, report | Tay Valley "3 (3 unverified)"; Harbourside "3 (2 unverified)". The fixtures hold 2 humans each. | Fiona Macarthur and Adaeze Okonkwo are each an officer row *and* a PSC row; `presentCompany` counts rows (`apps/chase-worker/src/present.ts`) | CL1 |
| F2 | Companies, report | Ousmane Dembele listed under "Unverified" | `present.ts` and `report.ts` count `verificationState !== "verified"`, so `unknown` is reported as unverified; the board (state filter) says "Unknown" | CL1 |
| F3 | Chase | Adaeze would receive every step twice, once per role | the idempotency key is `chase:<prs>:<step>` — per row (`apps/chase-worker/src/chase.ts`) | CL1 |
| F4 | Board | Tomasz Przybylski (verified) on an at-risk company shows "Due soon" | `presentDirector` derives risk from the row's own state, while its comment says a person's risk is their company's | CL1 |
| F5 | Companies, board | "5d overdue" and "12d" both badge "At risk"; a dissolved company badges "OK" | `ChaseRisk` has no overdue value; the console maps `companyStatus` to nothing | CL1 (console only) |
| F6 | First run | A new firm lands on Settings › General, named `firm.tester+cid`, slug `personal-usr-<hex>`; "Renaming an account isn't available" | `app/(app)/orgs/[orgSlug]/page.tsx` redirects to `settings` under `SOLO_MODE` | CL2 |
| F7 | Import | After Import the dialog stays on "Importing…"; the rows appear only after a reload. No file picker, no template | `chase/companies/page.tsx` import dialog | CL2 |
| F8 | Companies | "recorded fixture data — no Companies House key configured" is dark-yellow on brown — unreadable | the `warning` badge variant on a dark surface | CL2 |
| F9 | Shell | "Select project" picker in the top bar; the empty Projects page one click away | baseline shell, not gated by the firm profile | CL2 |
| F10 | Team | No Members, Invitations or Audit in Settings — a firm cannot add staff or show its audit trail | `SOLO_MODE=true` in `next.config.mjs` suppresses them (`SOLO_SUPPRESSED_PATHS`) | CL3 |
| F11 | Billing | Plans "Free / Pro $20 / Business $99", "Up to 3 projects"; entitlements list `limit.projects`, `limit.environments` | the baseline catalog's display copy (CH3 left prices alone, `CH3` departure) | CL3 |
| F12 | Settings | The chase window (30 days) and interval (7 days) are constants a firm cannot see or change | `CHASE_RISK_WINDOW_DAYS`, `CHASE_STEP_INTERVAL_DAYS` in `packages/contracts/src/chase.ts` | CL3 |
| F13 | Front door | `/` redirects straight to sign-in; `/pricing`, `/privacy`, `/terms` 404; "Acceptable Use Policy" is plain text; no favicon; meta description is the baseline's ("control plane for your projects…"); logo is "S" | baseline console | CL4 |
| F14 | Prod sign-in | "Bearer token" tab and "locked to prod" / "paste a bearer token for prod testing" copy shown to customers | baseline login | CL4 |
| F15 | Domain, repo | `api.chaseid.app` / `app.chaseid.app` do not resolve (phase 07 never run); the public repo has no LICENSE | `ai/context/deployment.md` | CL4 |

## 2. CL1 — a truthful board

### 2.1 The person

A **person** is the set of live rows on one company whose names normalise to
the same key. The key is `normaliseName(stripHonorifics(name))`:
`normaliseName` is the sorted-token-set normaliser `packages/db/src/chase/repository.ts`
already uses to match the firm's CSV contacts, so `"OKONKWO, Adaeze Ngozi"`
and `"Adaeze Ngozi Okonkwo"` agree by construction. `stripHonorifics` drops a
leading `Mr|Mrs|Ms|Miss|Mx|Dr|Sir|Dame|Lord|Lady` token, because PSC names
carry a title and officer names do not.

The helper lives in `apps/chase-worker/src/people.ts`:

```
personKey(name): string
groupPeople(rows): PersonGroup[]      // per company, stable order
personState(group): "unverified" | "unknown" | "verified"   // the worst
displayName(group): string            // "Forename Surname": the PSC form if
                                      // present, else "SURNAME, Forename" flipped
```

Rows are not merged in D1. Each role keeps its own verification state,
provider key and chase step — Companies House verifies a person once but
records the verification per appointment, and a role-level gap is what blocks
the filing.

### 2.2 The counts

`PublicChaseCompany` gains one field; the others change meaning, not shape:

```
peopleCount       distinct persons among live rows          (was: rows)
unverifiedCount   persons whose state is unverified           (was: rows not verified)
unknownCount      persons whose state is unknown              NEW
```

`risk` is unchanged in definition — at risk when a person is `unverified` **or**
`unknown` inside the window — so no filter, badge or cron changes behaviour; only
the numbers beside them become true.

### 2.3 The report

`ChaseAtRiskCompanyRow` gains `unknownCount` and `unknownNames`; `unverifiedNames`
lists display names of persons, once each. The CSV keeps its six columns in
order and appends `unknown_count,unknown_names`, so a spreadsheet keyed on
the old headers still lines up.

### 2.4 One email per human per step

The chase's notifications idempotency key becomes

```
chase:<company uuid hex>:<fnv1a32(personKey + "|" + lower(email))>:<step>
```

Two rows of one human with the same address therefore collapse to one
notification; each row still gets its own `chase_messages` entry (it carries
the shared `notification_id`) and advances its own step, so the AML file shows
both roles were chased and by which email. Two roles with **different**
addresses are two keys and two emails — the firm said so.

### 2.5 The row's risk

`presentDirector` takes the company's risk. The board's list query already
joins the company; the fix adds the company's unaccounted-person count to that
read (one grouped sub-select), so the row badge and the company badge can never
disagree.

### 2.6 The console

`RISK_LABEL` gains a display-only override: an `at_risk` row with
`daysUntilDue < 0` reads **Overdue**. A company whose `companyStatus` is
`dissolved` or `liquidation` badges its status instead of a risk. The
companies page reads `3 · 1 unverified · 1 unknown`; the report shows an
"Unknown" column beside "Unverified".

## 3. CL2 — the first ten minutes

- `app/(app)/orgs/[orgSlug]/page.tsx` redirects to `chase/directors`, under
  both profiles.
- `/onboarding` asks two things: the firm's name (sets the org's display name
  and slug through the membership route the baseline already has) and a CSV —
  the same import call the Companies page makes — then lands on the board.
- The import dialog: a file input beside the paste box, a "download template"
  link (a static `company_number,person_name,person_email` CSV), and on success
  it closes and toasts `Imported 4 · updated 0 · skipped 0 · 2 contacts matched`,
  invalidating the companies and directors queries.
- The fixture banner uses an outlined, high-contrast variant and links to
  `CL-A` in the risks doc.
- The top-bar project picker is hidden when the firm profile is on.
- Company rows link to a company page backed by the existing
  `GET …/chase/companies/{cmp}` (company plus directors).

## 4. CL3 — the firm, its team and its plan

- `NEXT_PUBLIC_SOLO_MODE` becomes `false` for this instance, and a new
  `NEXT_PUBLIC_PROFILE=firm` keeps projects, environments and usage suppressed
  while restoring members, invitations and audit. The API edge's Solo route
  suppression follows the same switch.
- The plan picker reads the `limit.chase_companies` entitlement and a GBP
  price per plan from the billing catalog's display fields; the cards list
  companies, members and chase features, never projects.
- Billing shows a `companies_under_management` meter against the allowance.
- Settings › Chase policy: the risk window and the chase interval stored in
  the baseline's `config_settings` under `chase.window_days` and
  `chase.interval_days`, read by the sweep with the contracts constants as
  defaults.

## 5. CL4 — the front door

- `/` for a signed-out visitor is a static landing page (what it does, the
  three screens, pricing, a sign-in button); signed-in visitors keep the
  current redirect.
- `/pricing`, `/privacy`, `/terms`, `/aup` as static pages; the sign-in
  footer links the AUP.
- The console's `metadata` (title, description, OpenGraph), a favicon and the
  "C" mark replace the baseline's.
- In `prod` the login page shows email code only and no env badge; stage
  keeps the bearer tab and the on-screen debug code.
- Phase 07 of the baseline (custom domain) is run for `chaseid.app`.
- A LICENSE file is added (the owner picks it; see `CL-D`).

## 6. Out of scope

A live Companies House key (tracked as CH-A, a credential not code); PDF
reports; SMS chases; new-appointment watch; merging officer and PSC rows in
storage.
