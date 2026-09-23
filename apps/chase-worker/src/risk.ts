import { CHASE_RISK_WINDOW_DAYS, type ChaseRisk } from "@saas/contracts/chase";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from `today` to the confirmation-statement date. Negative when
 *  the filing date has already passed — an overdue statement is more urgent,
 *  not less, so callers compare with `<=`, never with a range. */
export function daysUntilDue(nextStatementDue: string | null, now: Date): number | null {
  if (!nextStatementDue) return null;
  const due = Date.parse(`${nextStatementDue.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(due)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((due - today) / MS_PER_DAY);
}

/**
 * The product's one derived value.
 *
 * `at_risk` is the only state that means anything operationally: a filing
 * inside the window with at least one person on the board who has not
 * verified. `due_soon` is a filing inside the window whose people are all
 * accounted for. Everything else is `ok`.
 *
 * Derived on read and never stored, so a date arriving from a nightly sync
 * cannot leave a stale risk flag behind it.
 */
export function deriveRisk(
  days: number | null,
  unverifiedCount: number,
): ChaseRisk {
  if (days === null || days > CHASE_RISK_WINDOW_DAYS) return "ok";
  return unverifiedCount > 0 ? "at_risk" : "due_soon";
}

export { CHASE_RISK_WINDOW_DAYS };
