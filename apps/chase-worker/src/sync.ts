import type { ChaseCompany, ChaseRepository, ProviderKind, SyncTrigger } from "@saas/db/chase";
import { createChaseRepository } from "@saas/db/chase";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "./env.js";
import { recordCompaniesGauge } from "./metering.js";
import { resolveProvider } from "./provider/index.js";
import { ProviderNotFoundError, type CompaniesHouseProvider } from "./provider/types.js";

/** How long a provider answer is reused. Just under a day, so the nightly
 *  sweep always re-fetches while a manual re-sync minutes later does not —
 *  which is what keeps a 2,000-company book inside the public API's
 *  600-per-five-minutes budget (CH-F). */
const CACHE_TTL_SECONDS = 20 * 60 * 60;

/** How many companies one nightly invocation sweeps. A Worker invocation is
 *  not a batch job; the queue is ordered oldest-sync-first, so a book larger
 *  than this simply finishes over consecutive nights instead of timing out. */
const SWEEP_BATCH = 200;

export interface SyncOneResult {
  peopleUpserted: number;
  ok: boolean;
}

interface CachedCompany {
  company: unknown;
  officers: unknown;
  pscs: unknown;
}

/**
 * Sync one company: profile, officers, PSCs, upserted, and the company row
 * stamped with how it went.
 *
 * A provider failure is RECORDED, never thrown: `last_sync_state` and
 * `last_sync_error` carry it, the sweep keeps going, and the company is first
 * in the queue tomorrow. One unreachable company must not cost a firm the
 * other 1,999.
 */
export async function syncCompany(
  repo: ChaseRepository,
  provider: CompaniesHouseProvider,
  company: ChaseCompany,
  cache: KVNamespace | undefined,
  now: Date,
): Promise<SyncOneResult> {
  const cacheKey = `ch:v1:${company.companyNumber}`;
  let payload: CachedCompany | null = null;

  if (cache) {
    try {
      payload = await cache.get<CachedCompany>(cacheKey, "json");
    } catch {
      payload = null;
    }
  }

  try {
    if (!payload) {
      const [profile, officers, pscs] = await Promise.all([
        provider.getCompany(company.companyNumber),
        provider.listOfficers(company.companyNumber),
        provider.listPscs(company.companyNumber),
      ]);
      payload = { company: profile, officers, pscs };
      if (cache) {
        try {
          await cache.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS });
        } catch {
          // A cache that will not write is a performance problem, not a
          // correctness one.
        }
      }
    }
  } catch (error) {
    const notFound = error instanceof ProviderNotFoundError;
    await repo.applySync({
      companyId: company.id,
      companyName: company.companyName,
      companyStatus: company.companyStatus,
      nextStatementDue: company.nextStatementDue,
      syncState: notFound ? "not_found" : "provider_error",
      syncError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      syncedAt: now.toISOString(),
    });
    return { peopleUpserted: 0, ok: false };
  }

  const profile = payload.company as {
    companyName: string;
    companyStatus: ChaseCompany["companyStatus"];
    nextStatementDue: string | null;
  };
  const people = [
    ...(payload.officers as Array<Record<string, unknown>>),
    ...(payload.pscs as Array<Record<string, unknown>>),
  ];

  let upserted = 0;
  for (const person of people) {
    const result = await repo.upsertPerson({
      id: crypto.randomUUID(),
      orgId: company.orgId,
      companyId: company.id,
      providerPersonKey: String(person.providerPersonKey),
      kind: person.kind === "psc" ? "psc" : "officer",
      name: String(person.name ?? ""),
      role: String(person.role ?? "unknown"),
      appointedOn: (person.appointedOn as string | null) ?? null,
      resignedOn: (person.resignedOn as string | null) ?? null,
      verificationState: (person.verificationState as "verified" | "unverified" | "unknown") ?? "unknown",
      verifiedOn: (person.verifiedOn as string | null) ?? null,
    });
    if (result.ok) upserted += 1;
  }

  await repo.applySync({
    companyId: company.id,
    companyName: profile.companyName,
    companyStatus: profile.companyStatus,
    nextStatementDue: profile.nextStatementDue,
    syncState: "ok",
    syncError: null,
    syncedAt: now.toISOString(),
  });

  return { peopleUpserted: upserted, ok: true };
}

export interface SweepResult {
  companiesScanned: number;
  peopleUpserted: number;
  errors: number;
}

/** Sweep a named set of companies inside one org, recording a run row. The
 *  import route, the manual re-sync button and the nightly cron all land
 *  here, so there is exactly one code path that talks to Companies House. */
export async function sweepCompanies(
  repo: ChaseRepository,
  provider: CompaniesHouseProvider,
  orgId: string,
  companies: ChaseCompany[],
  trigger: SyncTrigger,
  cache: KVNamespace | undefined,
  now: Date,
): Promise<{ syncRunId: string; provider: ProviderKind; result: SweepResult }> {
  const runId = crypto.randomUUID();
  await repo.startSyncRun({ id: runId, orgId, trigger, provider: provider.kind });

  const result: SweepResult = { companiesScanned: 0, peopleUpserted: 0, errors: 0 };
  for (const company of companies) {
    const one = await syncCompany(repo, provider, company, cache, now);
    result.companiesScanned += 1;
    result.peopleUpserted += one.peopleUpserted;
    if (!one.ok) result.errors += 1;
  }

  await repo.finishSyncRun({
    id: runId,
    orgId,
    companiesScanned: result.companiesScanned,
    peopleUpserted: result.peopleUpserted,
    errors: result.errors,
  });

  return { syncRunId: runId, provider: provider.kind, result };
}

/**
 * The `15 2 * * *` cron. Sweeps the oldest-synced companies across every org,
 * grouped so each org gets its own run row — a firm reading its sync history
 * must not see another firm's counts.
 */
export async function runNightlySweep(env: Env): Promise<void> {
  if (!env.PLATFORM_DB) return;
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const repo = createChaseRepository(executor);
    const due = await repo.listCompaniesForSweep(SWEEP_BATCH);
    if (!due.ok || due.value.length === 0) return;

    const provider = resolveProvider(env);
    const now = new Date();
    const byOrg = new Map<string, ChaseCompany[]>();
    for (const company of due.value) {
      const bucket = byOrg.get(company.orgId);
      if (bucket) bucket.push(company);
      else byOrg.set(company.orgId, [company]);
    }

    for (const [orgId, companies] of byOrg) {
      await sweepCompanies(repo, provider, orgId, companies, "cron", env.CHASE_CACHE, now);
      // CH3: the day's companies_under_management reading (see metering.ts).
      await recordCompaniesGauge(executor, repo, orgId, now);
    }
  } finally {
    await executor.dispose();
  }
}
