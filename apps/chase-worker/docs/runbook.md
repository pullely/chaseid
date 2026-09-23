# chase-worker — runbook

**The board is full of `unknown` verification states.** The provider returned
a shape the mapper did not recognise. That is the deliberate failure mode
(risks `CH-C`): an unrecognised field maps to `unknown`, never to `verified`.
Check `GET /v1/organizations/{org}/chase/sync-runs` for `provider` and
`errors`, then `src/provider/http.ts`'s `mapVerification`.

**Every sync run says `provider: "fixture"`.** Expected on an account with no
Companies House key. Publish `COMPANIES_HOUSE_API_KEY` to the workspace for
`stage` and `prod` and redeploy; `resolveProvider` switches with no code
change.

**A company is stuck on `last_sync_state: "provider_error"`.** The sweep
marks and moves on rather than failing the run. `last_sync_error` holds the
provider's message. A `429` there means the sweep is crowding the public API's
600-per-five-minutes budget — see `CH-F`.

**Nothing is being chased.** A person with no `contact_email` is never chased;
that is by design (`CH-E`). Companies House publishes no personal addresses,
so the firm supplies them in the import CSV.
