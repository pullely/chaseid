import type { Env } from "./env.js";
import type { ActorContext } from "./router.js";
import { fetchAuthorizationContext } from "./membership-client.js";
import { authorizeViaPolicy } from "./policy-client.js";
import { errorResponse } from "./http.js";

export type AuthorizeOutcome = { ok: true } | { ok: false; response: Response };

/**
 * Membership first, then policy — the baseline's order — and a denial answers
 * **404**, not 403. Deny-by-default, never leak existence: a firm must not be
 * able to probe whether another firm's org id is real.
 */
export async function requirePermission(
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  action: "chase.read" | "chase.write",
): Promise<AuthorizeOutcome> {
  if (!env.MEMBERSHIP_WORKER || !env.POLICY_WORKER) {
    return { ok: false, response: errorResponse("internal_error", "Service unavailable", 503, requestId) };
  }

  const context = await fetchAuthorizationContext(
    env.MEMBERSHIP_WORKER,
    actor.subjectId,
    actor.subjectType,
    orgId,
    requestId,
  );
  if (!context.ok) {
    return { ok: false, response: errorResponse("not_found", "Not found", 404, requestId) };
  }

  const decision = await authorizeViaPolicy(
    env.POLICY_WORKER,
    actor.subjectId,
    actor.subjectType,
    action,
    { kind: "organization", orgId },
    context.memberships,
    requestId,
  );
  if (!decision.allow) {
    return { ok: false, response: errorResponse("not_found", "Not found", 404, requestId) };
  }

  return { ok: true };
}
