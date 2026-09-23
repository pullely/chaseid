import type { ChaseRisk, ChaseVerificationState, ListChaseDirectorsResponse } from "@saas/contracts/chase";
import { createChaseRepository } from "@saas/db/chase";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { windowCutoff } from "../chase.js";
import { errorResponse, successResponse, validationError } from "../http.js";
import { parseCompanyPublicId } from "../ids.js";
import { readPageParams } from "../pagination.js";
import { presentDirector } from "../present.js";

const STATES: readonly ChaseVerificationState[] = ["verified", "unverified", "unknown"];
const RISKS: readonly ChaseRisk[] = ["at_risk", "due_soon", "ok"];

/**
 * `GET /v1/organizations/{org}/chase/directors` — the status board.
 *
 * Every live director and PSC across the firm's book, soonest filing first.
 * `?state=` filters on the stored verification state; `?risk=` filters on
 * the DERIVED risk, which the repository expresses as the same predicate
 * `risk.ts` computes (the window cutoff and the verification state), so the
 * filter and the badge on each row can never disagree.
 */
export async function handleListDirectors(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
): Promise<Response> {
  if (!env.PLATFORM_DB) {
    return errorResponse("internal_error", "Service unavailable", 503, requestId);
  }

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const risk = url.searchParams.get("risk");
  const companyParam = url.searchParams.get("companyId");
  const fields: Record<string, string[]> = {};
  if (state && !STATES.includes(state as ChaseVerificationState)) {
    fields.state = [`must be one of ${STATES.join(", ")}`];
  }
  if (risk && !RISKS.includes(risk as ChaseRisk)) {
    fields.risk = [`must be one of ${RISKS.join(", ")}`];
  }
  const companyId = companyParam ? parseCompanyPublicId(companyParam) : null;
  if (companyParam && !companyId) fields.companyId = ["must be a cmp_ id"];
  if (Object.keys(fields).length > 0) return validationError(requestId, fields);

  const permitted = await requirePermission(env, requestId, actor, orgId, "chase.read");
  if (!permitted.ok) return permitted.response;

  const page = readPageParams(url);
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const repo = createChaseRepository(executor);
    const now = new Date();
    const people = await repo.listPeople({
      orgId,
      limit: page.limit,
      offset: page.offset,
      ...(state ? { verificationState: state as ChaseVerificationState } : {}),
      ...(companyId ? { companyId } : {}),
      ...(risk ? { risk: risk as ChaseRisk, riskCutoff: windowCutoff(now) } : {}),
    });
    if (!people.ok) {
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }

    const response: ListChaseDirectorsResponse = {
      directors: people.value.map((person) => presentDirector(person, now)),
    };
    return successResponse(response, requestId, page.nextCursor(people.value.length));
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
