# chase-worker — overview

The Chaseid product's own bounded context: the register of client companies a
UK accountancy practice keeps, the nightly Companies House sweep that keeps
their officers, PSCs and confirmation-statement dates current, and the email
chase that pursues the people who have not verified their identity.

Everything else in this repository is the cirrus baseline. This worker is the
product. It owns four tables — `chase_companies`, `chase_people`,
`chase_sync_runs`, `chase_messages` — and nothing else owns them.

See `specs/epics/chaseid-director-verification/` for the epic.
