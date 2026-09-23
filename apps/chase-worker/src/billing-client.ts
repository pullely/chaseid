import type { CheckBillingEntitlementResponse } from "@saas/contracts/billing";

/** The plan allowance Chaseid sells on: how many client companies a firm may
 *  hold on the register. Defined in billing-worker's plan catalog. */
export const COMPANIES_LIMIT_ENTITLEMENT_KEY = "limit.chase_companies";

export type EntitlementResult =
  | { kind: "decision"; decision: CheckBillingEntitlementResponse }
  | { kind: "service_error" };

/** The baseline's entitlement check, over the BILLING_WORKER binding, in the
 *  same shape `projects-worker` uses. Never throws. */
export async function checkEntitlement(
  billingWorker: Fetcher,
  orgPublicId: string,
  entitlementKey: string,
  requestId: string,
): Promise<EntitlementResult> {
  let response: Response;
  try {
    response = await billingWorker.fetch("http://billing-worker/v1/internal/billing/entitlements/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
        "x-internal-caller": "chase-worker",
      },
      body: JSON.stringify({ orgId: orgPublicId, entitlementKey }),
    });
  } catch {
    return { kind: "service_error" };
  }
  if (!response.ok) return { kind: "service_error" };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { kind: "service_error" };
  }
  const data = (parsed as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object" || typeof (data as { allowed?: unknown }).allowed !== "boolean") {
    return { kind: "service_error" };
  }
  return { kind: "decision", decision: data as CheckBillingEntitlementResponse };
}

export type QuotaGate =
  | { kind: "allow"; limit: number | null }
  | { kind: "deny"; reason: string; message: string; limit: number | null };

/**
 * Decide an import against the plan: `after` is the register's size once the
 * import's NEW companies are added (re-imports of known numbers cost
 * nothing). A missing or disabled entitlement denies — fail closed, the
 * baseline's posture.
 */
export function decideCompaniesQuota(decision: CheckBillingEntitlementResponse, after: number): QuotaGate {
  if (!decision.allowed) {
    return {
      kind: "deny",
      reason: decision.reason,
      message: "Your plan does not include a client register allowance",
      limit: null,
    };
  }
  if (decision.valueType !== "quantity") {
    return { kind: "deny", reason: "malformed_limit", message: "Your plan's company allowance is misconfigured", limit: null };
  }
  const limit = decision.limitValue;
  if (limit === null) return { kind: "allow", limit: null };
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
    return { kind: "deny", reason: "malformed_limit", message: "Your plan's company allowance is misconfigured", limit: null };
  }
  if (after > limit) {
    return {
      kind: "deny",
      reason: "limit_reached",
      message: `This import would take the register to ${after} companies; your plan allows ${limit}`,
      limit,
    };
  }
  return { kind: "allow", limit };
}
