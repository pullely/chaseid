-- 230_chase_messages: the AML file — one row per chase actually sent (CH1 schema, CH2 behaviour).
--
-- Context: chase
-- Epic: chaseid-director-verification (CH1 lands the table, CH2 writes to it).
--
-- Append-only by contract. Nothing in the product updates or deletes a row
-- here: it exists so a practice can show an auditor exactly what was sent to
-- whom, when, and with what outcome. `enqueue_result` records the
-- notifications-client's verdict verbatim, including its failure modes, so a
-- chase that never left the building is still on the record.

CREATE TABLE IF NOT EXISTS chase_messages (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  org_id                TEXT NOT NULL,
  person_id             TEXT NOT NULL,
  company_id            TEXT NOT NULL,
  -- column chase_messages.step: 1 first notice, 2 reminder, 3 escalation.
  step                  INTEGER NOT NULL,
  channel               TEXT NOT NULL DEFAULT 'email',
  to_address            TEXT NOT NULL,
  template_key          TEXT NOT NULL,
  notification_id       TEXT,
  -- column chase_messages.enqueue_result: the notifications-client verdict.
  enqueue_result        TEXT NOT NULL DEFAULT 'ok'
                          CHECK (enqueue_result IN ('ok', 'no_binding', 'non_2xx', 'network_error', 'bad_response')),
  sent_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_chase_messages_org_sent
  ON chase_messages (org_id, sent_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_chase_messages_person
  ON chase_messages (person_id, step);
