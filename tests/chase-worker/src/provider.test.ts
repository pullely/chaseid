import { FixtureCompaniesHouseProvider } from "@chase-worker/provider/fixture";
import {
  HttpCompaniesHouseProvider,
  ProviderRateLimitedError,
  ProviderRequestError,
} from "@chase-worker/provider/http";
import { ProviderNotFoundError, mapVerification } from "@chase-worker/provider/types";
import { resolveProvider, resolveProviderKind } from "@chase-worker/provider/index";
import { RECORDED_COMPANIES_HOUSE } from "@chase-worker/provider/fixtures/companies";

const NOW = new Date("2026-09-23T11:00:00.000Z");

describe("mapVerification", () => {
  it("reads an explicit verification date", () => {
    expect(mapVerification({ identity_verified_on: "2026-02-11" })).toEqual({
      state: "verified",
      verifiedOn: "2026-02-11",
    });
  });

  it("accepts the appointment verification statement as verification", () => {
    expect(mapVerification({ appointed_on_verification_statement: "2026-01-04" })).toEqual({
      state: "verified",
      verifiedOn: "2026-01-04",
    });
  });

  it("calls a present-but-undated record unverified", () => {
    expect(mapVerification({ anti_money_laundering_supervisory_bodies: ["ICAEW"] })).toEqual({
      state: "unverified",
      verifiedOn: null,
    });
  });

  it("falls back to unknown, NEVER to verified, when the shape is not recognised", () => {
    // CH-C: these fields are three months old and may still move. A board
    // full of `unknown` is recoverable; one that silently says `verified` is
    // a firm filing late.
    expect(mapVerification(undefined).state).toBe("unknown");
    expect(mapVerification(null).state).toBe("unknown");
    expect(mapVerification("verified").state).toBe("unknown");
    expect(mapVerification(42).state).toBe("unknown");
  });
});

describe("FixtureCompaniesHouseProvider", () => {
  const provider = new FixtureCompaniesHouseProvider(() => NOW);

  it("identifies itself as the fixture implementation", () => {
    expect(provider.kind).toBe("fixture");
  });

  it("serves a company profile with a confirmation-statement date resolved to now", async () => {
    const company = await provider.getCompany("00000001");
    expect(company.companyName).toBe("HARBOURSIDE ACCOUNTING LIMITED");
    expect(company.companyStatus).toBe("active");
    expect(company.nextStatementDue).toBe("2026-10-05");
  });

  it("keeps one company inside the risk window and one already overdue", async () => {
    const soon = await provider.getCompany("00000001");
    const overdue = await provider.getCompany("SC000003");
    expect(Date.parse(soon.nextStatementDue!)).toBeGreaterThan(Date.parse("2026-09-23"));
    expect(Date.parse(overdue.nextStatementDue!)).toBeLessThan(Date.parse("2026-09-23"));
  });

  it("maps officers, including the resigned one and the verified one", async () => {
    const officers = await provider.listOfficers("00000001");
    expect(officers).toHaveLength(3);
    const byName = Object.fromEntries(officers.map((o) => [o.name, o]));
    expect(byName["OKONKWO, Adaeze Ngozi"]!.verificationState).toBe("unverified");
    expect(byName["PRZYBYLSKI, Tomasz"]!.verificationState).toBe("verified");
    expect(byName["HALVORSEN, Ingrid"]!.resignedOn).toBe("2025-06-30");
  });

  it("gives every officer a stable key that is not their name", async () => {
    const officers = await provider.listOfficers("00000001");
    for (const officer of officers) {
      expect(officer.providerPersonKey).toMatch(/^\/officers\//);
      expect(officer.providerPersonKey).not.toContain(officer.name);
    }
  });

  it("maps PSCs as their own kind", async () => {
    const pscs = await provider.listPscs("00000001");
    expect(pscs).toHaveLength(1);
    expect(pscs[0]!.kind).toBe("psc");
    expect(pscs[0]!.role).toBe("psc");
    expect(pscs[0]!.verificationState).toBe("unverified");
  });

  it("reads a dissolved company with no confirmation statement", async () => {
    const company = await provider.getCompany("00000004");
    expect(company.companyStatus).toBe("dissolved");
    expect(company.nextStatementDue).toBeNull();
  });

  it("raises not-found for a company it has never heard of, exactly as the live 404 does", async () => {
    await expect(provider.getCompany("99999999")).rejects.toBeInstanceOf(ProviderNotFoundError);
  });

  it("advertises the numbers it can answer for", () => {
    expect(FixtureCompaniesHouseProvider.knownCompanyNumbers()).toContain("SC000003");
  });
});

describe("HttpCompaniesHouseProvider", () => {
  // The live API is unreachable from this account (CH-A), so the HTTP
  // implementation is driven against the SAME recorded payloads the fixture
  // provider serves. That is what makes the fixtures evidence about the live
  // API rather than a private fiction.
  const recorded = RECORDED_COMPANIES_HOUSE.companies["00000001"];

  function fetchServing(status: number, body: unknown) {
    return async (): Promise<Response> =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }

  it("parses a recorded profile through the same parser the fixtures use", async () => {
    const provider = new HttpCompaniesHouseProvider("k", fetchServing(200, recorded.profile));
    const company = await provider.getCompany("00000001");
    expect(company.companyName).toBe("HARBOURSIDE ACCOUNTING LIMITED");
    expect(provider.kind).toBe("http");
  });

  it("parses recorded officers", async () => {
    const provider = new HttpCompaniesHouseProvider("k", fetchServing(200, recorded.officers));
    const officers = await provider.listOfficers("00000001");
    expect(officers.map((o) => o.verificationState)).toEqual(["unverified", "verified", "unknown"]);
  });

  it("sends the key as HTTP Basic with an empty password and never in the URL", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const provider = new HttpCompaniesHouseProvider("secret-key", async (input, init) => {
      seenUrl = input;
      seenAuth = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify(recorded.profile), { status: 200 });
    });
    await provider.getCompany("00000001");
    expect(seenUrl).not.toContain("secret-key");
    expect(seenAuth).toBe(`Basic ${btoa("secret-key:")}`);
  });

  it("turns 404 into not-found", async () => {
    const provider = new HttpCompaniesHouseProvider("k", fetchServing(404, ""));
    await expect(provider.getCompany("00000001")).rejects.toBeInstanceOf(ProviderNotFoundError);
  });

  it("turns 429 into its own error, so the sweep can mark and move on", async () => {
    const provider = new HttpCompaniesHouseProvider("k", fetchServing(429, ""));
    await expect(provider.getCompany("00000001")).rejects.toBeInstanceOf(ProviderRateLimitedError);
  });

  it("surfaces any other failure without leaking a body into the message wholesale", async () => {
    const provider = new HttpCompaniesHouseProvider("k", fetchServing(500, "x".repeat(1000)));
    await expect(provider.getCompany("00000001")).rejects.toBeInstanceOf(ProviderRequestError);
  });

  it("reads an absent PSC register as an empty list, not as a missing company", async () => {
    const provider = new HttpCompaniesHouseProvider("k", fetchServing(404, ""));
    await expect(provider.listPscs("00000001")).resolves.toEqual([]);
  });
});

describe("resolveProvider", () => {
  it("returns the fixture implementation when no key is published — today's normal case", () => {
    expect(resolveProvider({ ENVIRONMENT: "stage" }).kind).toBe("fixture");
    expect(resolveProvider({ ENVIRONMENT: "stage", COMPANIES_HOUSE_API_KEY: "  " }).kind).toBe("fixture");
    expect(resolveProviderKind({ ENVIRONMENT: "stage" })).toBe("fixture");
  });

  it("switches to the live API the moment a key exists, with no other change", () => {
    const env = { ENVIRONMENT: "prod", COMPANIES_HOUSE_API_KEY: "a-real-key" };
    expect(resolveProvider(env).kind).toBe("http");
    expect(resolveProviderKind(env)).toBe("http");
  });
});
