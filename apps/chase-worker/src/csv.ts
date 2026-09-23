import { normaliseCompanyNumber } from "./provider/index.js";

export interface ParsedImportRow {
  companyNumber: string;
  contactName: string | null;
  contactEmail: string | null;
}

export interface ParsedImport {
  rows: ParsedImportRow[];
  rejected: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((value) => value.trim());
}

/**
 * Parse the firm's import.
 *
 * The header is `company_number,person_name,person_email`; the last two are
 * optional per row, because a firm often has the book long before it has the
 * addresses. Columns are matched by NAME, not position, so a spreadsheet with
 * extra columns in a different order still imports — that is the single
 * commonest thing a practice hands you.
 *
 * A header-less file is accepted too: a file whose first field already looks
 * like a company number is treated as one column of company numbers, which is
 * what "paste your client list" actually produces.
 *
 * Rows that carry no recognisable company number are counted in `rejected`
 * and dropped. Nothing here throws: a bad row must not cost a firm the other
 * 1,999.
 */
export function parseImportCsv(text: string): ParsedImport {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return { rows: [], rejected: 0 };

  const first = splitCsvLine(lines[0]!);
  const lowered = first.map((value) => value.toLowerCase().replace(/[^a-z]/g, ""));
  const hasHeader = lowered.some((value) => value.includes("companynumber") || value === "company" || value === "number");

  let numberIndex = 0;
  let nameIndex = -1;
  let emailIndex = -1;
  let start = 0;

  if (hasHeader) {
    start = 1;
    numberIndex = lowered.findIndex((v) => v.includes("companynumber") || v === "company" || v === "number");
    nameIndex = lowered.findIndex((v) => v.includes("name"));
    emailIndex = lowered.findIndex((v) => v.includes("email"));
    if (numberIndex < 0) numberIndex = 0;
  } else {
    // Positional fallback for a header-less paste.
    nameIndex = first.length > 1 ? 1 : -1;
    emailIndex = first.length > 2 ? 2 : -1;
  }

  const rows: ParsedImportRow[] = [];
  let rejected = 0;

  for (let i = start; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]!);
    const rawNumber = fields[numberIndex] ?? "";
    const companyNumber = normaliseCompanyNumber(rawNumber);
    if (!companyNumber) {
      rejected += 1;
      continue;
    }
    const rawName = nameIndex >= 0 ? (fields[nameIndex] ?? "") : "";
    const rawEmail = emailIndex >= 0 ? (fields[emailIndex] ?? "") : "";
    const email = EMAIL_RE.test(rawEmail) ? rawEmail.toLowerCase() : null;
    rows.push({
      companyNumber,
      contactName: rawName.length > 0 ? rawName : null,
      contactEmail: email,
    });
  }

  return { rows, rejected };
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}
