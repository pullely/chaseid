import {
  CHASE_RISK_WINDOW_DAYS,
  type ChaseAtRiskCompanyRow,
  type ChaseAtRiskReportResponse,
} from "@saas/contracts/chase";
import type { ChasePersonWithCompany } from "@saas/db/chase";
import { displayName, groupPeople, personState } from "./people.js";
import { daysUntilDue } from "./risk.js";

/** The report's rows, from the at-risk people the repository returns: one
 *  row per company, soonest filing first, each naming its unaccounted persons
 *  once — a director who is also a PSC is one name, not two (CL1) — with
 *  `unknown` persons kept apart from `unverified` ones. */
export function buildAtRiskRows(people: ChasePersonWithCompany[], now: Date): ChaseAtRiskCompanyRow[] {
  const byCompany = new Map<string, ChaseAtRiskCompanyRow>();
  const live = people.filter((person) => !person.resignedOn);
  for (const group of groupPeople(live)) {
    const state = personState(group.rows);
    if (state === "verified") continue;
    const first = group.rows[0]!;
    const row = byCompany.get(group.companyId) ?? {
      companyNumber: first.companyNumber,
      companyName: first.companyName,
      nextStatementDue: first.nextStatementDue,
      daysUntilDue: daysUntilDue(first.nextStatementDue, now),
      unverifiedCount: 0,
      unverifiedNames: [],
      unknownCount: 0,
      unknownNames: [],
    };
    if (state === "unverified") {
      row.unverifiedCount += 1;
      row.unverifiedNames.push(displayName(group.rows));
    } else {
      row.unknownCount += 1;
      row.unknownNames.push(displayName(group.rows));
    }
    byCompany.set(group.companyId, row);
  }
  return [...byCompany.values()].sort((a, b) => {
    const da = a.daysUntilDue ?? Number.POSITIVE_INFINITY;
    const db = b.daysUntilDue ?? Number.POSITIVE_INFINITY;
    return da - db || a.companyNumber.localeCompare(b.companyNumber);
  });
}

export function buildAtRiskReport(people: ChasePersonWithCompany[], now: Date): ChaseAtRiskReportResponse {
  return {
    generatedAt: now.toISOString(),
    windowDays: CHASE_RISK_WINDOW_DAYS,
    companies: buildAtRiskRows(people, now),
  };
}

/** CL1 appended the two `unknown_*` columns at the END, so a spreadsheet
 *  keyed on the original six still lines up (risks CL-C). */
export const CSV_HEADER = [
  "company_number",
  "company_name",
  "next_statement_due",
  "days_until_due",
  "unverified_count",
  "unverified_names",
  "unknown_count",
  "unknown_names",
] as const;

/**
 * One CSV cell. Quoted when it carries a comma, quote or newline; and a cell
 * a spreadsheet would read as a formula (`=`, `+`, `-`, `@`, tab, CR) is
 * prefixed with an apostrophe — a company or director name is data a firm
 * did not write, and this file is opened in Excel.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvLine(row: ChaseAtRiskCompanyRow): string {
  return [
    csvCell(row.companyNumber),
    csvCell(row.companyName),
    csvCell(row.nextStatementDue),
    csvCell(row.daysUntilDue),
    csvCell(row.unverifiedCount),
    csvCell(row.unverifiedNames.join("; ")),
    csvCell(row.unknownCount),
    csvCell(row.unknownNames.join("; ")),
  ].join(",");
}

/** The CSV rendering, streamed row by row. Generated per request and never
 *  stored: the report is a view of the register at the moment it is asked
 *  for (risks CH-B). */
export function atRiskCsvStream(rows: ChaseAtRiskCompanyRow[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = -1;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === -1) {
        controller.enqueue(encoder.encode(`${CSV_HEADER.join(",")}\r\n`));
      } else if (index < rows.length) {
        controller.enqueue(encoder.encode(`${csvLine(rows[index]!)}\r\n`));
      } else {
        controller.close();
      }
      index += 1;
    },
  });
}

export function wantsCsv(request: Request): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get("format") === "csv") return true;
  const accept = request.headers.get("accept") ?? "";
  return /\btext\/csv\b/i.test(accept);
}
