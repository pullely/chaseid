import {
  formatDaysUntilDue,
  formatPeopleCounts,
  normaliseCompanyNumber,
  parseRegisterCsv,
  reportFileName,
  riskBadge,
  RISK_VARIANT,
} from "@web-console-next/components/chase/chase";
import { buildNavSections } from "@web-console-next/components/shell/nav-items";
import { qk } from "@web-console-next/lib/query-keys";

describe("Chaseid console helpers (CH2)", () => {
  it("parses the register CSV into one entry per company with its contacts", () => {
    const csv = [
      "company_number,person_name,person_email",
      "1,Jane Director,jane@example.com",
      "00000001,Bob Secretary,bob@example.com",
      "SC000003,,",
      "not a number!,x,y",
      "",
    ].join("\n");
    const parsed = parseRegisterCsv(csv);
    expect(parsed.skipped).toBe(1);
    expect(parsed.companies).toEqual([
      {
        companyNumber: "00000001",
        contacts: [
          { name: "Jane Director", email: "jane@example.com" },
          { name: "Bob Secretary", email: "bob@example.com" },
        ],
      },
      { companyNumber: "SC000003", contacts: [] },
    ]);
  });

  it("pads numeric company numbers to eight and keeps prefixed ones", () => {
    expect(normaliseCompanyNumber(" 1234 ")).toBe("00001234");
    expect(normaliseCompanyNumber("sc123456")).toBe("SC123456");
    expect(normaliseCompanyNumber("123456789")).toBeNull();
  });

  it("reads days until due the way a practice would say it", () => {
    expect(formatDaysUntilDue(null)).toBe("—");
    expect(formatDaysUntilDue(-3)).toBe("3d overdue");
    expect(formatDaysUntilDue(0)).toBe("today");
    expect(formatDaysUntilDue(12)).toBe("12d");
  });

  it("paints at-risk red", () => {
    expect(RISK_VARIANT.at_risk).toBe("destructive");
  });

  it("puts the Chaseid section first, under both profiles", () => {
    for (const solo of [false, true]) {
      const sections = buildNavSections({ orgSlug: "acme" }, solo);
      expect(sections[0]!.id).toBe("chase");
      expect(sections[0]!.links.map((l) => l.href)).toEqual([
        "/orgs/acme/chase/directors",
        "/orgs/acme/chase/companies",
        "/orgs/acme/chase/messages",
        "/orgs/acme/chase/report",
      ]);
    }
  });

  it("gives each board filter its own cache entry under one invalidation prefix", () => {
    expect(qk.chaseDirectors("org_1", "unverified:all")).not.toEqual(qk.chaseDirectors("org_1", "all:at_risk"));
    expect(qk.chaseDirectors("org_1", "x").slice(0, 2)).toEqual(["chaseDirectors", "org_1"]);
  });

  it("names the downloaded report after the firm and the day", () => {
    expect(reportFileName("Acme/../x", new Date("2026-09-23T10:00:00Z"))).toBe("chaseid-at-risk-acmex-2026-09-23.csv");
  });
});

describe("Chaseid console badges and counts (CL1)", () => {
  it("reads an at-risk filing whose date has passed as Overdue", () => {
    expect(riskBadge("at_risk", -5)).toEqual({ label: "Overdue", variant: "destructive" });
    expect(riskBadge("at_risk", 12)).toEqual({ label: "At risk", variant: "destructive" });
    expect(riskBadge("due_soon", -1).label).toBe("Due soon");
  });

  it("shows a dissolved or liquidating company's status instead of a risk", () => {
    expect(riskBadge("ok", null, "dissolved")).toEqual({ label: "Dissolved", variant: "outline" });
    expect(riskBadge("at_risk", 3, "liquidation").label).toBe("Liquidation");
    expect(riskBadge("ok", 120, "active").label).toBe("OK");
  });

  it("names unknown people apart from unverified ones, and only when there are any", () => {
    expect(formatPeopleCounts(2, 1, 1).detail).toBe("1 unverified · 1 unknown");
    expect(formatPeopleCounts(2, 1, 0).detail).toBe("1 unverified");
  });
});
