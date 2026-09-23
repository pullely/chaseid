import {
  CHASE_RISK_WINDOW_DAYS,
  CHASE_STEP_INTERVAL_DAYS,
  CHASE_TEMPLATE_KEYS,
} from "@saas/contracts/chase";
import type { ChaseMessage, ChasePersonWithCompany, ChaseRepository } from "@saas/db/chase";
import { createChaseRepository } from "@saas/db/chase";
import { createSqlExecutor, type SqlExecutor, type TransactionalSqlExecutor } from "@saas/db/d1";
import { createEventsRepository } from "@saas/db/events";
import {
  buildIdempotencyKey,
  enqueueNotification,
  type EnqueueNotificationResult,
  type NotificationsEnvBinding,
} from "@saas/notifications-client";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";
import { appendChaseEvent } from "./audit.js";
import type { Env } from "./env.js";
import { companyPublicId, personPublicId } from "./ids.js";
import { daysUntilDue } from "./risk.js";
import type { ActorContext } from "./router.js";

/** The last step. After the escalation the product stops writing to the
 *  person; the firm's own staff take it from there. */
export const FINAL_CHASE_STEP = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How many people one `0 9 * * *` invocation chases. The query is ordered
 *  soonest filing first, so a larger book finishes on the next morning's run
 *  and never at the expense of the most urgent filings. */
const CHASE_BATCH = 200;

/** The actor every cron-driven write is attributed to on the audit trail. */
export const CRON_ACTOR: ActorContext = { subjectType: "system", subjectId: "chase-worker" };

export type ChaseSkipReason =
  | "not_unverified"
  | "resigned"
  | "no_contact"
  | "outside_window"
  | "interval_not_elapsed"
  | "complete";

export type ChaseDecision =
  | { send: true; step: number; templateKey: string }
  | { send: false; reason: ChaseSkipReason };

export function templateForStep(step: number): string {
  const index = Math.min(Math.max(step, 1), FINAL_CHASE_STEP) - 1;
  return CHASE_TEMPLATE_KEYS[index]!;
}

/**
 * The chase state machine — the one place that decides whether a person is
 * written to today, and with which step.
 *
 *   step 0 → 1  the person is unverified and their company files within
 *               the risk window
 *   step 1 → 2  seven days after step 1 without a change
 *   step 2 → 3  seven days after step 2
 *   step 3      final; nothing more is sent
 *
 * `manual` is the firm pressing "chase now": it skips the window and the
 * interval (a person on staff decided), but never the facts that make a chase
 * wrong — a verified or resigned person, or nobody to write to.
 *
 * A re-run on the same day is a no-op by construction: the step it would send
 * is the step already recorded, and its interval has not elapsed. The
 * notifications idempotency key (`chase:<prs>:<step>`) is the second lock.
 */
export function decideChase(
  person: Pick<
    ChasePersonWithCompany,
    "verificationState" | "resignedOn" | "contactEmail" | "chaseStep" | "lastChasedAt" | "nextStatementDue"
  >,
  now: Date,
  mode: "sweep" | "manual" = "sweep",
): ChaseDecision {
  if (person.verificationState !== "unverified") return { send: false, reason: "not_unverified" };
  if (person.resignedOn) return { send: false, reason: "resigned" };
  if (!person.contactEmail) return { send: false, reason: "no_contact" };
  if (person.chaseStep >= FINAL_CHASE_STEP) return { send: false, reason: "complete" };

  const next = person.chaseStep + 1;

  if (mode === "sweep") {
    const days = daysUntilDue(person.nextStatementDue, now);
    if (days === null || days > CHASE_RISK_WINDOW_DAYS) return { send: false, reason: "outside_window" };

    if (person.chaseStep > 0) {
      const last = person.lastChasedAt ? Date.parse(person.lastChasedAt) : Number.NaN;
      if (!Number.isNaN(last) && now.getTime() - last < CHASE_STEP_INTERVAL_DAYS * MS_PER_DAY) {
        return { send: false, reason: "interval_not_elapsed" };
      }
    }
  }

  return { send: true, step: next, templateKey: templateForStep(next) };
}

export interface ChaseDeps {
  repo: ChaseRepository;
  /** Runs the three writes of one chase atomically. Production wraps
   *  `executor.transaction`; tests pass the repo straight through. */
  transact: <T>(fn: (repo: ChaseRepository, executor: SqlExecutor | null) => Promise<T>) => Promise<T>;
  enqueue: (request: EnqueueNotificationRequest, requestId: string) => Promise<EnqueueNotificationResult>;
  now: () => Date;
}

export interface ChaseOneResult {
  decision: ChaseDecision;
  message: ChaseMessage | null;
}

/**
 * Chase one person: decide, enqueue, then — in one transaction — the
 * `chase_messages` row, the step advance and the `chase.director.chased`
 * audit event. The enqueue sits outside the transaction because it is a
 * network call to another Worker; its verdict is recorded verbatim, so a
 * chase that never left the building is still on the AML file.
 */
export async function chaseOne(
  deps: ChaseDeps,
  person: ChasePersonWithCompany,
  actor: ActorContext,
  requestId: string,
  mode: "sweep" | "manual",
): Promise<ChaseOneResult> {
  const now = deps.now();
  const decision = decideChase(person, now, mode);
  if (!decision.send) return { decision, message: null };

  const days = daysUntilDue(person.nextStatementDue, now);
  const prs = personPublicId(person.id);
  const result = await deps.enqueue(
    {
      orgId: person.orgId,
      category: "product",
      templateKey: decision.templateKey,
      templateData: {
        personName: person.name,
        companyName: person.companyName,
        companyNumber: person.companyNumber,
        nextStatementDue: person.nextStatementDue,
        daysUntilDue: days,
        step: decision.step,
      },
      recipient: { channel: "email", address: person.contactEmail!.toLowerCase() },
      idempotencyKey: buildIdempotencyKey("chase", prs, String(decision.step)),
      correlationId: requestId,
    },
    requestId,
  );

  const sentAt = now.toISOString();
  const message = await deps.transact(async (repo, executor) => {
    const recorded = await repo.recordChaseMessage({
      id: crypto.randomUUID(),
      orgId: person.orgId,
      personId: person.id,
      companyId: person.companyId,
      step: decision.step,
      toAddress: person.contactEmail!.toLowerCase(),
      templateKey: decision.templateKey,
      notificationId: result.ok ? result.notificationId : null,
      enqueueResult: result.ok ? "ok" : result.reason,
    });
    if (!recorded.ok) throw new Error("chase_messages insert failed");

    // Only a chase that left the building moves the clock. A failed enqueue
    // is on the record above and is retried by tomorrow's sweep at the same
    // step, rather than silently skipping a notice the person never got.
    if (result.ok) {
      const advanced = await repo.advanceChaseStep(person.id, decision.step, sentAt);
      if (!advanced.ok) throw new Error("chase step advance failed");
    }

    if (executor) {
      await appendChaseEvent(createEventsRepository(executor), {
        type: "chase.director.chased",
        orgId: person.orgId,
        actor,
        requestId,
        subjectKind: "director",
        subjectId: prs,
        subjectName: person.name,
        description: `Sent chase step ${decision.step} (${decision.templateKey}) to ${person.name} for ${person.companyNumber}`,
        payload: {
          personId: prs,
          companyId: companyPublicId(person.companyId),
          companyNumber: person.companyNumber,
          step: decision.step,
          templateKey: decision.templateKey,
          enqueueResult: result.ok ? "ok" : result.reason,
          mode,
        },
      });
    }
    return recorded.value;
  });

  return { decision, message };
}

export interface ChaseSweepResult {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
}

/** The sweep over a list of candidates. Pure over its deps so the state
 *  machine's day-by-day behaviour is testable without D1 or a Worker. */
export async function sweepChases(
  deps: ChaseDeps,
  candidates: ChasePersonWithCompany[],
  requestId: string,
): Promise<ChaseSweepResult> {
  const result: ChaseSweepResult = { considered: 0, sent: 0, skipped: 0, failed: 0 };
  for (const person of candidates) {
    result.considered += 1;
    try {
      const one = await chaseOne(deps, person, CRON_ACTOR, requestId, "sweep");
      if (one.message) result.sent += 1;
      else result.skipped += 1;
    } catch {
      // One person's failed write must not stop the morning's chases.
      result.failed += 1;
    }
  }
  return result;
}

/** The production deps, over one executor. */
export function chaseDepsFor(
  env: Env & NotificationsEnvBinding,
  executor: TransactionalSqlExecutor,
  actor: ActorContext,
): ChaseDeps {
  return {
    repo: createChaseRepository(executor),
    transact: (fn) => executor.transaction((tx) => fn(createChaseRepository(tx), tx)),
    enqueue: (request, requestId) =>
      enqueueNotification(
        env,
        {
          internalActor: "chase-worker",
          actorSubjectType: actor.subjectType,
          actorSubjectId: actor.subjectId,
          requestId,
        },
        request,
      ),
    now: () => new Date(),
  };
}

/** The ISO date `days` from `now` — the risk-window cutoff the candidate
 *  query filters on. */
export function windowCutoff(now: Date, days: number = CHASE_RISK_WINDOW_DAYS): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The `0 9 * * *` cron's chase half. */
export async function runChaseSweep(env: Env): Promise<ChaseSweepResult | null> {
  if (!env.PLATFORM_DB) return null;
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const deps = chaseDepsFor(env, executor, CRON_ACTOR);
    const candidates = await deps.repo.listChaseCandidates(windowCutoff(deps.now()), CHASE_BATCH);
    if (!candidates.ok || candidates.value.length === 0) return null;
    const requestId = `req_cron_chase_${Date.now().toString(16)}`;
    return await sweepChases(deps, candidates.value, requestId);
  } finally {
    await executor.dispose();
  }
}

