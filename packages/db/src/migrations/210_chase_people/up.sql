-- 210_chase_people: the directors, secretaries and PSCs the register watches (CH1).
--
-- Context: chase
-- Epic: chaseid-director-verification (CH1).
--
-- One row per person per company — the same human who is a director of four
-- client companies is four rows, because verification is recorded against the
-- appointment and the filing that is blocked is the company's.
--
--   * provider_person_key is Companies House's own appointment/PSC link,
--     which is stable per person per company; it is what an upsert matches on.
--   * verification_state is three-valued on purpose. An absent or
--     unrecognised field from the provider maps to 'unknown', never to
--     'verified' — see risks-and-open-questions.md CH-C.
--   * contact_email comes from the FIRM's import, never from Companies House,
--     which publishes no personal addresses (CH-E). A person without one is
--     visible on the board as unchaseable rather than silently skipped.
--   * chase_step is the three-step state machine CH2 drives; it is created
--     here, at 0, so CH2 adds behaviour and not schema.

CREATE TABLE IF NOT EXISTS chase_people (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  org_id                TEXT NOT NULL,
  company_id            TEXT NOT NULL,
  -- column chase_people.provider_person_key: the stable Companies House
  -- appointment or PSC link for this person on this company.
  provider_person_key   TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT 'officer'
                          CHECK (kind IN ('officer', 'psc')),
  name                  TEXT NOT NULL DEFAULT '',
  role                  TEXT NOT NULL DEFAULT 'unknown',
  appointed_on          TEXT,
  resigned_on           TEXT,
  -- column chase_people.verification_state: the product's whole point.
  verification_state    TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (verification_state IN ('verified', 'unverified', 'unknown')),
  verification_source   TEXT NOT NULL DEFAULT 'companies_house'
                          CHECK (verification_source IN ('companies_house', 'manual')),
  verified_on           TEXT,
  -- column chase_people.contact_email: supplied by the firm; NULL is normal.
  contact_email         TEXT,
  -- column chase_people.chase_step: 0 not chased, 1 first notice,
  -- 2 reminder, 3 escalation. Driven by CH2's sweep.
  chase_step            INTEGER NOT NULL DEFAULT 0,
  last_chased_at        TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chase_people_company_key
  ON chase_people (company_id, provider_person_key);

CREATE INDEX IF NOT EXISTS idx_chase_people_org_state
  ON chase_people (org_id, verification_state);

CREATE INDEX IF NOT EXISTS idx_chase_people_company
  ON chase_people (company_id);
