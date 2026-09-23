import type { SyncChaseCompanyResponse } from "@saas/contracts/chase";
import { createChaseRepository } from "@saas/db/chase";
import { createEventsRepository } from "@saas/db/events";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { appendChaseEvent } from "../audit.js";
import { errorResponse, successResponse } from "../http.js";
import { companyPublicId, syncRunPublicId } from "../ids.js";
import { presentCompany } from "../present.js";
import { resolveProvider } from "../provider/index.js";
import { sweepCompanies } from "../sync.js";

/** `POST /v1/organizations/{org}/chase/companies/{cmp}/sync` — the "re-check
 *  now" button. Same code path as the nightly cron, so there is one sync in
 *  the product and not two that can disagree. */
export async function handleSyncCompany(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  companyId: string,
): Promise<Response> {
  if (!env.PLATFORM_DB) {
    return errorResponse("internal_error", "Service unavailable", 503, requestId);
  }

  const permitted = await requirePermission(env, requestId, actor, orgId, "chase.write");
  if (!permitted.ok) return permitted.response;

  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const repo = createChaseRepository(executor);
    const company = await repo.getCompany(orgId, companyId);
    if (!company.ok) return errorResponse("not_found", "Not found", 404, requestId);

    const now = new Date();
    const sweep = await sweepCompanies(
      repo,
      resolveProvider(env),
      orgId,
      [company.value],
      "manual",
      env.CHASE_CACHE,
      now,
    );

    const refreshed = await repo.getCompany(orgId, companyId);
    const people = await repo.listPeopleForCompany(companyId);

    await appendChaseEvent(createEventsRepository(executor), {
      type: "chase.company.synced",
      orgId,
      actor,
      requestId,
      subjectKind: "company",
      subjectId: companyPublicId(companyId),
      subjectName: company.value.companyNumber,
      description: `Synced company ${company.value.companyNumber} from Companies House (${sweep.provider})`,
      payload: {
        companyId: companyPublicId(companyId),
        companyNumber: company.value.companyNumber,
        provider: sweep.provider,
        peopleUpserted: sweep.result.peopleUpserted,
      },
    });

    const response: SyncChaseCompanyResponse = {
      company: presentCompany(
        refreshed.ok ? refreshed.value : company.value,
        people.ok ? people.value : [],
        now,
      ),
      syncRunId: syncRunPublicId(sweep.syncRunId),
      provider: sweep.provider,
    };
    return successResponse(response, requestId);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
