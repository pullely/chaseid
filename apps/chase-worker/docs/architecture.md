# chase-worker — architecture

Canonical baseline worker shape: `src/index.ts` exports `fetch` and
`scheduled`; `src/router.ts` is a regex dispatch table; `src/http.ts` carries
the `{ data, meta }` / `{ error }` envelopes; `src/ids.ts` encodes the public
ids; `src/membership-client.ts` and `src/policy-client.ts` are the
authorization seam, in that order, with a denial answering **404** rather than
403.

Three pieces are not baseline furniture:

- **`src/provider/`** — the `CompaniesHouseProvider` interface and its two
  implementations. `resolveProvider(env)` returns the HTTP one when
  `COMPANIES_HOUSE_API_KEY` is set and the recorded-fixture one otherwise.
  Every sync run records which served it, so fixture data is never mistaken
  for live data.
- **`src/sync.ts`** — one sweep over one company: fetch the profile, the
  officers and the PSCs, upsert what came back, write the run row. The cron
  and the manual sync button are the same function.
- **`src/risk.ts`** — the derived `risk` and `daysUntilDue`. Derived on read,
  never stored, computed in exactly one place.

Cron: `15 2 * * *` sweeps Companies House; `0 9 * * *` is the chase sweep
(CH2) and the Monday firm digest (CH3). `scheduled()` branches on
`controller.cron`.

`CHASE_CACHE` is a KV binding and is optional in `Env`: unbound, the worker
calls the provider every time rather than failing.
