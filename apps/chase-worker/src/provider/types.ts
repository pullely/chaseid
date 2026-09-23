import type { VerificationState } from "@saas/db/chase";

export interface ProviderCompany {
  companyNumber: string;
  companyName: string;
  companyStatus: "active" | "dissolved" | "liquidation" | "unknown";
  /** ISO date of the next confirmation statement, or null when Companies
   *  House does not publish one (a dissolved company, typically). */
  nextStatementDue: string | null;
}

export interface ProviderPerson {
  /** Stable per person per company: the Companies House appointment link for
   *  an officer, the `self` link for a PSC. It is what an upsert matches on,
   *  so it must not be derived from the name. */
  providerPersonKey: string;
  kind: "officer" | "psc";
  name: string;
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
  verificationState: VerificationState;
  verifiedOn: string | null;
}

export class ProviderNotFoundError extends Error {
  constructor(companyNumber: string) {
    super(`company ${companyNumber} not found`);
    this.name = "ProviderNotFoundError";
  }
}

/**
 * The one seam between Chaseid and Companies House.
 *
 * Two implementations ship: `HttpCompaniesHouseProvider`, which talks to the
 * public API, and `FixtureCompaniesHouseProvider`, which serves recorded
 * responses. The fixture one is not a test double — it is what runs in every
 * environment that has no API key, which today is all of them (see
 * risks-and-open-questions.md CH-A). Both are exercised by the same tests.
 */
export interface CompaniesHouseProvider {
  readonly kind: "http" | "fixture";
  getCompany(companyNumber: string): Promise<ProviderCompany>;
  listOfficers(companyNumber: string): Promise<ProviderPerson[]>;
  listPscs(companyNumber: string): Promise<ProviderPerson[]>;
}

/**
 * Map Companies House's `identity_verification_details` onto the product's
 * three-valued state.
 *
 * The rule that matters is the fallback: anything unrecognised is `unknown`,
 * never `verified`. A board full of `unknown` is a visible, recoverable
 * failure; a board that silently says `verified` is a firm filing late. The
 * fields are three months old and may still move (CH-C), and this function is
 * the only place that has to change when they do.
 */
export function mapVerification(details: unknown): {
  state: VerificationState;
  verifiedOn: string | null;
} {
  if (!details || typeof details !== "object") return { state: "unknown", verifiedOn: null };
  const record = details as Record<string, unknown>;
  const verifiedOn =
    typeof record.identity_verified_on === "string" ? record.identity_verified_on : null;
  if (verifiedOn) return { state: "verified", verifiedOn };
  const statement = record.appointed_on_verification_statement;
  if (typeof statement === "string" && statement.length > 0) {
    return { state: "verified", verifiedOn: statement };
  }
  // The object exists but carries no verification date: Companies House knows
  // about this person and they have not verified.
  return { state: "unverified", verifiedOn: null };
}

export function normaliseCompanyStatus(value: unknown): ProviderCompany["companyStatus"] {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  if (raw === "active") return "active";
  if (raw === "dissolved") return "dissolved";
  if (raw.includes("liquidation")) return "liquidation";
  return "unknown";
}

/** Companies House numbers are eight characters: either eight digits, or a
 *  two-letter prefix and six digits (SC…, NI…, OC…, SO…). A spreadsheet that
 *  dropped the leading zeros is the single commonest import defect, so pad
 *  rather than reject — but pad only a shape that is actually a company
 *  number. "Acme Ltd" is a client name in the wrong column, not `AC0MELTD`. */
export function normaliseCompanyNumber(value: string): string | null {
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, "");
  if (/^\d{1,8}$/.test(trimmed)) return trimmed.padStart(8, "0");
  const prefixed = /^([A-Z]{2})(\d{1,6})$/.exec(trimmed);
  if (prefixed) return prefixed[1]! + prefixed[2]!.padStart(6, "0");
  return null;
}
