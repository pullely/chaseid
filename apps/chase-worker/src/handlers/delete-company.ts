import { createChaseRepository } from "@saas/db/chase";
import { createEventsRepository } from "@saas/db/events";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { appendChaseEvent } from "../audit.js";
import { errorResponse, successResponse } from "../http.js";
import { companyPublicId } from "../ids.js";

/** `DELETE /v1/organizations/{org}/chase/companies/{cmp}` — the client left
 *  the practice. The company and its people go; the chase log does NOT, because
 *  it is the firm's AML record and outlives the engagement. */
export async function handleDeleteCompany(
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

    const removed = await repo.deleteCompany(orgId, companyId);
    if (!removed.ok) return errorResponse("not_found", "Not found", 404, requestId);

    await appendChaseEvent(createEventsRepository(executor), {
      type: "chase.company.removed",
      orgId,
      actor,
      requestId,
      subjectKind: "company",
      subjectId: companyPublicId(companyId),
      subjectName: company.value.companyNumber,
      description: `Removed company ${company.value.companyNumber} from the chase register`,
      payload: { companyId: companyPublicId(companyId), companyNumber: company.value.companyNumber },
    });

    return successResponse({ removed: true }, requestId);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
