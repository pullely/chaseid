-- 200_chase_companies: the client company register (CH1).
--
-- Context: chase
-- Epic: chaseid-director-verification (CH1) — the register a UK accountancy
--       practice keeps of the limited companies on its book, and the
--       confirmation-statement deadline that makes each one urgent.
--
-- Design rules (see specs/epics/chaseid-director-verification/design.md §1):
--   * Tenant-owned: org_id TEXT NOT NULL on every row; the org is the firm.
--   * company_number is Companies House's own key and is unique PER ORG —
--     two firms may both act for the same company and neither may see the
--     other's row.
--   * next_statement_due is the product's clock. It is a DATE as ISO text,
--     nullable until the first successful sync, and it is what the board and
--     the at-risk report sort on, hence the (org_id, next_statement_due) index.
--   * No foreign keys and IF NOT EXISTS throughout — the baseline's D1
--     convention (no interactive transactions, re-apply safety).

CREATE TABLE IF NOT EXISTS chase_companies (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  org_id                TEXT NOT NULL,
  -- column chase_companies.company_number: the Companies House company number,
  -- normalised to 8 upper-case characters (it is not always numeric — Scottish
  -- companies are SC……, limited partnerships OC…… and so on).
  company_number        TEXT NOT NULL,
  company_name          TEXT NOT NULL DEFAULT '',
  -- column chase_companies.company_status: Companies House's own company
  -- status, narrowed to the four the product reasons about.
  company_status        TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (company_status IN ('active', 'dissolved', 'liquidation', 'unknown')),
  -- column chase_companies.next_statement_due: ISO date of the next
  -- confirmation statement. NULL until a sync has answered.
  next_statement_due    TEXT,
  last_synced_at        TEXT,
  -- column chase_companies.last_sync_state: how the most recent sweep ended.
  -- 'never' is the state of a row that has been imported but not yet synced.
  last_sync_state       TEXT NOT NULL DEFAULT 'never'
                          CHECK (last_sync_state IN ('never', 'ok', 'not_found', 'provider_error')),
  last_sync_error       TEXT,
  -- column chase_companies.source: how the row entered the register.
  source                TEXT NOT NULL DEFAULT 'csv'
                          CHECK (source IN ('csv', 'api', 'manual')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Re-importing the same CSV is an upsert, never a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chase_companies_org_number
  ON chase_companies (org_id, company_number);

-- The board's and the report's sort key.
CREATE INDEX IF NOT EXISTS idx_chase_companies_org_due
  ON chase_companies (org_id, next_statement_due);

-- The nightly sweep's work queue: oldest sync first.
CREATE INDEX IF NOT EXISTS idx_chase_companies_sweep
  ON chase_companies (org_id, last_synced_at);
