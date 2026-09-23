-- 220_chase_sync_runs: one row per Companies House sweep (CH1).
--
-- Context: chase
-- Epic: chaseid-director-verification (CH1).
--
-- `provider` is load-bearing, not diagnostics. A run served by the recorded
-- fixture implementation is labelled 'fixture' and the console says so, so
-- fixture data can never be mistaken for live Companies House data while the
-- account has no API key (risks-and-open-questions.md CH-A).

CREATE TABLE IF NOT EXISTS chase_sync_runs (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  org_id                TEXT NOT NULL,
  trigger               TEXT NOT NULL DEFAULT 'manual'
                          CHECK (trigger IN ('cron', 'manual', 'import')),
  -- column chase_sync_runs.provider: which CompaniesHouseProvider served it.
  provider              TEXT NOT NULL DEFAULT 'fixture'
                          CHECK (provider IN ('http', 'fixture')),
  started_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at           TEXT,
  companies_scanned     INTEGER NOT NULL DEFAULT 0,
  people_upserted       INTEGER NOT NULL DEFAULT 0,
  errors                INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_chase_sync_runs_org_started
  ON chase_sync_runs (org_id, started_at DESC, id DESC);
