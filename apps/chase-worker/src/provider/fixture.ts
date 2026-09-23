import { RECORDED_COMPANIES_HOUSE } from "./fixtures/companies.js";
import { parseCompanyProfile, parseOfficers, parsePscs } from "./parse.js";
import {
  ProviderNotFoundError,
  type CompaniesHouseProvider,
  type ProviderCompany,
  type ProviderPerson,
} from "./types.js";

const DUE_TOKEN = /^@@DUE([+-]\d+)@@$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Resolve a `@@DUE+n@@` token to an ISO date n days from `now`. A recorded
 *  absolute confirmation-statement date would be in the past within weeks and
 *  the whole register would read `ok`; the demo has to keep demonstrating. */
function resolveDates(value: unknown, now: Date): unknown {
  if (typeof value === "string") {
    const match = DUE_TOKEN.exec(value);
    if (!match) return value;
    const offset = Number(match[1]);
    const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return new Date(day + offset * MS_PER_DAY).toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map((entry) => resolveDates(entry, now));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveDates(entry, now);
    }
    return out;
  }
  return value;
}

type RecordedCompany = {
  profile: unknown;
  officers: unknown;
  pscs: unknown;
};

/**
 * The implementation that runs wherever there is no Companies House API key —
 * which, on this account, is everywhere (risks-and-open-questions.md CH-A).
 *
 * It is deliberately NOT a stub: it serves recorded payloads through the same
 * parsers the HTTP implementation uses, so importing a company, deriving its
 * risk, chasing its directors and exporting the at-risk report are all
 * demonstrable end to end, and every run it serves is labelled `fixture` on
 * `chase_sync_runs` so nobody mistakes it for live data.
 *
 * A company number it has never heard of raises `ProviderNotFoundError`,
 * exactly as the live API's 404 does — an unknown company must look the same
 * to the sync whichever provider answered.
 */
export class FixtureCompaniesHouseProvider implements CompaniesHouseProvider {
  readonly kind = "fixture" as const;

  constructor(private readonly now: () => Date = () => new Date()) {}

  private lookup(companyNumber: string): RecordedCompany {
    const companies = RECORDED_COMPANIES_HOUSE.companies as unknown as Record<string, RecordedCompany>;
    const found = companies[companyNumber];
    if (!found) throw new ProviderNotFoundError(companyNumber);
    return resolveDates(found, this.now()) as RecordedCompany;
  }

  async getCompany(companyNumber: string): Promise<ProviderCompany> {
    return parseCompanyProfile(companyNumber, this.lookup(companyNumber).profile);
  }

  async listOfficers(companyNumber: string): Promise<ProviderPerson[]> {
    return parseOfficers(this.lookup(companyNumber).officers);
  }

  async listPscs(companyNumber: string): Promise<ProviderPerson[]> {
    return parsePscs(this.lookup(companyNumber).pscs);
  }

  /** The numbers this provider can answer for — the console's demo hint and
   *  the import route's "did you mean" when a firm tries a real number on a
   *  key-less deployment. */
  static knownCompanyNumbers(): string[] {
    return Object.keys(RECORDED_COMPANIES_HOUSE.companies);
  }
}
