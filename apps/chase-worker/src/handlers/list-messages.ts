import type { ListChaseMessagesResponse } from "@saas/contracts/chase";
import { createChaseRepository } from "@saas/db/chase";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { errorResponse, successResponse } from "../http.js";
import { readPageParams } from "../pagination.js";
import { presentMessage } from "../present.js";

/** `GET /v1/organizations/{org}/chase/messages` — the chase log, newest
 *  first. Append-only underneath; this is the page an auditor is shown. */
export async function handleListMessages(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
): Promise<Response> {
  if (!env.PLATFORM_DB) {
    return errorResponse("internal_error", "Service unavailable", 503, requestId);
  }

  const permitted = await requirePermission(env, requestId, actor, orgId, "chase.read");
  if (!permitted.ok) return permitted.response;

  const page = readPageParams(new URL(request.url));
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const messages = await createChaseRepository(executor).listChaseMessages(orgId, page.limit, page.offset);
    if (!messages.ok) {
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }
    const response: ListChaseMessagesResponse = { messages: messages.value.map(presentMessage) };
    return successResponse(response, requestId, page.nextCursor(messages.value.length));
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
