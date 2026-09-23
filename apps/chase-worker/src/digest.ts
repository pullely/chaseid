import type { ChaseAtRiskCompanyRow } from "@saas/contracts/chase";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";
import type { EnqueueNotificationResult } from "@saas/notifications-client";
import { buildIdempotencyKey } from "@saas/notifications-client";
import { orgPublicId } from "./ids.js";

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
    return `${row.companyName || row.companyNumber} (${row.companyNumber}) — ${when}, ${row.unverifiedCount} unverified`;
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
