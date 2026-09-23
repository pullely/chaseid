import type {
  ChaseAtRiskReportResponse,
  ChaseDirectorChaseResponse,
  ChaseRisk,
  ChaseVerificationState,
  GetChaseCompanyResponse,
  ImportChaseCompaniesRequest,
  ImportChaseCompaniesResponse,
  ListChaseCompaniesResponse,
  ListChaseDirectorsResponse,
  ListChaseMessagesResponse,
  ListChaseSyncRunsResponse,
  SyncChaseCompanyResponse,
  UpdateChaseDirectorRequest,
  UpdateChaseDirectorResponse,
} from "@saas/contracts/chase";

import type { RequestOptions, Transport } from "./transport.js";

/** Query for the status board. Every field is optional; `cursor` is the
 *  previous page's `meta.cursor`, passed back verbatim. */
export interface ListChaseDirectorsQuery {
  state?: ChaseVerificationState;
  risk?: ChaseRisk;
  companyId?: string;
  limit?: number;
  cursor?: string;
}

export interface ChasePageQuery {
  limit?: number;
  cursor?: string;
}

function base(orgId: string): string {
  return `/v1/organizations/${encodeURIComponent(orgId)}/chase`;
}

/**
 * The Chaseid client register and its verification chase.
 *
 * Backed by `apps/chase-worker` through the api-edge `chase-facade`. Every
 * route is org-scoped.
 */
export class ChaseClient {
  constructor(private readonly transport: Transport) {}

  /** POST /v1/organizations/:orgId/chase/companies/import (JSON form). */
  importCompanies(
    orgId: string,
    body: ImportChaseCompaniesRequest,
    opts: RequestOptions = {},
  ): Promise<ImportChaseCompaniesResponse> {
    return this.transport.request<ImportChaseCompaniesResponse>(
      { method: "POST", path: `${base(orgId)}/companies/import`, body },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/chase/companies */
  listCompanies(orgId: string, query: ChasePageQuery = {}, opts: RequestOptions = {}): Promise<ListChaseCompaniesResponse> {
    return this.transport.request<ListChaseCompaniesResponse>(
      { method: "GET", path: `${base(orgId)}/companies`, query: { limit: query.limit, cursor: query.cursor } },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/chase/companies/:companyId */
  getCompany(orgId: string, companyId: string, opts: RequestOptions = {}): Promise<GetChaseCompanyResponse> {
    return this.transport.request<GetChaseCompanyResponse>(
      { method: "GET", path: `${base(orgId)}/companies/${encodeURIComponent(companyId)}` },
      opts,
    );
  }

  /** DELETE /v1/organizations/:orgId/chase/companies/:companyId */
  removeCompany(orgId: string, companyId: string, opts: RequestOptions = {}): Promise<{ removed: boolean }> {
    return this.transport.request<{ removed: boolean }>(
      { method: "DELETE", path: `${base(orgId)}/companies/${encodeURIComponent(companyId)}` },
      opts,
    );
  }

  /** POST /v1/organizations/:orgId/chase/companies/:companyId/sync */
  syncCompany(orgId: string, companyId: string, opts: RequestOptions = {}): Promise<SyncChaseCompanyResponse> {
    return this.transport.request<SyncChaseCompanyResponse>(
      { method: "POST", path: `${base(orgId)}/companies/${encodeURIComponent(companyId)}/sync` },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/chase/sync-runs */
  listSyncRuns(orgId: string, opts: RequestOptions = {}): Promise<ListChaseSyncRunsResponse> {
    return this.transport.request<ListChaseSyncRunsResponse>(
      { method: "GET", path: `${base(orgId)}/sync-runs` },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/chase/directors — the status board. */
  listDirectors(
    orgId: string,
    query: ListChaseDirectorsQuery = {},
    opts: RequestOptions = {},
  ): Promise<ListChaseDirectorsResponse> {
    return this.transport.request<ListChaseDirectorsResponse>(
      {
        method: "GET",
        path: `${base(orgId)}/directors`,
        query: {
          state: query.state,
          risk: query.risk,
          companyId: query.companyId,
          limit: query.limit,
          cursor: query.cursor,
        },
      },
      opts,
    );
  }

  /** PATCH /v1/organizations/:orgId/chase/directors/:personId */
  updateDirector(
    orgId: string,
    personId: string,
    body: UpdateChaseDirectorRequest,
    opts: RequestOptions = {},
  ): Promise<UpdateChaseDirectorResponse> {
    return this.transport.request<UpdateChaseDirectorResponse>(
      { method: "PATCH", path: `${base(orgId)}/directors/${encodeURIComponent(personId)}`, body },
      opts,
    );
  }

  /** POST /v1/organizations/:orgId/chase/directors/:personId/chase — "chase now". */
  chaseDirector(orgId: string, personId: string, opts: RequestOptions = {}): Promise<ChaseDirectorChaseResponse> {
    return this.transport.request<ChaseDirectorChaseResponse>(
      { method: "POST", path: `${base(orgId)}/directors/${encodeURIComponent(personId)}/chase` },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/chase/messages — the chase log. */
  listMessages(orgId: string, query: ChasePageQuery = {}, opts: RequestOptions = {}): Promise<ListChaseMessagesResponse> {
    return this.transport.request<ListChaseMessagesResponse>(
      { method: "GET", path: `${base(orgId)}/messages`, query: { limit: query.limit, cursor: query.cursor } },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/chase/report/at-risk — the JSON rendering. */
  atRiskReport(orgId: string, opts: RequestOptions = {}): Promise<ChaseAtRiskReportResponse> {
    return this.transport.request<ChaseAtRiskReportResponse>(
      { method: "GET", path: `${base(orgId)}/report/at-risk` },
      opts,
    );
  }

  /** The same report as `text/csv` — the file the console's Download CSV
   *  button saves. Generated per request; nothing is stored server-side. */
  atRiskReportCsv(orgId: string, opts: RequestOptions = {}): Promise<string> {
    return this.transport.requestText(
      { method: "GET", path: `${base(orgId)}/report/at-risk`, query: { format: "csv" } },
      "text/csv",
      opts,
    );
  }
}
