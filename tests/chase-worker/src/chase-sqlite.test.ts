import { createSqlExecutor } from "@saas/db/d1";
import { createChaseRepository } from "@saas/db/chase";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";
import { FixtureCompaniesHouseProvider } from "@chase-worker/provider/fixture";
import { sweepCompanies } from "@chase-worker/sync";
import { sweepChases, windowCutoff, type ChaseDeps } from "@chase-worker/chase";
import { d1Over, migratedDatabase } from "./sqlite-harness";

// The CH2 "done when", run against a REAL SQLite engine over every migration:
// a fixture-seeded org, the morning sweep, then the same sweep again the same
// day, then a week later. D1 is SQLite, so SQL that runs here runs there.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-23T09:00:00.000Z");
const ORG = "5a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";

async function seededWorld() {
  const db = migratedDatabase();
  const executor = createSqlExecutor(d1Over(db));
  const repo = createChaseRepository(executor);
  let clock = NOW;
  const enqueued: EnqueueNotificationRequest[] = [];

  // HARBOURSIDE (00000001) files in 12 days; PENNINE (00000002) in 120.
  const companies = [];
  for (const number of ["00000001", "00000002"]) {
    const up = await repo.upsertCompany({ id: crypto.randomUUID(), orgId: ORG, companyNumber: number, source: "csv" });
    if (!up.ok) throw new Error("seed failed");
    companies.push(up.value.company);
  }
  await sweepCompanies(repo, new FixtureCompaniesHouseProvider(() => NOW), ORG, companies, "import", undefined, NOW);
  await repo.setContactEmailByName(companies[0]!.id, "Adaeze Ngozi Okonkwo", "adaeze@example.com");
  await repo.setContactEmailByName(companies[1]!.id, "Callum James Abernethy", "callum@example.com");

  const deps: ChaseDeps = {
    repo,
    transact: (fn) => executor.transaction((tx) => fn(createChaseRepository(tx), tx)),
    enqueue: async (request) => {
      enqueued.push(request);
      return { ok: true as const, notificationId: `ntf_${enqueued.length}` };
    },
    now: () => clock,
  };

  const count = (sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);

  return {
    repo,
    deps,
    enqueued,
    messages: () => count("SELECT count(*) AS n FROM chase_messages"),
    audits: () => count("SELECT count(*) AS n FROM events_event_log WHERE type = 'chase.director.chased'"),
    steps: () =>
      db
        .prepare("SELECT name, chase_step FROM chase_people WHERE contact_email IS NOT NULL ORDER BY name")
        .all() as Array<{ name: string; chase_step: number }>,
    advance(days: number) {
      clock = new Date(clock.getTime() + days * DAY);
    },
    async sweep() {
      const candidates = await repo.listChaseCandidates(windowCutoff(clock), 200);
      if (!candidates.ok) throw new Error("candidates failed");
      return sweepChases(deps, candidates.value, "req_sqlite");
    },
  };
}

describe("the chase against real SQLite", () => {
  it("chases only the unverified person inside the window, once a day, escalating weekly", async () => {
    const w = await seededWorld();

    const first = await w.sweep();
    expect(first.sent).toBeGreaterThan(0);
    const sentFirst = w.messages();
    expect(sentFirst).toBe(first.sent);
    expect(w.audits()).toBe(sentFirst);
    // Nobody at PENNINE is chased: it files in 120 days, and its director has verified.
    expect(w.enqueued.every((e) => e.templateData?.companyNumber === "00000001")).toBe(true);
    expect(w.enqueued.every((e) => e.templateKey === "chase.first_notice")).toBe(true);
    const chased = w.steps().filter((row) => row.chase_step > 0);
    expect(chased.every((row) => row.chase_step === 1)).toBe(true);

    const again = await w.sweep();
    expect(again.sent).toBe(0);
    expect(w.messages()).toBe(sentFirst);

    w.advance(7);
    const week = await w.sweep();
    expect(week.sent).toBe(first.sent);
    expect(w.steps().filter((row) => row.chase_step > 0).every((row) => row.chase_step === 2)).toBe(true);
    expect(w.enqueued.slice(sentFirst).every((e) => e.templateKey === "chase.reminder")).toBe(true);
  });

  it("filters the board by derived risk with the same predicate the badge uses", async () => {
    const w = await seededWorld();
    const cutoff = windowCutoff(NOW);
    const atRisk = await w.repo.listPeople({ orgId: ORG, limit: 50, offset: 0, risk: "at_risk", riskCutoff: cutoff });
    const ok = await w.repo.listPeople({ orgId: ORG, limit: 50, offset: 0, risk: "ok", riskCutoff: cutoff });
    if (!atRisk.ok || !ok.ok) throw new Error("list failed");
    expect(atRisk.value.length).toBeGreaterThan(0);
    expect(atRisk.value.every((p) => p.companyNumber === "00000001" && p.verificationState !== "verified")).toBe(true);
    expect(ok.value.every((p) => p.companyNumber === "00000002")).toBe(true);
  });
});
