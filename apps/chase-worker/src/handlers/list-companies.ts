import type { ListChaseCompaniesResponse } from "@saas/contracts/chase";
import { createChaseRepository } from "@saas/db/chase";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { errorResponse, successResponse } from "../http.js";
import { presentCompany } from "../present.js";
import { readPageParams } from "../pagination.js";

/** `GET /v1/organizations/{org}/chase/companies` — the client register,
 *  soonest filing first, with each company's live people counted and its risk
 *  derived. */
export async function handleListCompanies(
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
    const companies = await repo.listCompanies({ orgId, limit: page.limit, offset: page.offset });
    if (!companies.ok) {
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }

    const now = new Date();
    const presented = [];
    for (const company of companies.value) {
      const people = await repo.listPeopleForCompany(company.id);
      presented.push(presentCompany(company, people.ok ? people.value : [], now));
    }

    const response: ListChaseCompaniesResponse = { companies: presented };
    return successResponse(response, requestId, page.nextCursor(companies.value.length));
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
