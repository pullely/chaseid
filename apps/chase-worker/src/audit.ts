import type { EventsRepository } from "@saas/db/events";
import type { ActorContext } from "./router.js";
import { orgPublicId } from "./ids.js";

/**
 * One typed emit helper for the whole chase context, modelled on
 * `apps/admin-worker/src/support-events.ts`.
 *
 * It appends through `appendEventWithAudit`, which is the path the audit read
 * surface AND the webhook fan-out both read — `apps/webhooks-worker` cursors
 * `queryEventsByOrg` every minute, so every event named here is deliverable
 * to a firm's webhooks with no further work. The notifications-worker's
 * `emitEvent` POST path is deliberately not used: the route it posts to does
 * not exist, so events sent that way are silently dropped.
 */
export type ChaseEventType =
  | "chase.company.imported"
  | "chase.company.removed"
  | "chase.company.synced"
  | "chase.director.chased"
  | "chase.director.verified"
  | "chase.report.exported";

export interface ChaseEventInput {
  type: ChaseEventType;
  orgId: string;
  actor: ActorContext;
  requestId: string;
  subjectKind: "company" | "director" | "report";
  subjectId: string;
  subjectName: string | null;
  description: string;
  payload: Record<string, unknown>;
}

export async function appendChaseEvent(
  eventsRepo: EventsRepository,
  input: ChaseEventInput,
): Promise<void> {
  await eventsRepo.appendEventWithAudit({
    event: {
      id: crypto.randomUUID(),
      type: input.type,
      version: 1,
      source: "chase-worker",
      occurredAt: new Date(),
      actorType: input.actor.subjectType,
      actorId: input.actor.subjectId,
      orgId: input.orgId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      subjectName: input.subjectName,
      requestId: input.requestId,
      payload: { ...input.payload, orgId: orgPublicId(input.orgId) },
    },
    audit: {
      id: crypto.randomUUID(),
      category: "chase",
      description: input.description,
    },
  });
}
