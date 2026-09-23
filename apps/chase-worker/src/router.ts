import type { Env } from "./env.js";
import { handleHealth } from "./handlers/health.js";
import { handleDeleteCompany } from "./handlers/delete-company.js";
import { handleGetCompany } from "./handlers/get-company.js";
import { handleImportCompanies } from "./handlers/import-companies.js";
import { handleListCompanies } from "./handlers/list-companies.js";
import { handleListSyncRuns } from "./handlers/list-sync-runs.js";
import { handleSyncCompany } from "./handlers/sync-company.js";
import { handleChaseDirector } from "./handlers/chase-director.js";
import { handleListDirectors } from "./handlers/list-directors.js";
import { handleListMessages } from "./handlers/list-messages.js";
import { handleUpdateDirector } from "./handlers/update-director.js";
import { handleAtRiskReport } from "./handlers/at-risk-report.js";
import { errorResponse, methodNotAllowed, notFound } from "./http.js";
import { generateRequestId, parseCompanyPublicId, parseOrgPublicId, parsePersonPublicId } from "./ids.js";

const REQUEST_ID_RE = /^[\w-]{1,128}$/;

export interface ActorContext {
  subjectId: string;
  subjectType: string;
}

function resolveRequestId(request: Request): string {
  const header = request.headers.get("x-request-id");
  if (header && REQUEST_ID_RE.test(header)) return header;
  return generateRequestId();
}

function resolveActor(request: Request): ActorContext | null {
  const subjectId = request.headers.get("x-actor-subject-id");
  const subjectType = request.headers.get("x-actor-subject-type");
  if (!subjectId || !subjectType) return null;
  return { subjectId, subjectType };
}

// Most-specific first. `…/companies/import` MUST be matched before
// `…/companies/{id}`, or the literal segment parses as a company id.
const ORG_IMPORT_RE = /^\/v1\/organizations\/([^/]+)\/chase\/companies\/import$/;
const ORG_COMPANY_SYNC_RE = /^\/v1\/organizations\/([^/]+)\/chase\/companies\/([^/]+)\/sync$/;
const ORG_COMPANY_RE = /^\/v1\/organizations\/([^/]+)\/chase\/companies\/([^/]+)$/;
const ORG_COMPANIES_RE = /^\/v1\/organizations\/([^/]+)\/chase\/companies$/;
const ORG_SYNC_RUNS_RE = /^\/v1\/organizations\/([^/]+)\/chase\/sync-runs$/;
// CH2 — the status board and the chase. `…/directors/{prs}/chase` before
// `…/directors/{prs}`, for the same reason as import above.
const ORG_DIRECTOR_CHASE_RE = /^\/v1\/organizations\/([^/]+)\/chase\/directors\/([^/]+)\/chase$/;
const ORG_DIRECTOR_RE = /^\/v1\/organizations\/([^/]+)\/chase\/directors\/([^/]+)$/;
const ORG_DIRECTORS_RE = /^\/v1\/organizations\/([^/]+)\/chase\/directors$/;
const ORG_MESSAGES_RE = /^\/v1\/organizations\/([^/]+)\/chase\/messages$/;
// CH3 — the at-risk report (JSON, or text/csv on ?format=csv / Accept).
const ORG_REPORT_RE = /^\/v1\/organizations\/([^/]+)\/chase\/report\/at-risk$/;

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestId = resolveRequestId(request);

  try {
    if (url.pathname === "/health" && request.method === "GET") {
      return handleHealth(env, requestId);
    }

    const importMatch = url.pathname.match(ORG_IMPORT_RE);
    if (importMatch) {
      if (request.method !== "POST") return methodNotAllowed(requestId);
      const orgUuid = parseOrgPublicId(importMatch[1]!);
      if (!orgUuid) return errorResponse("not_found", "Not found", 404, requestId);
      const actor = resolveActor(request);
      if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      return handleImportCompanies(request, env, requestId, actor, orgUuid);
    }

    const syncMatch = url.pathname.match(ORG_COMPANY_SYNC_RE);
    if (syncMatch) {
      if (request.method !== "POST") return methodNotAllowed(requestId);
      const orgUuid = parseOrgPublicId(syncMatch[1]!);
      const companyUuid = parseCompanyPublicId(syncMatch[2]!);
      if (!orgUuid || !companyUuid) return errorResponse("not_found", "Not found", 404, requestId);
      const actor = resolveActor(request);
      if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      return handleSyncCompany(env, requestId, actor, orgUuid, companyUuid);
    }

    const companyMatch = url.pathname.match(ORG_COMPANY_RE);
    if (companyMatch) {
      const orgUuid = parseOrgPublicId(companyMatch[1]!);
      const companyUuid = parseCompanyPublicId(companyMatch[2]!);
      if (!orgUuid || !companyUuid) return errorResponse("not_found", "Not found", 404, requestId);
      const actor = resolveActor(request);
      if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      if (request.method === "GET") {
        return handleGetCompany(env, requestId, actor, orgUuid, companyUuid);
      }
      if (request.method === "DELETE") {
        return handleDeleteCompany(env, requestId, actor, orgUuid, companyUuid);
      }
      return methodNotAllowed(requestId);
    }

    const companiesMatch = url.pathname.match(ORG_COMPANIES_RE);
    if (companiesMatch) {
      if (request.method !== "GET") return methodNotAllowed(requestId);
      const orgUuid = parseOrgPublicId(companiesMatch[1]!);
      if (!orgUuid) return errorResponse("not_found", "Not found", 404, requestId);
      const actor = resolveActor(request);
      if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      return handleListCompanies(request, env, requestId, actor, orgUuid);
    }

    const runsMatch = url.pathname.match(ORG_SYNC_RUNS_RE);
    if (runsMatch) {
      if (request.method !== "GET") return methodNotAllowed(requestId);
      const orgUuid = parseOrgPublicId(runsMatch[1]!);
      if (!orgUuid) return errorResponse("not_found", "Not found", 404, requestId);
      const actor = resolveActor(request);
      if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      return handleListSyncRuns(request, env, requestId, actor, orgUuid);
    }

    const chaseMatch = url.pathname.match(ORG_DIRECTOR_CHASE_RE);
    if (chaseMatch) {
      if (request.method !== "POST") return methodNotAllowed(requestId);
      const orgUuid = parseOrgPublicId(chaseMatch[1]!);
      const personUuid = parsePersonPublicId(chaseMatch[2]!);
      if (!orgUuid || !personUuid) return errorResponse("not_found", "Not found", 404, requestId);
      const actor = resolveActor(request);
      if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      return handleChaseDirector(env, requestId, actor, orgUuid, personUuid);
    }

    const directorMatch = url.pathname.match(ORG_DIRECTOR_RE);
    if (directorMatch) {
      if (request.method !== "PATCH") return methodNotAllowed(requestId);
      const orgUuid = parseOrgPublicId(directorMatch[1]!);
      const personUuid = parsePersonPublicId(directorMatch[2]!);
      if (!orgUuid || !personUuid) return errorResponse("not_found", "Not found", 404, requestId);
      const actor = resolveActor(request);
      if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      return handleUpdateDirector(request, env, requestId, actor, orgUuid, personUuid);
    }

    const directorsMatch = url.pathname.match(ORG_DIRECTORS_RE);
    if (directorsMatch) {
      if (request.method !== "GET") return methodNotAllowed(requestId);
      const orgUuid = parseOrgPublicId(directorsMatch[1]!);
      if (!orgUuid) return errorResponse("not_found", "Not found", 404, requestId);
      const actor = resolveActor(request);
      if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      return handleListDirectors(request, env, requestId, actor, orgUuid);
    }

    const messagesMatch = url.pathname.match(ORG_MESSAGES_RE);
    if (messagesMatch) {
      if (request.method !== "GET") return methodNotAllowed(requestId);
      const orgUuid = parseOrgPublicId(messagesMatch[1]!);
      if (!orgUuid) return errorResponse("not_found", "Not found", 404, requestId);
      const actor = resolveActor(request);
      if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      return handleListMessages(request, env, requestId, actor, orgUuid);
    }

    const reportMatch = url.pathname.match(ORG_REPORT_RE);
    if (reportMatch) {
      if (request.method !== "GET") return methodNotAllowed(requestId);
      const orgUuid = parseOrgPublicId(reportMatch[1]!);
      if (!orgUuid) return errorResponse("not_found", "Not found", 404, requestId);
      const actor = resolveActor(request);
      if (!actor) return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      return handleAtRiskReport(request, env, requestId, actor, orgUuid);
    }

    return notFound(requestId, url.pathname);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  }
}
