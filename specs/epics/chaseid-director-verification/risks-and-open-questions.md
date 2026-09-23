# chaseid-director-verification — risks and open questions

Each entry is a letter, a title, and a state: **RISK** (open, with a
mitigation), **RESOLVED** (decided; say what and why), **ACCEPTED** (a cost we
carry knowingly), **SETTLED** (decided for now; revisit on a stated cadence).

## CH-A — there is no Companies House API key (RISK, open, mitigated)

The whole product reads the Companies House Public Data API, and this build has
no key for it. A key is free and self-service — register at
`developer.company-information.service.gov.uk`, create an application, take the
REST key, and it is used as HTTP Basic with the key as the username and an
empty password — but nobody has done it for this account, and a build cannot
sign up on a person's behalf.

**Mitigation, and why this is not a blocker.** Companies House is reached only
through `CompaniesHouseProvider` (`apps/chase-worker/src/provider/`).
`resolveProvider(env)` returns `HttpCompaniesHouseProvider` when
`COMPANIES_HOUSE_API_KEY` is present and `FixtureCompaniesHouseProvider`
otherwise, the same shape `apps/notifications-worker/src/providers/index.ts`
already uses for email. The fixture implementation serves recorded responses
from `apps/chase-worker/src/provider/fixtures/*.json` in the documented API's
own shapes, so import, sync, the board, the chase state machine, the report and
the digest are all demonstrable end to end with no key at all. The key is
declared `optionalSecretEnv` in `apps/chase-worker/component.yaml`, so its
absence is not a deploy failure, and the day one is published to the workspace
the HTTP implementation takes over with no code change.

**What stays untested until a key exists**: the live API's pagination past 35
officers, its 600-requests-per-five-minutes throttle, and the exact spelling of
the verification fields on live officer and PSC records. Every sync run records
which implementation served it (`chase_sync_runs.provider`) and the console
shows it, so fixture data can never be mistaken for live data.

**To close it**: publish `COMPANIES_HOUSE_API_KEY` to the workspace
(`orun secrets create COMPANIES_HOUSE_API_KEY --project chaseid --env stage`,
then `prod`), redeploy `chase-worker`, and confirm a manual sync reports
`provider: "http"`.

## CH-B — the firm report is CSV only (RESOLVED)

The brief asks for the firm report as "CSV/PDF". This was written up as a
**RISK** on 2026-09-23 because R2 was not enabled on the Cloudflare account
(`10042 Please enable R2 through the Cloudflare Dashboard`) and a rendered PDF
has to be stored somewhere. **That fact changed the same day**: the account
operator enabled R2, and the portfolio runbook now says so. The risk as
written no longer exists and is recorded here as resolved rather than quietly
deleted.

**The decision stands anyway, for a better reason.** The report is CSV only,
streamed from `GET /v1/organizations/{org}/chase/report/at-risk?format=csv`
and generated per request. Storage was never the interesting part: a PDF needs
a rendering engine inside a Worker, which is a piece of work in its own right,
and a stored export is a snapshot that goes stale, has to be retained under the
firm's own policy, and has to be deleted when a client leaves. A per-request
CSV has none of those properties and is what a practice actually opens — in the
spreadsheet it already reconciles its filings in.

**If a firm does ask for PDF**, R2 is now there for it: add an
`infra/terraform/cloudflare-r2` component beside the existing D1 and KV ones,
publish a `WIRING_CLOUDFLARE_R2` document, and render into it from a later
milestone. Nothing in CH1–CH3 has to be unbuilt first.

## CH-C — the verification fields on the public API are three months old (RISK)

Identity verification only became mandatory on 18 November 2025, and the public
Companies House API began exposing verification details on officer and PSC
records around the same time. Field names and their null semantics are young
and may still move; the product's central derived value —
`verification_state` — reads them.

**Mitigation.** The provider layer is the only place that touches the wire
shape: it maps whatever the API returns onto the three-valued
`verified | unverified | unknown`, and an unrecognised or absent field maps to
`unknown`, never to `verified`. A board full of `unknown` is a visible,
recoverable failure; a board that silently says `verified` is not. A schema
drift is therefore one file's change, and the fixtures are the regression test.

## CH-D — chasing a real person by email is a deliverability and data-protection surface (ACCEPTED)

Chaseid sends unsolicited-looking email to named individuals who are not its
customers, about their legal obligations, on behalf of a third party. Getting
that wrong means spam complaints, a poisoned sending domain, and a GDPR
complaint against the firm that bought the product.

**Why carrying it is right, and what limits it.** The practice already has a
lawful basis and an existing relationship with these people — it is their
accountant, and chasing them is the job it is being paid for; Chaseid is the
same letter, sent on time. Concretely: addresses come only from the firm's own
CSV (`CH-E`), never from Companies House and never guessed; every send is
capped at three steps by `chase_people.chase_step` and idempotent per step, so
no clock can loop; every chase carries the firm's identity and the official
GOV.UK instructions, contains no token, link-back or credential the recipient
could be phished with, and tells the recipient to go to GOV.UK themselves; and
every send is recorded append-only in `chase_messages` and in the audit log, so
the firm can show an auditor exactly what was sent to whom and when. Suppression
lists and a per-org sending domain are the first things to add if complaints
appear.

## CH-E — Companies House does not publish personal email addresses (RESOLVED)

The register gives names, roles, appointment dates and verification status; it
gives no way to contact anyone. So how does a chase reach a director?

Three options were considered: (1) guess addresses from the company's domain,
(2) send everything to the practice and let it forward, (3) take addresses from
the firm. **Decision: (3), with (2) as the fallback.** The import CSV is
`company_number,person_name,person_email`, addresses are matched to synced
people on normalised name, and a person with no address simply never reaches
step 1 — they appear on the board as unchaseable, which is itself useful
information for the practice. Guessing was rejected outright: a wrong guess
sends a named individual's compliance status to a stranger.

## CH-F — the public API's rate limit against a 2,000-company book (SETTLED)

The Companies House Public Data API allows 600 requests per five minutes per
key. A 2,000-company firm needs three calls per company — profile, officers,
PSCs — so a naive nightly sweep is 6,000 calls and would be throttled for most
of an hour, and ten such firms share one key.

**Decided for now**: the sweep is batched and paced inside the cron invocation,
and every provider response is cached in the `CHASE_CACHE` KV namespace for 20
hours keyed `ch:v1:<companyNumber>`, so a manual re-sync right after the nightly
run costs nothing and a company synced by two firms is fetched once. A `429`
from the provider marks the company `last_sync_state = "provider_error"` and
leaves it for the next night rather than failing the run. **Revisit** when the
first firm crosses 500 companies, or as soon as a real key exists and the real
throttle can be measured — whichever comes first. The answer then is probably a
Queue and a longer sweep window, which is outside this epic.

## CH-G — the product has a deadline of its own (ACCEPTED)

The Companies House transition ends 18 November 2026. After it, every director
is either verified or in breach, and the "chase before your confirmation
statement" job mostly evaporates — which is exactly why the brief prices a
cheaper "new appointment watch" tier for afterwards.

We are building the transition product anyway, knowingly, because the fourteen
months in front of it are when the money is and because the register, the sync,
the board and the chase machine are the same machine the watch tier needs — the
watch is a different clock over the same tables, not a different product. The
epic's out-of-scope list names it, and nothing in CH1–CH3 has to be unbuilt to
get there.

## CH-H — the repository is under a user account, not the intended org (RISK, environmental)

The product was to be built under `github.com/orunbase-demo`. It is under
`github.com/pullely` instead, because the Orunbase control plane holds exactly
one active GitHub App installation — on the `pullely` **user** account — and
orun now refuses to call `github` connected unless the connection is to the
account that owns the repository, on the grounds that the platform sees a
repo's pushes and pull requests only through the installation on its owner.
Building under `orunbase-demo` would have produced a repository whose pull
requests the task plane could not see.

**Mitigation**: nothing in the product depends on the owner. Moving it is
`gh repo transfer` plus re-pointing the workspace's repo link, once the Orunbase
GitHub App is installed on `orunbase-demo` from the console's Integrations page
— a browser consent that no automation can give on a person's behalf.

## CH-I — SOLO_MODE was flipped off (SETTLED)

The cirrus baseline ships `SOLO_MODE: "true"`, which suppresses org members,
invitations and org-scoped API keys at the edge and hides them in the console:
the single-user B2C posture. Chaseid is sold to a practice with named staff and
CH3 gives those staff distinct roles, so CH1 sets it to `"false"` in `stage` and
`prod`, restoring the baseline's full multi-tenant surface.

This is a wider change than it looks — it un-hides several surfaces at once —
but it is the flag's documented purpose ("flip SOLO_MODE off and the full
multi-tenant baseline is restored unchanged"), and the chase routes themselves
are indifferent to it: `isSoloSuppressed` is a deny-list and matches none of
them. **Revisit** if the console's multi-tenant surfaces turn out to need work
the baseline has not kept green under the flag.

## CH-J — the baseline's multi-statement writes are Postgres SQL on a D1 stack (RISK)

Found while landing CH2. Three statements in the cirrus baseline's
`packages/db` are single Postgres data-modifying CTEs with `row_to_json`,
which SQLite — and therefore D1 — cannot parse (verified against stage D1 with
`EXPLAIN`): `events.appendEventWithAudit` (every audited write),
`membership.bootstrapOrganization` (creating an organization) and the
invitation-acceptance statement in `membership/repository.ts`. Upstream
`sourceplane/cirrus` `main` carries the same SQL, so every product on this
baseline is affected; stage and prod had no users or organizations when this
was found, which is why nothing had surfaced it.

**Done in CH2:** `appendEventWithAudit` rewritten as two portable statements
and redeployed with `chase-worker`. **Open:** the two membership statements —
without them no firm can create its organization or accept an invitation —
and the stale copy of the events statement bundled into every other baseline
worker until each is redeployed. CH3 ("the firm's roles") takes the
membership fix and redeploys `membership-worker`. The fix belongs upstream in
the baseline as well.

