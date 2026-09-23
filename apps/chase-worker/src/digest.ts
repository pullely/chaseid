import { asUuid } from "@saas/db";
import type { ChaseAtRiskCompanyRow } from "@saas/contracts/chase";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";
import { createChaseRepository, type ChaseRepository } from "@saas/db/chase";
import { createSqlExecutor, type SqlExecutor } from "@saas/db/d1";
import { createIdentityRepository } from "@saas/db/identity";
import { createMembershipRepository } from "@saas/db/membership";
import {
  buildIdempotencyKey,
  enqueueNotification,
  type EnqueueNotificationResult,
} from "@saas/notifications-client";
import { CRON_ACTOR, windowCutoff } from "./chase.js";
import type { Env } from "./env.js";
import { orgPublicId } from "./ids.js";
import { buildAtRiskRows } from "./report.js";

/** Whether the `0 9 * * *` run is the Monday one. UTC, like the cron. */
export function isDigestDay(now: Date): boolean {
  return now.getUTCDay() === 1;
}

/** The ISO date of the Monday of `now`'s week — the digest's idempotency
 *  period, so a re-run of Monday's cron cannot send a second digest. */
export function digestWeek(now: Date): string {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const offset = (now.getUTCDay() + 6) % 7;
  return new Date(day - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface DigestRecipient {
  userId: string;
  email: string;
  displayName: string | null;
}

export interface DigestOrg {
  orgId: string;
  rows: ChaseAtRiskCompanyRow[];
  chasesSentLastWeek: number;
}

export interface DigestDeps {
  listRecipients: (orgId: string) => Promise<DigestRecipient[]>;
  enqueue: (request: EnqueueNotificationRequest, requestId: string) => Promise<EnqueueNotificationResult>;
  now: () => Date;
}

/** How many companies the digest names before it says "and N more". */
const DIGEST_LINES = 10;

export function digestLines(rows: ChaseAtRiskCompanyRow[]): string {
  const lines = rows.slice(0, DIGEST_LINES).map((row) => {
    const when =
      row.daysUntilDue === null ? "date unknown" : row.daysUntilDue < 0 ? `${-row.daysUntilDue}d overdue` : `due in ${row.daysUntilDue}d`;
    const unknown = row.unknownCount > 0 ? `, ${row.unknownCount} unknown` : "";
    return `${row.companyName || row.companyNumber} (${row.companyNumber}) — ${when}, ${row.unverifiedCount} unverified${unknown}`;
  });
  if (rows.length > DIGEST_LINES) lines.push(`…and ${rows.length - DIGEST_LINES} more`);
  return lines.join("\n");
}

export interface DigestResult {
  orgs: number;
  sent: number;
  failed: number;
}

/**
 * The Monday firm digest: one `chase.firm_digest` per member of every org
 * that has at-risk filings, none for an org that has none. Keyed
 * `chase.firm_digest:<org>:<user>:<monday>` so a re-run is a no-op at the
 * notifications worker.
 */
export async function sendDigests(deps: DigestDeps, orgs: DigestOrg[], requestId: string): Promise<DigestResult> {
  const result: DigestResult = { orgs: 0, sent: 0, failed: 0 };
  const week = digestWeek(deps.now());
  for (const org of orgs) {
    if (org.rows.length === 0) continue;
    result.orgs += 1;
    const recipients = await deps.listRecipients(org.orgId);
    const unverified = org.rows.reduce((sum, row) => sum + row.unverifiedCount, 0);
    for (const recipient of recipients) {
      const sent = await deps.enqueue(
        {
          orgId: org.orgId,
          category: "product",
          templateKey: "chase.firm_digest",
          templateData: {
            recipientName: recipient.displayName,
            companiesAtRisk: org.rows.length,
            unverifiedPeople: unverified,
            chasesSentLastWeek: org.chasesSentLastWeek,
            summary: digestLines(org.rows),
            weekOf: week,
          },
          recipient: { channel: "email", address: recipient.email.toLowerCase() },
          idempotencyKey: buildIdempotencyKey("chase.firm_digest", orgPublicId(org.orgId), recipient.userId, week),
          correlationId: requestId,
        },
        requestId,
      );
      if (sent.ok) result.sent += 1;
      else result.failed += 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Production wiring: recipients are the org's active user members, their
// addresses read from the identity context the baseline already keeps.
// ---------------------------------------------------------------------------

export async function listRecipientsFrom(executor: SqlExecutor, orgId: string): Promise<DigestRecipient[]> {
  const members = await createMembershipRepository(executor).listMembers(asUuid(orgId));
  if (!members.ok) return [];
  const identity = createIdentityRepository(executor);
  const out: DigestRecipient[] = [];
  for (const member of members.value) {
    if (member.subjectType !== "user") continue;
    const user = await identity.getUserById(member.subjectId);
    if (!user.ok || !user.value.email || user.value.status !== "active") continue;
    out.push({ userId: member.subjectId, email: user.value.email, displayName: user.value.displayName });
  }
  return out;
}

export async function collectDigestOrgs(repo: ChaseRepository, now: Date): Promise<DigestOrg[]> {
  const cutoff = windowCutoff(now);
  const orgIds = await repo.listOrgsWithAtRisk(cutoff);
  if (!orgIds.ok) return [];
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const out: DigestOrg[] = [];
  for (const orgId of orgIds.value) {
    const people = await repo.listPeople({ orgId, limit: 10_000, offset: 0, risk: "at_risk", riskCutoff: cutoff });
    if (!people.ok) continue;
    const sent = await repo.countChaseMessagesSince(orgId, weekAgo);
    out.push({ orgId, rows: buildAtRiskRows(people.value, now), chasesSentLastWeek: sent.ok ? sent.value : 0 });
  }
  return out;
}

/** The `0 9 * * *` cron's Monday half. */
export async function runFirmDigest(env: Env): Promise<DigestResult | null> {
  if (!env.PLATFORM_DB) return null;
  const now = new Date();
  if (!isDigestDay(now)) return null;
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const orgs = await collectDigestOrgs(createChaseRepository(executor), now);
    const requestId = `req_cron_digest_${Date.now().toString(16)}`;
    return await sendDigests(
      {
        listRecipients: (orgId) => listRecipientsFrom(executor, orgId),
        enqueue: (request, rid) =>
          enqueueNotification(
            env,
            {
              internalActor: "chase-worker",
              actorSubjectType: CRON_ACTOR.subjectType,
              actorSubjectId: CRON_ACTOR.subjectId,
              requestId: rid,
            },
            request,
          ),
        now: () => now,
      },
      orgs,
      requestId,
    );
  } finally {
    await executor.dispose();
  }
}
