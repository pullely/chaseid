# chaseid-launch-readiness — risks and open questions

Each entry is a letter, a title, and a state: **RISK** (open, with a
mitigation), **RESOLVED** (decided; say what and why), **ACCEPTED** (a cost we
carry knowingly), **SETTLED** (decided for now; revisit on a stated cadence).

## CL-A — the board still runs on recorded fixtures (RISK, open)

Every observation in `design.md` §1 was made against the fixture provider;
CH-A (no Companies House API key) is still open. Name spellings on live
officer and PSC records may defeat the person key more often than the fixtures
suggest (middle names present on one role and absent on the other).
**Mitigation:** the key is conservative — it merges only on an identical token
set, so a mismatch shows a human twice (today's behaviour), never two humans as
one. Close CH-A before CL4's landing page quotes numbers.

## CL-B — two different humans with the same name on one company (ACCEPTED)

Father and son directors named identically would be counted and chased as one
person. **Accepted:** vanishingly rare on a single company, and when it happens
the firm supplies two addresses, which are two idempotency keys (§2.4) — the
chases still go to both; only the count is one low.

## CL-C — changed numbers in an export a firm already relies on (RESOLVED)

`unverified_count` in the CSV drops (unknowns and duplicate roles leave it).
**Resolved:** the old columns keep their positions and names, the new ones are
appended, and the release note says what the numbers now mean.

## CL-D — which licence (RISK, open — owner decision)

The openproduct listing's launch health and "Licence detectable" want a
LICENSE file. The repo is public; the product is a paid managed service. The
owner chooses (a source-available licence such as BUSL-1.1 or FSL, or a
permissive one). CL4 cannot close without the choice.

## CL-E — turning Solo off re-exposes baseline pages (RISK, mitigated)

`SOLO_MODE=false` brings back projects, environments and usage along with
members and audit. **Mitigation:** a separate `firm` profile flag (design §4)
suppresses the first three explicitly, and CL3's done-when says no surface
mentions projects.
