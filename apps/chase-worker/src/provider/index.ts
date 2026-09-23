import type { Env } from "../env.js";
import { FixtureCompaniesHouseProvider } from "./fixture.js";
import { HttpCompaniesHouseProvider } from "./http.js";
import type { CompaniesHouseProvider } from "./types.js";

/**
 * One key decides which Companies House the product talks to.
 *
 * Same shape as the baseline's `resolveProvider(env)` for email
 * (apps/notifications-worker/src/providers/index.ts): a deployment-time fact
 * picks an implementation, and nothing downstream knows or cares which it
 * got. `COMPANIES_HOUSE_API_KEY` is declared `optionalSecretEnv`, so its
 * absence is not a deploy failure — it is the normal case today.
 */
export function resolveProvider(env: Env): CompaniesHouseProvider {
  const key = (env.COMPANIES_HOUSE_API_KEY ?? "").trim();
  if (key.length > 0) return new HttpCompaniesHouseProvider(key);
  return new FixtureCompaniesHouseProvider();
}

export function resolveProviderKind(env: Env): "http" | "fixture" {
  return (env.COMPANIES_HOUSE_API_KEY ?? "").trim().length > 0 ? "http" : "fixture";
}

export { FixtureCompaniesHouseProvider } from "./fixture.js";
export { HttpCompaniesHouseProvider, ProviderRateLimitedError, ProviderRequestError } from "./http.js";
export { ProviderNotFoundError, mapVerification, normaliseCompanyNumber, normaliseCompanyStatus } from "./types.js";
export type { CompaniesHouseProvider, ProviderCompany, ProviderPerson } from "./types.js";
export { parseCompanyProfile, parseOfficers, parsePscs } from "./parse.js";
