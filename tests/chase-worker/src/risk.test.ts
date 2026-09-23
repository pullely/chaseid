import { CHASE_RISK_WINDOW_DAYS } from "@saas/contracts/chase";
import { daysUntilDue, deriveRisk } from "@chase-worker/risk";

const NOW = new Date("2026-09-23T11:00:00.000Z");

describe("daysUntilDue", () => {
  it("counts whole days to the confirmation statement", () => {
    expect(daysUntilDue("2026-10-03", NOW)).toBe(10);
    expect(daysUntilDue("2026-09-23", NOW)).toBe(0);
  });

  it("goes negative once the filing date has passed — overdue is more urgent, not less", () => {
    expect(daysUntilDue("2026-09-18", NOW)).toBe(-5);
  });

  it("is null when Companies House published no date, and for an unparseable one", () => {
    expect(daysUntilDue(null, NOW)).toBeNull();
    expect(daysUntilDue("not-a-date", NOW)).toBeNull();
  });

  it("ignores a time component, so a sync at 23:59 and one at 00:01 agree", () => {
    expect(daysUntilDue("2026-10-03T23:59:59Z", NOW)).toBe(10);
  });
});

describe("deriveRisk", () => {
  it("is at_risk only when someone inside the window has not verified", () => {
    expect(deriveRisk(10, 1)).toBe("at_risk");
    expect(deriveRisk(10, 0)).toBe("due_soon");
  });

  it("treats an overdue filing as at_risk, not as past caring", () => {
    expect(deriveRisk(-5, 2)).toBe("at_risk");
  });

  it("is ok outside the window however many are unverified", () => {
    expect(deriveRisk(CHASE_RISK_WINDOW_DAYS + 1, 5)).toBe("ok");
  });

  it("is ok when there is no date to reason about", () => {
    expect(deriveRisk(null, 5)).toBe("ok");
  });

  it("includes the window boundary itself", () => {
    expect(deriveRisk(CHASE_RISK_WINDOW_DAYS, 1)).toBe("at_risk");
  });
});
