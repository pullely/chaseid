import type { ChaseAtRiskCompanyRow } from "@saas/contracts/chase";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";
import { csvCell, csvLine, wantsCsv } from "@chase-worker/report";
import { digestLines, digestWeek, isDigestDay, sendDigests, type DigestOrg } from "@chase-worker/digest";
import { decideCompaniesQuota } from "@chase-worker/billing-client";

const ROW: ChaseAtRiskCompanyRow = {
  companyNumber: "00000001",
  companyName: "Smith, Jones & Co",
  nextStatementDue: "2026-10-05",
  daysUntilDue: 12,
  unverifiedCount: 2,
  unverifiedNames: ["=HYPERLINK(\"http://x\")", 'Ann "AJ" Smith'],
  unknownCount: 0,
  unknownNames: [],
};

describe("the at-risk CSV", () => {
  it("quotes commas and quotes, and defuses spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(-5)).toBe("-5"); // a number is data, not a formula
    expect(csvCell(null)).toBe("");
  });

  it("renders one line per company with the names joined", () => {
    const line = csvLine(ROW);
    expect(line.startsWith('00000001,"Smith, Jones & Co",2026-10-05,12,2,')).toBe(true);
    // The names cell starts with a formula, so it is defused.
    expect(line).toContain(`"'=HYPERLINK`);
  });

  it("is chosen by ?format=csv or Accept: text/csv", () => {
    expect(wantsCsv(new Request("https://x/r?format=csv"))).toBe(true);
    expect(wantsCsv(new Request("https://x/r", { headers: { accept: "text/csv" } }))).toBe(true);
    expect(wantsCsv(new Request("https://x/r", { headers: { accept: "application/json" } }))).toBe(false);
  });
});

describe("the Monday firm digest", () => {
  const MONDAY = new Date("2026-09-21T09:00:00Z");

  it("runs on Mondays and keys by the week's Monday", () => {
    expect(isDigestDay(MONDAY)).toBe(true);
    expect(isDigestDay(new Date("2026-09-23T09:00:00Z"))).toBe(false);
    expect(digestWeek(new Date("2026-09-27T23:00:00Z"))).toBe("2026-09-21");
    expect(digestWeek(MONDAY)).toBe("2026-09-21");
  });

  it("sends one per member of an org with at-risk filings and none for an org with none", async () => {
    const sent: EnqueueNotificationRequest[] = [];
    const orgs: DigestOrg[] = [
      { orgId: "0f0e0d0c-0b0a-4908-8706-050403020100", rows: [ROW], chasesSentLastWeek: 4 },
      { orgId: "1f0e0d0c-0b0a-4908-8706-050403020100", rows: [], chasesSentLastWeek: 0 },
    ];
    const result = await sendDigests(
      {
        listRecipients: async (orgId) =>
          orgId.startsWith("0f")
            ? [
                { userId: "usr_a", email: "A@Firm.example", displayName: "Ann" },
                { userId: "usr_b", email: "b@firm.example", displayName: null },
              ]
            : [{ userId: "usr_c", email: "c@other.example", displayName: null }],
        enqueue: async (request) => {
          sent.push(request);
          return { ok: true as const, notificationId: "ntf_1" };
        },
        now: () => MONDAY,
      },
      orgs,
      "req_digest",
    );
    expect(result).toEqual({ orgs: 1, sent: 2, failed: 0 });
    expect(sent.map((s) => s.recipient.address)).toEqual(["a@firm.example", "b@firm.example"]);
    expect(sent.every((s) => s.templateKey === "chase.firm_digest")).toBe(true);
    expect(sent[0]!.idempotencyKey).toBe("chase.firm_digest:org_0f0e0d0c0b0a49088706050403020100:usr_a:2026-09-21");
    expect(sent[0]!.templateData).toMatchObject({ companiesAtRisk: 1, unverifiedPeople: 2, chasesSentLastWeek: 4 });
  });

  it("names ten companies and counts the rest", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ ...ROW, companyNumber: String(i).padStart(8, "0") }));
    const lines = digestLines(rows).split("\n");
    expect(lines).toHaveLength(11);
    expect(lines[10]).toBe("…and 2 more");
  });
});

describe("the plan's company allowance", () => {
  const allowed = (limitValue: number | null) =>
    ({
      allowed: true,
      orgId: "org_1",
      entitlementKey: "limit.chase_companies",
      valueType: "quantity",
      limitValue,
      source: "plan",
      subscriptionId: null,
    }) as const;

  it("allows up to the limit, refuses past it, and treats null as unlimited", () => {
    expect(decideCompaniesQuota(allowed(100), 100).kind).toBe("allow");
    expect(decideCompaniesQuota(allowed(100), 101)).toMatchObject({ kind: "deny", reason: "limit_reached", limit: 100 });
    expect(decideCompaniesQuota(allowed(null), 1_000_000).kind).toBe("allow");
  });

  it("fails closed on a missing entitlement", () => {
    expect(
      decideCompaniesQuota(
        { allowed: false, orgId: "org_1", entitlementKey: "limit.chase_companies", reason: "not_configured" },
        1,
      ).kind,
    ).toBe("deny");
  });
});
