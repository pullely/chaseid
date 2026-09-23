import type { ImportChaseCompaniesResponse } from "@saas/contracts/chase";
import type { ChaseCompany } from "@saas/db/chase";
import { createChaseRepository } from "@saas/db/chase";
import { createEventsRepository } from "@saas/db/events";
import { createSqlExecutor } from "@saas/db/d1";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { requirePermission } from "../authorize.js";
import { appendChaseEvent } from "../audit.js";
import { isValidEmail, parseImportCsv, type ParsedImportRow } from "../csv.js";
import { errorResponse, successResponse, validationError } from "../http.js";
import { companyPublicId, syncRunPublicId } from "../ids.js";
import { normaliseCompanyNumber, resolveProvider } from "../provider/index.js";
import { sweepCompanies } from "../sync.js";

/** A single request may not import more than this. A firm with a bigger book
 *  sends it in pages; the alternative is a Worker invocation that times out
 *  half-way and leaves a register nobody can reason about. */
const MAX_ROWS = 500;

function rowsFromJson(body: unknown): ParsedImportRow[] | null {
  if (!body || typeof body !== "object") return null;
  const companies = (body as { companies?: unknown }).companies;
  if (!Array.isArray(companies)) return null;
  const rows: ParsedImportRow[] = [];
  for (const raw of companies) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { companyNumber?: unknown; contacts?: unknown };
    const number = typeof entry.companyNumber === "string" ? normaliseCompanyNumber(entry.companyNumber) : null;
    if (!number) continue;
    const contacts = Array.isArray(entry.contacts) ? entry.contacts : [];
    if (contacts.length === 0) {
      rows.push({ companyNumber: number, contactName: null, contactEmail: null });
      continue;
    }
    for (const contact of contacts) {
      if (!contact || typeof contact !== "object") continue;
      const person = contact as { name?: unknown; email?: unknown };
      const email = typeof person.email === "string" && isValidEmail(person.email) ? person.email.toLowerCase() : null;
      rows.push({
        companyNumber: number,
        contactName: typeof person.name === "string" && person.name.length > 0 ? person.name : null,
        contactEmail: email,
      });
    }
  }
  return rows;
}

/**
 * `POST /v1/organizations/{org}/chase/companies/import`
 *
 * Takes `text/csv` (`company_number,person_name,person_email`) or JSON, and
 * does three things in order: upsert the companies, sync them through the
 * provider so there are people to attach addresses to, then attach the
 * addresses the firm supplied by matching on normalised name.
 *
 * That order is the point. Companies House publishes no personal email
 * addresses (CH-E), so the firm's column is the only way a chase ever reaches
 * anyone — but the people it names do not exist as rows until the sync has
 * run. Importing and syncing are therefore one operation, not two.
 */
export async function handleImportCompanies(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
): Promise<Response> {
  if (!env.PLATFORM_DB) {
    return errorResponse("internal_error", "Service unavailable", 503, requestId);
  }

  const permitted = await requirePermission(env, requestId, actor, orgId, "chase.write");
  if (!permitted.ok) return permitted.response;

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  let rows: ParsedImportRow[];
  let rejected = 0;

  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    const parsed = parseImportCsv(await request.text());
    rows = parsed.rows;
    rejected = parsed.rejected;
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return validationError(requestId, { body: ["Invalid JSON"] });
    }
    const parsed = rowsFromJson(body);
    if (parsed === null) {
      return validationError(requestId, {
        companies: ["Send text/csv, or JSON of the shape { companies: [{ companyNumber, contacts? }] }"],
      });
    }
    rows = parsed;
  }

  if (rows.length === 0) {
    return validationError(requestId, {
      companies: ["No usable company numbers. A Companies House number is up to 8 characters, e.g. 01234567 or SC123456."],
    });
  }
  if (rows.length > MAX_ROWS) {
    return errorResponse(
      "precondition_failed",
      `An import carries at most ${MAX_ROWS} rows; send the rest in a second request`,
      412,
      requestId,
      { rows: rows.length, max: MAX_ROWS },
    );
  }

  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const repo = createChaseRepository(executor);
    const eventsRepo = createEventsRepository(executor);

    let imported = 0;
    let updated = 0;
    const touched = new Map<string, ChaseCompany>();

    for (const row of rows) {
      if (touched.has(row.companyNumber)) continue;
      const result = await repo.upsertCompany({
        id: crypto.randomUUID(),
        orgId,
        companyNumber: row.companyNumber,
        source: "csv",
      });
      if (!result.ok) continue;
      touched.set(row.companyNumber, result.value.company);
      if (result.value.created) imported += 1;
      else updated += 1;
    }

    const provider = resolveProvider(env);
    const now = new Date();
    const sweep = await sweepCompanies(
      repo,
      provider,
      orgId,
      [...touched.values()],
      "import",
      env.CHASE_CACHE,
      now,
    );

    // Addresses last: the people they name only exist now.
    let contactsMatched = 0;
    for (const row of rows) {
      if (!row.contactName || !row.contactEmail) continue;
      const company = touched.get(row.companyNumber);
      if (!company) continue;
      const matched = await repo.setContactEmailByName(company.id, row.contactName, row.contactEmail);
      if (matched.ok) contactsMatched += matched.value;
    }

    for (const company of touched.values()) {
      await appendChaseEvent(eventsRepo, {
        type: "chase.company.imported",
        orgId,
        actor,
        requestId,
        subjectKind: "company",
        subjectId: companyPublicId(company.id),
        subjectName: company.companyNumber,
        description: `Imported company ${company.companyNumber} into the chase register`,
        payload: { companyId: companyPublicId(company.id), companyNumber: company.companyNumber },
      });
    }

    const response: ImportChaseCompaniesResponse = {
      imported,
      updated,
      skipped: rejected,
      contactsMatched,
      syncRunId: syncRunPublicId(sweep.syncRunId),
      provider: sweep.provider,
    };
    return successResponse(response, requestId);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}
