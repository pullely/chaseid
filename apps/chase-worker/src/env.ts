export interface Env {
  PLATFORM_DB?: D1Database;
  MEMBERSHIP_WORKER?: Fetcher;
  POLICY_WORKER?: Fetcher;
  /** CH2: the chases go out through the baseline's notifications context.
   *  Unbound, `enqueueNotification` answers `no_binding`, which is recorded
   *  on `chase_messages` and does not advance the step. */
  NOTIFICATIONS_WORKER?: Fetcher;
  /** CH3: the plan's `limit.chase_companies`, checked before an import
   *  writes anything. Unbound, imports are refused (fail closed). */
  BILLING_WORKER?: Fetcher;
  /** CH-F: the provider response cache. Optional on purpose — unbound, the
   *  worker calls Companies House every time rather than failing. */
  CHASE_CACHE?: KVNamespace;
  /** CH-A: absent on this account. Its absence selects the recorded-fixture
   *  provider; it is never a deploy failure. */
  COMPANIES_HOUSE_API_KEY?: string;
  ENVIRONMENT: string;
}
