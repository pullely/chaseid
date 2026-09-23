import type { Env } from "./env.js";
import { errorResponse, withEdgeTimings } from "./http.js";
import { replayOrExecute } from "./idempotency.js";
import { enforceRateLimit, mergeRateLimitHeaders } from "./rate-limit.js";
import { resolveActor } from "./resolve-actor.js";
import { createTimings } from "@saas/contracts/timing";

/**
 * The Chaseid product's own route group, in front of `chase-worker`.
 *
 * Everything sits under `/v1/organizations/{org}/chase/…` on purpose: one
 * prefix, one predicate, one binding. It follows the baseline's facade shape
 * exactly — method allow-list, idempotency replay on the writes, actor
 * resolution, then a forward over the service binding with the actor headers
 * attached.
 */
const CHASE_ROUTES: Array<{ re: RegExp; methods: string[] }> = [
  { re: /^\/v1\/organizations\/[^/]+\/chase\/companies\/import$/, methods: ["POST"] },
  { re: /^\/v1\/organizations\/[^/]+\/chase\/companies\/[^/]+\/sync$/, methods: ["POST"] },
  { re: /^\/v1\/organizations\/[^/]+\/chase\/companies\/[^/]+$/, methods: ["GET", "DELETE"] },
  { re: /^\/v1\/organizations\/[^/]+\/chase\/companies$/, methods: ["GET"] },
  { re: /^\/v1\/organizations\/[^/]+\/chase\/sync-runs$/, methods: ["GET"] },
];

const FORWARDED_HEADERS = [
  "content-type",
  "x-request-id",
  "traceparent",
  "idempotency-key",
];

export function isChaseRoute(pathname: string): boolean {
  return CHASE_ROUTES.some((route) => route.re.test(pathname));
}

function allowedMethods(pathname: string): string[] | null {
  for (const route of CHASE_ROUTES) {
    if (route.re.test(pathname)) return route.methods;
  }
  return null;
}

export async function handleChaseRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  const methods = allowedMethods(pathname);
  if (!methods || !methods.includes(request.method)) {
    return errorResponse("unsupported", "Method not allowed", 405, requestId);
  }

  const rateDecision = await enforceRateLimit(request, requestId, env, "chase");
  if (rateDecision.kind === "denied") return rateDecision.response;
  const rateHeaders = rateDecision.headers;

  if (!env.IDENTITY_WORKER) {
    return mergeRateLimitHeaders(
      errorResponse("internal_error", "Authentication service unavailable", 503, requestId),
      rateHeaders,
    );
  }
  if (!env.CHASE_WORKER) {
    return mergeRateLimitHeaders(
      errorResponse("internal_error", "Chase service unavailable", 503, requestId),
      rateHeaders,
    );
  }

  return replayOrExecute(request, requestId, env, "chase", async () => {
    const timings = createTimings();
    const endTotal = timings.start("edge_total");
    const sessionResult = await timings.measure("edge_auth", () => resolveActor(request, env, requestId));
    if ("error" in sessionResult) return sessionResult.error;

    const headers = new Headers();
    headers.set("x-request-id", requestId);
    headers.set("x-actor-subject-id", sessionResult.subjectId);
    headers.set("x-actor-subject-type", sessionResult.subjectType);
    headers.set("x-actor-email", sessionResult.email);
    for (const name of FORWARDED_HEADERS) {
      if (name === "x-request-id") continue;
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const url = new URL(request.url);
    const target = new URL(pathname + url.search, "https://chase.internal");

    const init: RequestInit = { method: request.method, headers };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.text();
    }

    try {
      const downstream = await timings.measure("edge_downstream", () =>
        env.CHASE_WORKER!.fetch(target.toString(), init),
      );
      endTotal();
      return mergeRateLimitHeaders(
        withEdgeTimings(
          new Response(downstream.body, {
            status: downstream.status,
            headers: downstream.headers,
          }),
          requestId,
          "edge.chase",
          timings,
        ),
        rateHeaders,
      );
    } catch {
      return mergeRateLimitHeaders(
        errorResponse("internal_error", "Chase service unavailable", 503, requestId),
        rateHeaders,
      );
    }
  });
}
