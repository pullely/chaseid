import { createChaseRepository } from "@saas/db/chase";
import { createSqlExecutor } from "@saas/db/d1";
import { createEventsRepository } from "@saas/db/events";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { appendChaseEvent } from "../audit.js";
import { windowCutoff } from "../chase.js";
import { errorResponse, successResponse } from "../http.js";
import { atRiskCsvStream, buildAtRiskReport, wantsCsv } from "../report.js";

/** Enough for any book this product is sold to (2,000 companies × a handful
 *  of unverified people); the report is one query, not a page. */
const REPORT_PEOPLE_LIMIT = 10_000;

/**
 * `GET /v1/organizations/{org}/chase/report/at-risk` — this month's filings at
 * risk. JSON by default; `?format=csv` or `Accept: text/csv` streams the same
 * rows as a `text/csv` attachment, generated per request and never stored
 * (CH-B). Exporting the file is audited as `chase.report.exported`; reading
 * the JSON on screen is not.
 */
export async function handleAtRiskReport(
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

  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const now = new Date();
    const people = await createChaseRepository(executor).listPeople({
      orgId,
      limit: REPORT_PEOPLE_LIMIT,
      offset: 0,
      risk: "at_risk",
      riskCutoff: windowCutoff(now),
    });
    if (!people.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);

    const report = buildAtRiskReport(people.value, now);
    if (!wantsCsv(request)) return successResponse(report, requestId);

    await appendChaseEvent(createEventsRepository(executor), {
      type: "chase.report.exported",
      orgId,
      actor,
      requestId,
      subjectKind: "report",
      subjectId: "at-risk",
      subjectName: `at-risk ${now.toISOString().slice(0, 10)}`,
      description: `Exported the at-risk report (${report.companies.length} companies) as CSV`,
      payload: { companies: report.companies.length, windowDays: report.windowDays, format: "csv" },
    });

    const filename = `chaseid-at-risk-${now.toISOString().slice(0, 10)}.csv`;
    return new Response(atRiskCsvStream(report.companies), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
