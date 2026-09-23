import type { UpdateChaseDirectorResponse } from "@saas/contracts/chase";
import { createChaseRepository } from "@saas/db/chase";
import { createSqlExecutor } from "@saas/db/d1";
import { createEventsRepository } from "@saas/db/events";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { appendChaseEvent } from "../audit.js";
import { errorResponse, successResponse, validationError } from "../http.js";
import { companyPublicId, personPublicId } from "../ids.js";
import { presentDirector } from "../present.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ParsedPatch {
  contactEmail?: string | null;
  verificationState?: "verified" | "unverified";
}

function parsePatch(body: unknown): { ok: true; value: ParsedPatch } | { ok: false; fields: Record<string, string[]> } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, fields: { body: ["must be a JSON object"] } };
  }
  const raw = body as Record<string, unknown>;
  const fields: Record<string, string[]> = {};
  const value: ParsedPatch = {};

  if ("contactEmail" in raw) {
    const email = raw.contactEmail;
    if (email === null || email === "") value.contactEmail = null;
    else if (typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email.trim())) {
      value.contactEmail = email.trim().toLowerCase();
    } else fields.contactEmail = ["must be an email address or null"];
  }

  if ("verificationState" in raw) {
    // Only a person can be marked by hand, and only to the two states a
    // person on staff can actually know. "unknown" is the provider's word.
    const next = raw.verificationState;
    if (next === "verified" || next === "unverified") value.verificationState = next;
    else fields.verificationState = ["must be verified or unverified"];
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  if (value.contactEmail === undefined && value.verificationState === undefined) {
    return { ok: false, fields: { body: ["set contactEmail or verificationState"] } };
  }
  return { ok: true, value };
}

/**
 * `PATCH /v1/organizations/{org}/chase/directors/{prs}` — set the address the
 * firm chases a person at, or mark them verified by hand (the director sent
 * the firm their Companies House personal code before the nightly sync saw
 * it). A manual verification is stamped `verification_source = 'manual'` and
 * audited as `chase.director.verified`.
 */
export async function handleUpdateDirector(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
  personId: string,
): Promise<Response> {
  if (!env.PLATFORM_DB) {
    return errorResponse("internal_error", "Service unavailable", 503, requestId);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", "Invalid JSON body", 400, requestId);
  }
  const parsed = parsePatch(body);
  if (!parsed.ok) return validationError(requestId, parsed.fields);

  const permitted = await requirePermission(env, requestId, actor, orgId, "chase.write");
  if (!permitted.ok) return permitted.response;

  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const before = await createChaseRepository(executor).getPerson(orgId, personId);
    if (!before.ok) return errorResponse("not_found", "Not found", 404, requestId);

    const now = new Date();
    await executor.transaction(async (tx) => {
      const repo = createChaseRepository(tx);
      const patch: { contactEmail?: string | null; verificationState?: "verified" | "unverified"; verifiedOn?: string | null } = {};
      if (parsed.value.contactEmail !== undefined) patch.contactEmail = parsed.value.contactEmail;
      if (parsed.value.verificationState !== undefined) {
        patch.verificationState = parsed.value.verificationState;
        patch.verifiedOn = parsed.value.verificationState === "verified" ? now.toISOString().slice(0, 10) : null;
      }
      const updated = await repo.updatePerson(orgId, personId, patch);
      if (!updated.ok) throw new Error("update failed");

      if (parsed.value.verificationState === "verified" && before.value.verificationState !== "verified") {
        await appendChaseEvent(createEventsRepository(tx), {
          type: "chase.director.verified",
          orgId,
          actor,
          requestId,
          subjectKind: "director",
          subjectId: personPublicId(personId),
          subjectName: before.value.name,
          description: `Marked ${before.value.name} (${before.value.companyNumber}) verified by hand`,
          payload: {
            personId: personPublicId(personId),
            companyId: companyPublicId(before.value.companyId),
            companyNumber: before.value.companyNumber,
            source: "manual",
          },
        });
      }
    });

    const after = await createChaseRepository(executor).getPerson(orgId, personId);
    if (!after.ok) return errorResponse("not_found", "Not found", 404, requestId);
    const response: UpdateChaseDirectorResponse = { director: presentDirector(after.value, now) };
    return successResponse(response, requestId);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
