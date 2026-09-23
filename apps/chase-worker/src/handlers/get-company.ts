import type { GetChaseCompanyResponse } from "@saas/contracts/chase";
import { createChaseRepository } from "@saas/db/chase";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { errorResponse, successResponse } from "../http.js";
import { presentCompany, presentDirector } from "../present.js";

/** `GET /v1/organizations/{org}/chase/companies/{cmp}` — one company and the
 *  officers and PSCs whose verification its filing waits on. */
export async function handleGetCompany(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  companyId: string,
): Promise<Response> {
  if (!env.PLATFORM_DB) {
    return errorResponse("internal_error", "Service unavailable", 503, requestId);
  }

  const permitted = await requirePermission(env, requestId, actor, orgId, "chase.read");
  if (!permitted.ok) return permitted.response;

  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const repo = createChaseRepository(executor);
    const company = await repo.getCompany(orgId, companyId);
    if (!company.ok) return errorResponse("not_found", "Not found", 404, requestId);

    const people = await repo.listPeopleForCompany(companyId);
    const rows = people.ok ? people.value : [];
    const now = new Date();

    const response: GetChaseCompanyResponse = {
      company: presentCompany(company.value, rows, now),
      directors: rows
        .filter((person) => person.resignedOn === null)
        .map((person) =>
          presentDirector(
            {
              ...person,
              companyNumber: company.value.companyNumber,
              companyName: company.value.companyName,
              nextStatementDue: company.value.nextStatementDue,
            },
            now,
          ),
        ),
    };
    return successResponse(response, requestId);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
