import type { ChaseCompany, ChasePerson, ChasePersonWithCompany } from "@saas/db/chase";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";
import { FixtureCompaniesHouseProvider } from "@chase-worker/provider/fixture";
import type { ProviderPerson } from "@chase-worker/provider/types";
import { countPeople, displayName, personKey, personState, recipientToken } from "@chase-worker/people";
import { presentCompany } from "@chase-worker/present";
import { buildAtRiskRows, CSV_HEADER, csvLine } from "@chase-worker/report";
import { chaseOne, type ChaseDeps } from "@chase-worker/chase";

const NOW = new Date("2026-09-23T11:00:00.000Z");

describe("personKey", () => {
  it("agrees on an officer's SURNAME, Forenames and a PSC's Forenames Surname", () => {
    expect(personKey("OKONKWO, Adaeze Ngozi")).toBe(personKey("Adaeze Ngozi Okonkwo"));
  });

  it("drops the title a PSC record carries", () => {
    expect(personKey("Mrs Fiona Macarthur")).toBe(personKey("MACARTHUR, Fiona"));
  });

  it("does not merge a different token set — a mismatch shows a human twice, never two as one", () => {
    expect(personKey("MACARTHUR, Fiona Jane")).not.toBe(personKey("Fiona Macarthur"));
  });
});

describe("personState", () => {
  it("is the worst of a person's roles, and never promotes unknown to unverified", () => {
    expect(personState([{ verificationState: "verified" }, { verificationState: "unverified" }])).toBe("unverified");
    expect(personState([{ verificationState: "verified" }, { verificationState: "unknown" }])).toBe("unknown");
    expect(personState([{ verificationState: "verified" }])).toBe("verified");
  });
});

describe("displayName", () => {
  it("prefers the PSC spelling and otherwise turns the officer's round", () => {
    expect(displayName([{ name: "OKONKWO, Adaeze Ngozi", kind: "officer" }, { name: "Adaeze Ngozi Okonkwo", kind: "psc" }])).toBe(
      "Adaeze Ngozi Okonkwo",
    );
    expect(displayName([{ name: "DEMBELE, Ousmane", kind: "officer" }])).toBe("Ousmane Dembele");
  });
});

const COMPANY_IDS: Record<string, string> = {
  "00000001": "0a0a0a0a-0000-4000-8000-000000000001",
  SC000003: "0a0a0a0a-0000-4000-8000-000000000003",
};

/** The recorded fixtures, as the rows a sync writes. */
async function fixtureRows(companyNumber: string): Promise<{ company: ChaseCompany; people: ChasePersonWithCompany[] }> {
  const provider = new FixtureCompaniesHouseProvider(() => NOW);
  const found = await provider.getCompany(companyNumber);
  const listed: ProviderPerson[] = [...(await provider.listOfficers(companyNumber)), ...(await provider.listPscs(companyNumber))];
  const company: ChaseCompany = {
    id: COMPANY_IDS[companyNumber]!,
    orgId: "org-uuid",
    companyNumber,
    companyName: found.companyName,
    companyStatus: found.companyStatus,
    nextStatementDue: found.nextStatementDue,
    lastSyncedAt: NOW.toISOString(),
    lastSyncState: "ok",
    lastSyncError: null,
    source: "csv",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  const people = listed.map((p, index): ChasePersonWithCompany => {
    const row: ChasePerson = {
      id: `${company.id.slice(0, 24)}${String(100 + index).padStart(12, "0")}`,
      orgId: company.orgId,
      companyId: company.id,
      providerPersonKey: p.providerPersonKey,
      kind: p.kind,
      name: p.name,
      role: p.role,
      appointedOn: p.appointedOn,
      resignedOn: p.resignedOn,
      verificationState: p.verificationState,
      verificationSource: "companies_house",
      verifiedOn: p.verifiedOn,
      contactEmail: null,
      chaseStep: 0,
      lastChasedAt: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    return { ...row, companyNumber, companyName: found.companyName, nextStatementDue: found.nextStatementDue };
  });
  return { company, people };
}

describe("the counts, against the recorded fixtures", () => {
  it("Tay Valley is 2 people: 1 unverified (a director who is also the PSC) and 1 unknown", async () => {
    const { company, people } = await fixtureRows("SC000003");
    const shown = presentCompany(company, people, NOW);
    expect(shown).toMatchObject({ peopleCount: 2, unverifiedCount: 1, unknownCount: 1, risk: "at_risk" });
  });

  it("Harbourside is 2 people: 1 unverified (director and PSC) and 1 verified", async () => {
    const { company, people } = await fixtureRows("00000001");
    expect(presentCompany(company, people, NOW)).toMatchObject({ peopleCount: 2, unverifiedCount: 1, unknownCount: 0 });
  });

  it("does not count a resigned role", async () => {
    const { people } = await fixtureRows("00000001");
    const resigned = people.map((p) => (p.kind === "psc" ? p : { ...p, resignedOn: "2026-01-01" }));
    expect(countPeople(resigned.filter((p) => !p.resignedOn))).toMatchObject({ peopleCount: 1 });
  });
});

describe("the at-risk report, against the recorded fixtures", () => {
  it("names each human once and keeps unknown people in their own column", async () => {
    const tay = await fixtureRows("SC000003");
    const harbour = await fixtureRows("00000001");
    const rows = buildAtRiskRows([...tay.people, ...harbour.people], NOW);

    const tayRow = rows.find((row) => row.companyNumber === "SC000003")!;
    expect(tayRow.unverifiedNames).toEqual(["Fiona Macarthur"]);
    expect(tayRow.unknownNames).toEqual(["Ousmane Dembele"]);
    expect(tayRow).toMatchObject({ unverifiedCount: 1, unknownCount: 1 });

    const harbourRow = rows.find((row) => row.companyNumber === "00000001")!;
    expect(harbourRow).toMatchObject({ unverifiedCount: 1, unverifiedNames: ["Adaeze Ngozi Okonkwo"], unknownCount: 0 });
  });

  it("appends the unknown columns after the original six", () => {
    expect(CSV_HEADER.slice(0, 6)).toEqual([
      "company_number",
      "company_name",
      "next_statement_due",
      "days_until_due",
      "unverified_count",
      "unverified_names",
    ]);
    expect(CSV_HEADER.slice(6)).toEqual(["unknown_count", "unknown_names"]);
    const line = csvLine({
      companyNumber: "SC000003",
      companyName: "TAY VALLEY",
      nextStatementDue: "2026-09-18",
      daysUntilDue: -5,
      unverifiedCount: 1,
      unverifiedNames: ["Fiona Macarthur"],
      unknownCount: 1,
      unknownNames: ["Ousmane Dembele"],
    });
    expect(line).toBe("SC000003,TAY VALLEY,2026-09-18,-5,1,Fiona Macarthur,1,Ousmane Dembele");
  });
});

describe("one email per human per step", () => {
  function deps(sent: EnqueueNotificationRequest[]): ChaseDeps {
    const repo = {
      recordChaseMessage: async (input: { id: string }) => ({ ok: true as const, value: { ...input, sentAt: NOW.toISOString() } }),
      advanceChaseStep: async () => ({ ok: true as const, value: undefined }),
    } as unknown as ChaseDeps["repo"];
    return {
      repo,
      transact: (fn) => fn(repo, null),
      enqueue: async (request) => {
        sent.push(request);
        return { ok: true, notificationId: "ntf_1" } as never;
      },
      now: () => NOW,
    };
  }

  it("keys a director who is also a PSC, at one address, identically — and two addresses apart", async () => {
    const { people } = await fixtureRows("00000001");
    const adaeze = people.filter((p) => personKey(p.name) === personKey("Adaeze Ngozi Okonkwo"));
    expect(adaeze).toHaveLength(2);

    const sent: EnqueueNotificationRequest[] = [];
    for (const row of adaeze) {
      await chaseOne(deps(sent), { ...row, contactEmail: "Adaeze@Example.com" }, { subjectType: "system", subjectId: "t" }, "req_t", "sweep");
    }
    expect(sent).toHaveLength(2);
    expect(sent[0]!.idempotencyKey).toBe(sent[1]!.idempotencyKey);
    expect(sent[0]!.idempotencyKey).toMatch(/^chase:cmp_[0-9a-f]{32}:[0-9a-f]{8}:1$/);

    const other: EnqueueNotificationRequest[] = [];
    await chaseOne(deps(other), { ...adaeze[0]!, contactEmail: "adaeze@example.com" }, { subjectType: "system", subjectId: "t" }, "req_t", "sweep");
    await chaseOne(deps(other), { ...adaeze[1]!, contactEmail: "a.okonkwo@practice.example" }, { subjectType: "system", subjectId: "t" }, "req_t", "sweep");
    expect(other[0]!.idempotencyKey).not.toBe(other[1]!.idempotencyKey);
  });

  it("is stable across case and whitespace in the address", () => {
    expect(recipientToken("OKONKWO, Adaeze Ngozi", " Adaeze@Example.com ")).toBe(recipientToken("Adaeze Ngozi Okonkwo", "adaeze@example.com"));
  });
});
