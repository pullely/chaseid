import type { ChaseCompany, ChaseRepository } from "@saas/db/chase";
import { normaliseName } from "@saas/db/chase";
import { FixtureCompaniesHouseProvider } from "@chase-worker/provider/fixture";
import { ProviderNotFoundError } from "@chase-worker/provider/types";
import { syncCompany, sweepCompanies } from "@chase-worker/sync";

const NOW = new Date("2026-09-23T11:00:00.000Z");

function company(overrides: Partial<ChaseCompany> = {}): ChaseCompany {
  return {
    id: "company-uuid",
    orgId: "org-uuid",
    companyNumber: "00000001",
    companyName: "",
    companyStatus: "unknown",
    nextStatementDue: null,
    lastSyncedAt: null,
    lastSyncState: "never",
    lastSyncError: null,
    source: "csv",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

/** Enough of the repository for the sync to run against, with the calls it
 *  made left where a test can read them. The handlers are written for
 *  injection precisely so nothing here needs D1. */
function fakeRepo() {
  const upserts: unknown[] = [];
  const applied: unknown[] = [];
  const runs: unknown[] = [];
  const finished: unknown[] = [];
  const repo = {
    upsertPerson: async (input: unknown) => {
      upserts.push(input);
      return { ok: true as const, value: { person: input, created: true } };
    },
    applySync: async (input: unknown) => {
      applied.push(input);
      return { ok: true as const, value: undefined };
    },
    startSyncRun: async (input: unknown) => {
      runs.push(input);
      return { ok: true as const, value: input };
    },
    finishSyncRun: async (input: unknown) => {
      finished.push(input);
      return { ok: true as const, value: undefined };
    },
  } as unknown as ChaseRepository;
  return { repo, upserts, applied, runs, finished };
}

describe("syncCompany", () => {
  it("upserts every officer and PSC and marks the company ok", async () => {
    const { repo, upserts, applied } = fakeRepo();
    const result = await syncCompany(
      repo,
      new FixtureCompaniesHouseProvider(() => NOW),
      company(),
      undefined,
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(result.peopleUpserted).toBe(4); // three officers, one PSC
    const sync = applied[0] as Record<string, unknown>;
    expect(sync.syncState).toBe("ok");
    expect(sync.companyName).toBe("HARBOURSIDE ACCOUNTING LIMITED");
    expect(sync.nextStatementDue).toBe("2026-10-05");
    expect((upserts[0] as Record<string, unknown>).companyId).toBe("company-uuid");
  });

  it("records a missing company instead of throwing, so one bad row cannot stop the sweep", async () => {
    const { repo, applied } = fakeRepo();
    const result = await syncCompany(
      repo,
      new FixtureCompaniesHouseProvider(() => NOW),
      company({ companyNumber: "99999999" }),
      undefined,
      NOW,
    );

    expect(result.ok).toBe(false);
    expect(result.peopleUpserted).toBe(0);
    expect((applied[0] as Record<string, unknown>).syncState).toBe("not_found");
  });

  it("records a provider failure as provider_error and keeps the last known facts", async () => {
    const { repo, applied } = fakeRepo();
    const exploding = {
      kind: "fixture" as const,
      getCompany: async () => {
        throw new Error("upstream on fire");
      },
      listOfficers: async () => [],
      listPscs: async () => [],
    };

    const result = await syncCompany(
      repo,
      exploding,
      company({ companyName: "KNOWN LTD", nextStatementDue: "2026-12-01" }),
      undefined,
      NOW,
    );

    expect(result.ok).toBe(false);
    const sync = applied[0] as Record<string, unknown>;
    expect(sync.syncState).toBe("provider_error");
    expect(sync.companyName).toBe("KNOWN LTD");
    expect(sync.nextStatementDue).toBe("2026-12-01");
    expect(String(sync.syncError)).toContain("upstream on fire");
  });

  it("serves a cached payload without calling the provider again", async () => {
    const { repo, upserts } = fakeRepo();
    const store = new Map<string, string>();
    const cache = {
      get: async (key: string) => {
        const raw = store.get(key);
        return raw ? JSON.parse(raw) : null;
      },
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    } as unknown as KVNamespace;

    let calls = 0;
    const counting = new FixtureCompaniesHouseProvider(() => NOW);
    const provider = {
      kind: counting.kind,
      getCompany: async (n: string) => {
        calls += 1;
        return counting.getCompany(n);
      },
      listOfficers: (n: string) => counting.listOfficers(n),
      listPscs: (n: string) => counting.listPscs(n),
    };

    await syncCompany(repo, provider, company(), cache, NOW);
    await syncCompany(repo, provider, company(), cache, NOW);

    expect(calls).toBe(1);
    expect(upserts).toHaveLength(8); // both runs upserted, only one fetched
  });

  it("survives a cache that will not read, because a cache is a performance seam", async () => {
    const { repo } = fakeRepo();
    const broken = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async () => {
        throw new Error("kv down");
      },
    } as unknown as KVNamespace;

    await expect(syncCompany(repo, new FixtureCompaniesHouseProvider(() => NOW), company(), broken, NOW))
      .resolves.toMatchObject({ ok: true });
  });
});

describe("sweepCompanies", () => {
  it("opens one run, counts what happened and closes it", async () => {
    const { repo, runs, finished } = fakeRepo();
    const sweep = await sweepCompanies(
      repo,
      new FixtureCompaniesHouseProvider(() => NOW),
      "org-uuid",
      [company(), company({ id: "b", companyNumber: "99999999" })],
      "import",
      undefined,
      NOW,
    );

    expect(runs).toHaveLength(1);
    expect((runs[0] as Record<string, unknown>).trigger).toBe("import");
    expect(sweep.provider).toBe("fixture");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ companiesScanned: 2, peopleUpserted: 4, errors: 1 });
  });

  it("stamps the run with the provider that served it, so fixture data is never mistaken for live", async () => {
    const { repo, runs } = fakeRepo();
    await sweepCompanies(
      repo,
      new FixtureCompaniesHouseProvider(() => NOW),
      "org-uuid",
      [],
      "cron",
      undefined,
      NOW,
    );
    expect((runs[0] as Record<string, unknown>).provider).toBe("fixture");
  });
});

describe("normaliseName", () => {
  it("matches a firm's spreadsheet spelling to the Companies House rendering", () => {
    // Companies House writes "SURNAME, Forename"; a practice writes
    // "Forename Surname". The match is over the sorted token set (CH-E).
    expect(normaliseName("OKONKWO, Adaeze Ngozi")).toBe(normaliseName("Adaeze Ngozi Okonkwo"));
    expect(normaliseName("MacArthur, Fiona")).toBe(normaliseName("fiona macarthur"));
  });

  it("does not collapse two different people onto one address", () => {
    expect(normaliseName("SMITH, John")).not.toBe(normaliseName("SMITH, Jane"));
  });
});

describe("the provider seam holds the not-found contract", () => {
  it("is the same error class whichever implementation raised it", () => {
    expect(new ProviderNotFoundError("00000001")).toBeInstanceOf(Error);
    expect(new ProviderNotFoundError("00000001").name).toBe("ProviderNotFoundError");
  });
});
