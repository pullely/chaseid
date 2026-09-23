import type { ListChaseSyncRunsResponse } from "@saas/contracts/chase";
import { createChaseRepository } from "@saas/db/chase";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { errorResponse, successResponse } from "../http.js";
import { presentSyncRun } from "../present.js";
import { readPageParams } from "../pagination.js";

/** `GET /v1/organizations/{org}/chase/sync-runs` — the sync history, newest
 *  first. `provider` on each row is the answer to "is this live Companies
 *  House data or the recorded fixtures?" (CH-A). */
export async function handleListSyncRuns(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
): Promise<Response> {
  if (!env.PLATFORM_DB) {
    return errorResponse("internal_error", "Service unavailable", 503, requestId);
  }

  const permitted = await requirePermission(env, requestId, actor, orgId, "chase.read");
  if (!permitted.ok) return permitted.response;

  const page = readPageParams(new URL(request.url));
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const repo = createChaseRepository(executor);
    const runs = await repo.listSyncRuns(orgId, page.limit);
    if (!runs.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);

    const response: ListChaseSyncRunsResponse = { syncRuns: runs.value.map(presentSyncRun) };
    return successResponse(response, requestId);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
