import { parseCompanyProfile, parseOfficers, parsePscs } from "./parse.js";
import {
  ProviderNotFoundError,
  type CompaniesHouseProvider,
  type ProviderCompany,
  type ProviderPerson,
} from "./types.js";

const API_BASE = "https://api.company-information.service.gov.uk";

export class ProviderRateLimitedError extends Error {
  constructor() {
    super("companies house rate limit");
    this.name = "ProviderRateLimitedError";
  }
}

export class ProviderRequestError extends Error {
  constructor(status: number, body: string) {
    super(`companies house answered ${status}: ${body.slice(0, 200)}`);
    this.name = "ProviderRequestError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The live Companies House Public Data API.
 *
 * Written, typed and unit-tested against the same recorded payloads the
 * fixture provider serves — but not exercised against the live API in this
 * account, which holds no key (risks-and-open-questions.md CH-A). The moment
 * `COMPANIES_HOUSE_API_KEY` is published to the workspace, `resolveProvider`
 * returns this instead, with no other change anywhere.
 *
 * Auth is HTTP Basic with the API key as the username and an empty password —
 * the API's own documented scheme. The key never appears in a URL, a log line
 * or an error message.
 */
export class HttpCompaniesHouseProvider implements CompaniesHouseProvider {
  readonly kind = "http" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private authHeader(): string {
    return `Basic ${btoa(`${this.apiKey}:`)}`;
  }

  private async get(path: string, companyNumber: string): Promise<unknown> {
    const response = await this.fetchImpl(`${API_BASE}${path}`, {
      headers: { authorization: this.authHeader(), accept: "application/json" },
    });
    if (response.status === 404) throw new ProviderNotFoundError(companyNumber);
    // 429 is a first-class outcome, not an error to retry into the ground:
    // the sweep marks the company and comes back tomorrow (CH-F).
    if (response.status === 429) throw new ProviderRateLimitedError();
    if (!response.ok) {
      throw new ProviderRequestError(response.status, await response.text().catch(() => ""));
    }
    return response.json();
  }

  async getCompany(companyNumber: string): Promise<ProviderCompany> {
    return parseCompanyProfile(
      companyNumber,
      await this.get(`/company/${encodeURIComponent(companyNumber)}`, companyNumber),
    );
  }

  async listOfficers(companyNumber: string): Promise<ProviderPerson[]> {
    return parseOfficers(
      await this.get(`/company/${encodeURIComponent(companyNumber)}/officers?items_per_page=100`, companyNumber),
    );
  }

  async listPscs(companyNumber: string): Promise<ProviderPerson[]> {
    // A company with no PSC register answers 404 here while existing
    // perfectly well, so an absent register is an empty list, not a missing
    // company.
    try {
      return parsePscs(
        await this.get(
          `/company/${encodeURIComponent(companyNumber)}/persons-with-significant-control?items_per_page=100`,
          companyNumber,
        ),
      );
    } catch (error) {
      if (error instanceof ProviderNotFoundError) return [];
      throw error;
    }
  }
}
