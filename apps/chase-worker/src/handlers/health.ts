import type { Env } from "../env.js";
import { resolveProviderKind } from "../provider/index.js";

export function handleHealth(env: Env, requestId: string): Response {
  return Response.json(
    {
      status: "ok",
      service: "chase-worker",
      environment: env.ENVIRONMENT ?? "local",
      // CH-A: visible on /health so nobody has to guess which Companies House
      // implementation a deployment is actually running.
      provider: resolveProviderKind(env),
      timestamp: new Date().toISOString(),
      meta: { requestId },
    },
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
