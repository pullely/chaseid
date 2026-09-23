import type { ChaseRepository } from "@saas/db/chase";
import { createMeteringRepository } from "@saas/db/metering";
import type { SqlExecutor } from "@saas/db/d1";

export const COMPANIES_METRIC = "companies_under_management";

/**
 * Record the size of an org's register as a daily gauge on the baseline's
 * metering context, so it shows on `GET …/usage` with no Chaseid code there.
 *
 * One reading per org per UTC day, keyed `companies_under_management:<date>`:
 * the nightly sweep normally writes it, an import on a day without one writes
 * it instead, and a day-bucketed usage summary is then that day's size rather
 * than a sum of every reading. Written through the metering repository
 * directly: the metering HTTP route authorizes `organization.metering.write`,
 * which a firm's staff do not hold and the cron's system actor cannot.
 * Best-effort — a failed reading never fails an import or a sweep.
 */
export async function recordCompaniesGauge(
  executor: SqlExecutor,
  repo: Pick<ChaseRepository, "countCompanies">,
  orgId: string,
  now: Date,
): Promise<boolean> {
  try {
    const count = await repo.countCompanies(orgId);
    if (!count.ok) return false;
    const day = now.toISOString().slice(0, 10);
    const result = await createMeteringRepository(executor).recordUsage({
      id: crypto.randomUUID(),
      orgId,
      metric: COMPANIES_METRIC,
      quantity: count.value,
      idempotencyKey: `${COMPANIES_METRIC}:${day}`,
      recordedAt: now,
      metadata: { source: "chase-worker" },
    });
    return result.ok;
  } catch {
    return false;
  }
}
