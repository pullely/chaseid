export interface Env {
  PLATFORM_DB?: D1Database;
  MEMBERSHIP_WORKER?: Fetcher;
  POLICY_WORKER?: Fetcher;
  /** CH-F: the provider response cache. Optional on purpose — unbound, the
   *  worker calls Companies House every time rather than failing. */
  CHASE_CACHE?: KVNamespace;
  /** CH-A: absent on this account. Its absence selects the recorded-fixture
   *  provider; it is never a deploy failure. */
  COMPANIES_HOUSE_API_KEY?: string;
  ENVIRONMENT: string;
}
