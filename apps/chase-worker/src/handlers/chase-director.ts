import type { ChaseDirectorChaseResponse } from "@saas/contracts/chase";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { chaseDepsFor, chaseOne } from "../chase.js";
import { errorResponse, successResponse } from "../http.js";
import { presentMessage } from "../present.js";

/**
 * `POST /v1/organizations/{org}/chase/directors/{prs}/chase` — "chase now".
 *
 * The same `chaseOne` the morning cron runs, in `manual` mode: it skips the
 * risk window and the seven-day interval (a person on staff decided), and
 * never the facts that make a chase wrong. A refusal is a 200 carrying
 * `skippedReason`, not an error — the board shows why nothing was sent.
 */
export async function handleChaseDirector(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  personId: string,
): Promise<Response> {
  if (!env.PLATFORM_DB) {
    return errorResponse("internal_error", "Service unavailable", 503, requestId);
  }

  const permitted = await requirePermission(env, requestId, actor, orgId, "chase.write");
  if (!permitted.ok) return permitted.response;

  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const deps = chaseDepsFor(env, executor, actor);
    const person = await deps.repo.getPerson(orgId, personId);
    if (!person.ok) return errorResponse("not_found", "Not found", 404, requestId);

    const one = await chaseOne(deps, person.value, actor, requestId, "manual");
    const response: ChaseDirectorChaseResponse = one.decision.send
      ? { message: one.message ? presentMessage(one.message) : null, step: one.decision.step, skippedReason: null }
      : { message: null, step: person.value.chaseStep, skippedReason: one.decision.reason };
    return successResponse(response, requestId);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
