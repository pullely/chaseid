# chaseid-director-verification — design

Chaseid adds exactly one bounded context to the cirrus baseline: **the client
register and its verification chase**. It lives in a new Worker,
`apps/chase-worker`, whose tables are prefixed `chase_` in the same shared
per-environment D1 database (`chaseid-stage` / `chaseid-prod`) every other
worker uses — the baseline isolates by table prefix, not by database. Nothing
in identity, membership, policy, config, billing, metering, notifications,
webhooks or events changes shape; Chaseid consumes them exactly as
`projects-worker` does.

## 1. The resource

Four new tables. Ids follow the baseline's public-id grammar —
`<prefix>_<32 lowercase hex>`, a UUID with its dashes stripped, encoded and
parsed in `apps/chase-worker/src/ids.ts` over `uuidToHex` / `uuidFromPublicId`
from `@saas/db/ids`. Columns store the bare dashed UUID. Prefixes `cmp_`,
`prs_`, `syn_` and `chs_` are unused in the baseline (checked against the
register in `packages/db/src/ids/index.ts` and every worker's `ids.ts`).

### `chase_companies` — a client company on the firm's book

```
chase_companies
  id                          text        uuid; addressed as cmp_…
  org_id                      text        uuid; the firm (baseline organization)
  company_number              text        8 chars, Companies House; unique per org
  company_name                text        as last seen from Companies House
  company_status              text        active | dissolved | liquidation | unknown
  next_statement_due          text        ISO date; the confirmation-statement deadline
  last_synced_at              text        ISO timestamp, null until the first sync
  last_sync_state             text        ok | not_found | provider_error | never
  last_sync_error             text        nullable; the provider's message, truncated
  source                      text        csv | api | manual
  created_at                  text        ISO timestamp
  updated_at                  text        ISO timestamp
```

Unique index on `(org_id, company_number)` — re-importing the same CSV is an
upsert, not a duplicate. Index on `(org_id, next_statement_due)`, which is the
board's and the report's sort key.

### `chase_people` — a director, secretary or PSC of one of those companies

```
chase_people
  id                          text        uuid; addressed as prs_…
  org_id                      text        uuid
  company_id                  text        uuid → chase_companies.id (no FK; D1 convention)
  provider_person_key         text        the Companies House appointment/PSC link, stable per person per company
  kind                        text        officer | psc
  name                        text
  role                        text        director | secretary | llp-member | psc | unknown
  appointed_on                text        ISO date, nullable
  resigned_on                 text        ISO date, nullable — a resigned person leaves the board
  verification_state          text        verified | unverified | unknown
  verification_source         text        companies_house | manual
  verified_on                 text        ISO date, nullable
  contact_email               text        nullable; supplied by the FIRM, never by Companies House
  chase_step                  integer     0 = not chased, 1 = first notice, 2 = reminder, 3 = escalation
  last_chased_at              text        ISO timestamp, nullable
  created_at                  text
  updated_at                  text
```

Unique index on `(company_id, provider_person_key)`. Index on
`(org_id, verification_state)`.

### `chase_sync_runs` — one row per sync sweep, cron or manual

```
chase_sync_runs
  id                          text        uuid; addressed as syn_…
  org_id                      text        uuid
  trigger                     text        cron | manual
  provider                    text        http | fixture — WHICH implementation served this run
  started_at                  text
  finished_at                 text        nullable while running
  companies_scanned           integer
  people_upserted             integer
  errors                      integer
  created_at                  text
```

`provider` is load-bearing: a run served by the recorded-fixture provider is
labelled as such on the board and in the report, so nobody mistakes fixture
data for live Companies House data.

### `chase_messages` — the AML file: one row per chase actually sent

```
chase_messages
  id                          text        uuid; addressed as chs_…
  org_id                      text        uuid
  person_id                   text        uuid → chase_people.id
  company_id                  text        uuid → chase_companies.id
  step                        integer     1 | 2 | 3
  channel                     text        email
  to_address                  text
  template_key                text        chase.first_notice | chase.reminder | chase.escalation
  notification_id             text        nullable; ntf_… returned by notifications-worker
  enqueue_result              text        ok | no_binding | non_2xx | network_error | bad_response
  sent_at                     text
```

Append-only. Nothing in the product deletes or edits a row here; that is the
whole point of it existing.

### Reused unchanged

`identity_users`, `membership_organizations` / `_members` (the firm and its
staff), `config_settings` (the chase policy), `events_*` (audit and the domain
event log webhooks fan out from), `metering_*` (companies under management),
`billing_*` (the plan the quota comes from), `notifications_*` (the chases).

## 2. The API

Every route is org-scoped and reaches the worker through a new
`apps/api-edge/src/chase-facade.ts`, added to the `if/else if` chain in
`apps/api-edge/src/index.ts` with a `CHASE_WORKER` `Fetcher` in
`apps/api-edge/src/env.ts` and a `services` entry in both the `stage` and
`prod` blocks of `apps/api-edge/wrangler.template.jsonc` (plus the assertion
in `apps/api-edge/scripts/verify-bindings.mjs`). Envelopes are the baseline's,
unchanged: `{ data, meta: { requestId, cursor } }` on success and
`{ error: { code, message, details, requestId } }` on failure, with the closed
error set from `packages/contracts/src/errors.ts`. Authorization is the
baseline's order — `fetchAuthorizationContext(env.MEMBERSHIP_WORKER, …)` then
`authorizeViaPolicy(env.POLICY_WORKER, …)` — and a denial is **404, not 403**,
matching the baseline's deny-by-default rule.

```
POST   /v1/organizations/{org}/chase/companies/import    CH1
GET    /v1/organizations/{org}/chase/companies           CH1
GET    /v1/organizations/{org}/chase/companies/{cmp}     CH1
DELETE /v1/organizations/{org}/chase/companies/{cmp}     CH1
POST   /v1/organizations/{org}/chase/companies/{cmp}/sync CH1
GET    /v1/organizations/{org}/chase/sync-runs           CH1

GET    /v1/organizations/{org}/chase/directors           CH2
PATCH  /v1/organizations/{org}/chase/directors/{prs}     CH2
POST   /v1/organizations/{org}/chase/directors/{prs}/chase CH2
GET    /v1/organizations/{org}/chase/messages            CH2

GET    /v1/organizations/{org}/chase/report/at-risk      CH3
```

**Import** (`POST …/chase/companies/import`) accepts either
`application/json` `{ "companies": [{ "companyNumber": "01234567", "contacts": [{ "name": "…", "email": "…" }] }] }`
or `text/csv` with the header
`company_number,person_name,person_email` — one row per person, companies
deduplicated. It upserts companies, records the supplied contact emails
against people once the sync has discovered them (matched on normalised name),
emits `chase.company.imported` per company, meters
`companies_under_management`, and returns
`{ data: { imported, updated, skipped, syncRunId } }`. The quota check runs
**before** the first insert, so a firm over its plan's company allowance gets
the baseline's `rate_limited`/`precondition_failed` refusal rather than a
half-written register.

**The board** (`GET …/chase/directors`) is the product. Query parameters:
`?state=unverified|verified|unknown`, `?risk=at_risk|due_soon|ok`,
`?companyId=cmp_…`, `?cursor=`, `?limit=` (baseline cursor pagination from
`src/pagination.ts`). Each row carries the person, their company, the
company's `nextStatementDue`, a derived `daysUntilDue`, the derived `risk`,
their `chaseStep` and `lastChasedAt`.

`risk` is derived, never stored, and is computed in one place —
`apps/chase-worker/src/risk.ts`:

```
daysUntilDue = nextStatementDue - today            (null when unknown)
risk = "at_risk"  when daysUntilDue <= 30 and any person on the company is unverified
     = "due_soon" when daysUntilDue <= 30
     = "ok"       otherwise
```

**The report** (`GET …/chase/report/at-risk`) returns the at-risk companies
with their unverified people. `Accept: text/csv` or `?format=csv` renders the
same rows as a streamed `text/csv` response with
`content-disposition: attachment`, generated per request. Nothing is stored
(see `CH-B`): the report is a view of the register at the moment it is asked
for, and storing it would make a snapshot that goes stale and has to be
retained, deleted and explained.

**Internal seam.** `POST /v1/internal/chase/sync` on the worker, reachable
only over a service binding (never through api-edge), is what the cron calls
so the sweep and the manual button share one code path.

## 3. The console

Four pages under `apps/web-console-next/src/app/(app)/orgs/[orgSlug]/`,
registered in `src/components/shell/nav-items.ts`, reached through the
generated `@saas/sdk` client (`packages/sdk/src/chase.ts`, a `chase` field on
class `Chaseid`) and `useApiQuery` with new `qk` entries — never raw `fetch`.

| Page | What a user can do |
|---|---|
| `chase/companies/page.tsx` | see the client register, its per-company sync state and next statement date; import a CSV by drag-and-drop; trigger a re-sync; remove a company |
| `chase/directors/page.tsx` | **the status board** — every director and PSC across the book, filtered by verification state and risk, sorted by days until the filing; set a person's contact email; mark a person verified by hand; chase one now |
| `chase/messages/page.tsx` | the chase log, newest first, with the step, the address, the template and the result — the page an auditor is shown |
| `chase/report/page.tsx` | this month's filings at risk, and a **Download CSV** button hitting the same route with `format=csv` |

Each is the baseline's page shape: default export resolves `orgSlug` and wraps
`<OrgScope slug={slug}>`, an `Inner` component does the data work, mutations are
optimistic against the query cache with rollback.

`SOLO_MODE` is set to `"true"` in the baseline's
`apps/api-edge/wrangler.template.jsonc`, which suppresses the org
members/invitations surface at the edge. Chaseid is a firm product with named
staff, so CH1 flips `SOLO_MODE` to `"false"` in `stage` and `prod`. The chase
routes themselves are unaffected either way — `isSoloSuppressed` is a deny-list
and matches none of them — so this is about restoring the multi-user surface,
not about reaching the product.

## 4. Events, secrets, and integrations

**Audit and domain events.** Every write appends through
`eventsRepo.appendEventWithAudit(...)` inside the same `executor.transaction()`
as the business row, exactly as `apps/projects-worker/src/handlers/create-project.ts`
does — so the audit read surface (`GET /v1/organizations/{org}/audit`) and the
webhook fan-out in `apps/webhooks-worker/src/delivery.ts` both pick them up
with no further work. Categories are `chase`. Types:

| type | when |
|---|---|
| `chase.company.imported` | a company enters the register |
| `chase.company.removed` | a company leaves it |
| `chase.company.synced` | a sync sweep updated a company |
| `chase.director.chased` | a chase email was enqueued |
| `chase.director.verified` | a person's state moved to `verified` |
| `chase.report.exported` | an at-risk CSV was generated |

**Email.** Three templates are added to the `TEMPLATES` record in
`apps/notifications-worker/src/templates/index.ts` — `chase.first_notice`,
`chase.reminder`, `chase.escalation` — plus `chase.firm_digest` in CH3. Each is
a `TemplateRenderer` returning `{ subject, html, text }` built with the shared
`htmlShell()` and `escapeHtml()`. Every one carries the official GOV.UK
verification instructions and a link to the GOV.UK identity-verification start
page; none carries a token, a credential or anything a recipient could be
phished with — the recipient is told to go to GOV.UK themselves. Sends go
through `enqueueNotification` from `@saas/notifications-client` with
`category: "product"` and an idempotency key built with
`buildIdempotencyKey("chase", personPublicId, String(step))`, so a re-run of a
sweep cannot double-send a step.

**Cron.** Two triggers on `apps/chase-worker/wrangler.template.jsonc`, at the
template's top level so every env inherits them, matching the baseline's own
cron workers:

```jsonc
"triggers": { "crons": ["15 2 * * *", "0 9 * * *"] }
```

`15 2 * * *` is the nightly Companies House sweep (CH1); `0 9 * * *` is the
daily chase sweep (CH2), which also sends the weekly firm digest on Mondays
(CH3). The `scheduled()` handler in `apps/chase-worker/src/index.ts` branches
on `controller.cron`. The baseline's `integrations-worker` notes a former
five-cron account limit; this adds the sixth and seventh, and the account is on
the Workers Paid plan.

**The Companies House seam.** No provider connection and no brokered secret is
required to build or run this. `apps/chase-worker/src/provider/` holds:

```ts
export interface CompaniesHouseProvider {
  readonly kind: "http" | "fixture";
  getCompany(companyNumber: string): Promise<ProviderCompany | null>;
  listOfficers(companyNumber: string): Promise<ProviderPerson[]>;
  listPscs(companyNumber: string): Promise<ProviderPerson[]>;
}
```

`resolveProvider(env)` returns `HttpCompaniesHouseProvider` when
`env.COMPANIES_HOUSE_API_KEY` is present (declared `optionalSecretEnv` in
`apps/chase-worker/component.yaml`, so an absent key is not a deploy failure)
and `FixtureCompaniesHouseProvider` otherwise — the same shape the baseline
uses for `resolveProvider(env)` in `apps/notifications-worker/src/providers/index.ts`.
The fixture implementation reads recorded responses from
`apps/chase-worker/src/provider/fixtures/*.json`, captured from the public
Companies House API's documented response shapes, and every run it serves is
stamped `provider: "fixture"` on `chase_sync_runs` and surfaced in the console.
The HTTP implementation is written, typed and unit-tested against the same
fixtures; it is simply not exercised in this account until a key exists.

**KV.** One new namespace, `CHASE_CACHE`, bound on `apps/chase-worker` and
provisioned by the existing `infra/terraform/cloudflare-kv` component through a
new `chase_cache_kv_id` wiring key. It caches a company's provider response for
20 hours keyed `ch:v1:<companyNumber>`, so a manual re-sync immediately after
the nightly sweep costs no provider call and the sweep stays inside the public
API's 600-requests-per-five-minutes budget. Like `IDEMPOTENCY_KV` on api-edge
it is declared optional in `Env`; unbound, the worker calls the provider every
time rather than failing.

**Metering and billing.** `companies_under_management` is recorded to the
baseline's metering context on every import and on every nightly sweep, and the
import path calls the baseline's quota check before writing — that is how the
£29 / £79 / £199 tiers (100 / 500 / unlimited companies) are enforced, with no
Chaseid-specific billing code at all.

## 5. Out of scope

- **PDF reports.** The brief asks for CSV *or* PDF. R2 is available on this
  account, so storage is no longer the obstacle; what a PDF needs is a
  rendering engine in a Worker, which is its own piece of work and buys a
  practice nothing a CSV in its own spreadsheet does not. See `CH-B`.
- **The new-appointment watch** (the brief's M4 and its post-transition pricing
  tier). It needs a different clock — a change feed rather than a nightly
  full sweep — and belongs after the three milestones here.
- **SMS escalation.** The baseline has no SMS provider and this account holds
  no Twilio credential.
- **Filing to Companies House.** Chaseid never files anything. It watches
  public data and sends email; the filing stays with the practice.
- **Inbound email.** A director replying to a chase reaches the firm's own
  mailbox, not Chaseid. Cloudflare Email Routing on a domain we hold would be
  required, and `chaseid.app` is not registered.
- **Discovering contact addresses.** Companies House does not publish personal
  email addresses and Chaseid does not guess them. Addresses come from the
  firm's CSV or are typed on the board.
