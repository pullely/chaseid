/**
 * Pure helpers for the Chaseid console pages. Dependency-free (no React) so
 * the CSV parsing and the badge mapping are unit-testable on their own.
 */
import type {
  ChaseImportCompany,
  ChaseRisk,
  ChaseVerificationState,
} from "@saas/contracts/chase";

export type BadgeVariant = "default" | "secondary" | "destructive" | "warning" | "success" | "outline";

export const RISK_LABEL: Record<ChaseRisk, string> = {
  at_risk: "At risk",
  due_soon: "Due soon",
  ok: "OK",
};

export const RISK_VARIANT: Record<ChaseRisk, BadgeVariant> = {
  at_risk: "destructive",
  due_soon: "warning",
  ok: "secondary",
};

export const STATE_LABEL: Record<ChaseVerificationState, string> = {
  verified: "Verified",
  unverified: "Unverified",
  unknown: "Unknown",
};

export const STATE_VARIANT: Record<ChaseVerificationState, BadgeVariant> = {
  verified: "success",
  unverified: "destructive",
  unknown: "outline",
};

export const STEP_LABEL: Record<number, string> = {
  0: "Not chased",
  1: "First notice",
  2: "Reminder",
  3: "Escalated",
};

export function formatDaysUntilDue(days: number | null): string {
  if (days === null) return "—";
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "today";
  return `${days}d`;
}

/**
 * Parse the register CSV (`company_number,person_name,person_email`, one row
 * per person, header optional) into the import route's JSON body. A company
 * with no contacts is a row with the name and email left empty. Company
 * numbers are upper-cased and left-padded to eight characters, which is how
 * Companies House prints them.
 */
export function parseRegisterCsv(text: string): { companies: ChaseImportCompany[]; skipped: number } {
  const byNumber = new Map<string, ChaseImportCompany>();
  let skipped = 0;
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(",").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1").trim());
    if (index === 0 && /company/i.test(cells[0] ?? "")) continue; // header
    const number = normaliseCompanyNumber(cells[0] ?? "");
    if (!number) {
      skipped += 1;
      continue;
    }
    const company = byNumber.get(number) ?? { companyNumber: number, contacts: [] };
    const name = cells[1] ?? "";
    const email = cells[2] ?? "";
    if (name && email) company.contacts!.push({ name, email });
    byNumber.set(number, company);
  }
  return { companies: [...byNumber.values()], skipped };
}

export function normaliseCompanyNumber(value: string): string | null {
  const cleaned = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(cleaned)) return null;
  return /^\d+$/.test(cleaned) ? cleaned.padStart(8, "0") : cleaned;
}

/** The Download CSV file name: firm slug and the day it was generated. */
export function reportFileName(orgSlug: string, now: Date): string {
  const safe = orgSlug.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "firm";
  return `chaseid-at-risk-${safe}-${now.toISOString().slice(0, 10)}.csv`;
}
