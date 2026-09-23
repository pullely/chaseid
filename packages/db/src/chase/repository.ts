import type { SqlExecutor } from "../d1/executor.js";
import type {
  ApplySyncInput,
  ChaseCompany,
  ChaseMessage,
  ChasePerson,
  ChasePersonWithCompany,
  ChaseRepository,
  ChaseResult,
  ChaseSyncRun,
  FinishSyncRunInput,
  ListCompaniesParams,
  ListPeopleParams,
  RecordChaseMessageInput,
  StartSyncRunInput,
  UpsertCompanyInput,
  UpsertPersonInput,
  VerificationState,
} from "./types.js";

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableStr(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function mapCompany(row: Record<string, unknown>): ChaseCompany {
  return {
    id: str(row.id),
    orgId: str(row.org_id),
    companyNumber: str(row.company_number),
    companyName: str(row.company_name),
    companyStatus: str(row.company_status) as ChaseCompany["companyStatus"],
    nextStatementDue: nullableStr(row.next_statement_due),
    lastSyncedAt: nullableStr(row.last_synced_at),
    lastSyncState: str(row.last_sync_state) as ChaseCompany["lastSyncState"],
    lastSyncError: nullableStr(row.last_sync_error),
    source: str(row.source) as ChaseCompany["source"],
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

function mapPerson(row: Record<string, unknown>): ChasePerson {
  return {
    id: str(row.id),
    orgId: str(row.org_id),
    companyId: str(row.company_id),
    providerPersonKey: str(row.provider_person_key),
    kind: str(row.kind) as ChasePerson["kind"],
    name: str(row.name),
    role: str(row.role),
    appointedOn: nullableStr(row.appointed_on),
    resignedOn: nullableStr(row.resigned_on),
    verificationState: str(row.verification_state) as VerificationState,
    verificationSource: str(row.verification_source) as ChasePerson["verificationSource"],
    verifiedOn: nullableStr(row.verified_on),
    contactEmail: nullableStr(row.contact_email),
    chaseStep: Number(row.chase_step ?? 0),
    lastChasedAt: nullableStr(row.last_chased_at),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

function mapPersonWithCompany(row: Record<string, unknown>): ChasePersonWithCompany {
  return {
    ...mapPerson(row),
    companyNumber: str(row.company_number),
    companyName: str(row.company_name),
    nextStatementDue: nullableStr(row.next_statement_due),
  };
}

function mapSyncRun(row: Record<string, unknown>): ChaseSyncRun {
  return {
    id: str(row.id),
    orgId: str(row.org_id),
    trigger: str(row.trigger) as ChaseSyncRun["trigger"],
    provider: str(row.provider) as ChaseSyncRun["provider"],
    startedAt: str(row.started_at),
    finishedAt: nullableStr(row.finished_at),
    companiesScanned: Number(row.companies_scanned ?? 0),
    peopleUpserted: Number(row.people_upserted ?? 0),
    errors: Number(row.errors ?? 0),
    createdAt: str(row.created_at),
  };
}

function mapMessage(row: Record<string, unknown>): ChaseMessage {
  return {
    id: str(row.id),
    orgId: str(row.org_id),
    personId: str(row.person_id),
    companyId: str(row.company_id),
    step: Number(row.step ?? 0),
    channel: str(row.channel),
    toAddress: str(row.to_address),
    templateKey: str(row.template_key),
    notificationId: nullableStr(row.notification_id),
    enqueueResult: str(row.enqueue_result) as ChaseMessage["enqueueResult"],
    sentAt: str(row.sent_at),
  };
}

function internal(error: unknown): { ok: false; error: { kind: "internal"; message: string } } {
  return {
    ok: false,
    error: { kind: "internal", message: error instanceof Error ? error.message : String(error) },
  };
}

const COMPANY_COLUMNS =
  "id, org_id, company_number, company_name, company_status, next_statement_due, last_synced_at, last_sync_state, last_sync_error, source, created_at, updated_at";
const PERSON_COLUMNS =
  "id, org_id, company_id, provider_person_key, kind, name, role, appointed_on, resigned_on, verification_state, verification_source, verified_on, contact_email, chase_step, last_chased_at, created_at, updated_at";
const RUN_COLUMNS =
  "id, org_id, trigger, provider, started_at, finished_at, companies_scanned, people_upserted, errors, created_at";
const MESSAGE_COLUMNS =
  "id, org_id, person_id, company_id, step, channel, to_address, template_key, notification_id, enqueue_result, sent_at";

/** Normalise a name for the CSV contact match: case-folded, punctuation
 *  dropped, whitespace collapsed. Companies House renders officer names
 *  "SURNAME, Forename" while a firm's spreadsheet writes "Forename Surname",
 *  so the comparison is over the sorted token set, not the string. */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .sort()
    .join(" ");
}

export function createChaseRepository(executor: SqlExecutor): ChaseRepository {
  return {
    async upsertCompany(input: UpsertCompanyInput): Promise<ChaseResult<{ company: ChaseCompany; created: boolean }>> {
      try {
        const inserted = await executor.execute<Record<string, unknown>>(
          `INSERT INTO chase_companies (id, org_id, company_number, source)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (org_id, company_number) DO NOTHING
             RETURNING ${COMPANY_COLUMNS}`,
          [input.id, input.orgId, input.companyNumber, input.source],
        );
        if (inserted.rows.length > 0) {
          return { ok: true, value: { company: mapCompany(inserted.rows[0]!), created: true } };
        }
        const existing = await executor.execute<Record<string, unknown>>(
          `SELECT ${COMPANY_COLUMNS} FROM chase_companies WHERE org_id = $1 AND company_number = $2`,
          [input.orgId, input.companyNumber],
        );
        if (existing.rows.length === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: { company: mapCompany(existing.rows[0]!), created: false } };
      } catch (error) {
        return internal(error);
      }
    },

    async getCompany(orgId: string, companyId: string): Promise<ChaseResult<ChaseCompany>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${COMPANY_COLUMNS} FROM chase_companies WHERE org_id = $1 AND id = $2`,
          [orgId, companyId],
        );
        if (result.rows.length === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapCompany(result.rows[0]!) };
      } catch (error) {
        return internal(error);
      }
    },

    async getCompanyByNumber(orgId: string, companyNumber: string): Promise<ChaseResult<ChaseCompany>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${COMPANY_COLUMNS} FROM chase_companies WHERE org_id = $1 AND company_number = $2`,
          [orgId, companyNumber],
        );
        if (result.rows.length === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapCompany(result.rows[0]!) };
      } catch (error) {
        return internal(error);
      }
    },

    async listCompanies(params: ListCompaniesParams): Promise<ChaseResult<ChaseCompany[]>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${COMPANY_COLUMNS} FROM chase_companies
             WHERE org_id = $1
             ORDER BY (next_statement_due IS NULL), next_statement_due ASC, id ASC
             LIMIT $2 OFFSET $3`,
          [params.orgId, params.limit, params.offset],
        );
        return { ok: true, value: result.rows.map(mapCompany) };
      } catch (error) {
        return internal(error);
      }
    },

    async countCompanies(orgId: string): Promise<ChaseResult<number>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT COUNT(*) AS n FROM chase_companies WHERE org_id = $1`,
          [orgId],
        );
        return { ok: true, value: Number(result.rows[0]?.n ?? 0) };
      } catch (error) {
        return internal(error);
      }
    },

    async listCompaniesForSweep(limit: number): Promise<ChaseResult<ChaseCompany[]>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${COMPANY_COLUMNS} FROM chase_companies
             WHERE company_status <> 'dissolved'
             ORDER BY (last_synced_at IS NOT NULL), last_synced_at ASC, id ASC
             LIMIT $1`,
          [limit],
        );
        return { ok: true, value: result.rows.map(mapCompany) };
      } catch (error) {
        return internal(error);
      }
    },

    async applySync(input: ApplySyncInput): Promise<ChaseResult<void>> {
      try {
        await executor.execute(
          `UPDATE chase_companies
              SET company_name = $1,
                  company_status = $2,
                  next_statement_due = $3,
                  last_sync_state = $4,
                  last_sync_error = $5,
                  last_synced_at = $6,
                  updated_at = $6
            WHERE id = $7`,
          [
            input.companyName,
            input.companyStatus,
            input.nextStatementDue,
            input.syncState,
            input.syncError,
            input.syncedAt,
            input.companyId,
          ],
        );
        return { ok: true, value: undefined };
      } catch (error) {
        return internal(error);
      }
    },

    async deleteCompany(orgId: string, companyId: string): Promise<ChaseResult<void>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `DELETE FROM chase_companies WHERE org_id = $1 AND id = $2 RETURNING id`,
          [orgId, companyId],
        );
        if (result.rows.length === 0) return { ok: false, error: { kind: "not_found" } };
        await executor.execute(`DELETE FROM chase_people WHERE company_id = $1`, [companyId]);
        return { ok: true, value: undefined };
      } catch (error) {
        return internal(error);
      }
    },

    async upsertPerson(input: UpsertPersonInput): Promise<ChaseResult<{ person: ChasePerson; created: boolean }>> {
      try {
        const inserted = await executor.execute<Record<string, unknown>>(
          `INSERT INTO chase_people
             (id, org_id, company_id, provider_person_key, kind, name, role, appointed_on, resigned_on, verification_state, verified_on)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (company_id, provider_person_key) DO NOTHING
             RETURNING ${PERSON_COLUMNS}`,
          [
            input.id,
            input.orgId,
            input.companyId,
            input.providerPersonKey,
            input.kind,
            input.name,
            input.role,
            input.appointedOn,
            input.resignedOn,
            input.verificationState,
            input.verifiedOn,
          ],
        );
        if (inserted.rows.length > 0) {
          return { ok: true, value: { person: mapPerson(inserted.rows[0]!), created: true } };
        }
        // A person the sweep has seen before: refresh what the provider owns
        // and leave what the FIRM owns (contact_email, chase_step) alone. A
        // manual verification is never undone by a later sync.
        const updated = await executor.execute<Record<string, unknown>>(
          `UPDATE chase_people
              SET kind = $1, name = $2, role = $3, appointed_on = $4, resigned_on = $5,
                  verification_state = CASE WHEN verification_source = 'manual' THEN verification_state ELSE $6 END,
                  verified_on = CASE WHEN verification_source = 'manual' THEN verified_on ELSE $7 END,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE company_id = $8 AND provider_person_key = $9
            RETURNING ${PERSON_COLUMNS}`,
          [
            input.kind,
            input.name,
            input.role,
            input.appointedOn,
            input.resignedOn,
            input.verificationState,
            input.verifiedOn,
            input.companyId,
            input.providerPersonKey,
          ],
        );
        if (updated.rows.length === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: { person: mapPerson(updated.rows[0]!), created: false } };
      } catch (error) {
        return internal(error);
      }
    },

    async listPeopleForCompany(companyId: string): Promise<ChaseResult<ChasePerson[]>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${PERSON_COLUMNS} FROM chase_people WHERE company_id = $1 ORDER BY name ASC, id ASC`,
          [companyId],
        );
        return { ok: true, value: result.rows.map(mapPerson) };
      } catch (error) {
        return internal(error);
      }
    },

    async listPeople(params: ListPeopleParams): Promise<ChaseResult<ChasePersonWithCompany[]>> {
      try {
        const where: string[] = ["p.org_id = $1"];
        const args: unknown[] = [params.orgId];
        if (params.verificationState) {
          args.push(params.verificationState);
          where.push(`p.verification_state = $${args.length}`);
        }
        if (params.companyId) {
          args.push(params.companyId);
          where.push(`p.company_id = $${args.length}`);
        }
        if (params.risk && params.riskCutoff) {
          args.push(params.riskCutoff);
          const cutoff = `$${args.length}`;
          if (params.risk === "at_risk") {
            where.push(`c.next_statement_due IS NOT NULL AND c.next_statement_due <= ${cutoff} AND p.verification_state <> 'verified'`);
          } else if (params.risk === "due_soon") {
            where.push(`c.next_statement_due IS NOT NULL AND c.next_statement_due <= ${cutoff} AND p.verification_state = 'verified'`);
          } else {
            where.push(`(c.next_statement_due IS NULL OR c.next_statement_due > ${cutoff})`);
          }
        }
        args.push(params.limit);
        const limitArg = args.length;
        args.push(params.offset);
        const offsetArg = args.length;
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${PERSON_COLUMNS.split(", ").map((c) => `p.${c}`).join(", ")},
                  c.company_number AS company_number, c.company_name AS company_name,
                  c.next_statement_due AS next_statement_due
             FROM chase_people p
             JOIN chase_companies c ON c.id = p.company_id
            WHERE ${where.join(" AND ")} AND p.resigned_on IS NULL
            ORDER BY (c.next_statement_due IS NULL), c.next_statement_due ASC, p.name ASC, p.id ASC
            LIMIT $${limitArg} OFFSET $${offsetArg}`,
          args,
        );
        return { ok: true, value: result.rows.map(mapPersonWithCompany) };
      } catch (error) {
        return internal(error);
      }
    },

    async getPerson(orgId: string, personId: string): Promise<ChaseResult<ChasePersonWithCompany>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${PERSON_COLUMNS.split(", ").map((c) => `p.${c}`).join(", ")},
                  c.company_number AS company_number, c.company_name AS company_name,
                  c.next_statement_due AS next_statement_due
             FROM chase_people p
             JOIN chase_companies c ON c.id = p.company_id
            WHERE p.org_id = $1 AND p.id = $2`,
          [orgId, personId],
        );
        if (result.rows.length === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapPersonWithCompany(result.rows[0]!) };
      } catch (error) {
        return internal(error);
      }
    },

    async setContactEmailByName(companyId: string, name: string, email: string): Promise<ChaseResult<number>> {
      try {
        const people = await executor.execute<Record<string, unknown>>(
          `SELECT id, name FROM chase_people WHERE company_id = $1`,
          [companyId],
        );
        const target = normaliseName(name);
        let matched = 0;
        for (const row of people.rows) {
          if (normaliseName(str(row.name)) !== target) continue;
          await executor.execute(
            `UPDATE chase_people SET contact_email = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2`,
            [email, str(row.id)],
          );
          matched += 1;
        }
        return { ok: true, value: matched };
      } catch (error) {
        return internal(error);
      }
    },

    async updatePerson(
      orgId: string,
      personId: string,
      patch: { contactEmail?: string | null; verificationState?: VerificationState; verifiedOn?: string | null },
    ): Promise<ChaseResult<ChasePerson>> {
      try {
        const sets: string[] = [];
        const args: unknown[] = [];
        if (patch.contactEmail !== undefined) {
          args.push(patch.contactEmail);
          sets.push(`contact_email = $${args.length}`);
        }
        if (patch.verificationState !== undefined) {
          args.push(patch.verificationState);
          sets.push(`verification_state = $${args.length}`);
          sets.push(`verification_source = 'manual'`);
          args.push(patch.verifiedOn ?? null);
          sets.push(`verified_on = $${args.length}`);
        }
        if (sets.length === 0) {
          const current = await executor.execute<Record<string, unknown>>(
            `SELECT ${PERSON_COLUMNS} FROM chase_people WHERE org_id = $1 AND id = $2`,
            [orgId, personId],
          );
          if (current.rows.length === 0) return { ok: false, error: { kind: "not_found" } };
          return { ok: true, value: mapPerson(current.rows[0]!) };
        }
        sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
        args.push(orgId);
        const orgArg = args.length;
        args.push(personId);
        const idArg = args.length;
        const result = await executor.execute<Record<string, unknown>>(
          `UPDATE chase_people SET ${sets.join(", ")}
            WHERE org_id = $${orgArg} AND id = $${idArg}
            RETURNING ${PERSON_COLUMNS}`,
          args,
        );
        if (result.rows.length === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapPerson(result.rows[0]!) };
      } catch (error) {
        return internal(error);
      }
    },

    async advanceChaseStep(personId: string, step: number, chasedAt: string): Promise<ChaseResult<void>> {
      try {
        await executor.execute(
          `UPDATE chase_people SET chase_step = $1, last_chased_at = $2, updated_at = $2 WHERE id = $3`,
          [step, chasedAt, personId],
        );
        return { ok: true, value: undefined };
      } catch (error) {
        return internal(error);
      }
    },

    async listChaseCandidates(cutoff: string, limit: number): Promise<ChaseResult<ChasePersonWithCompany[]>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${PERSON_COLUMNS.split(", ").map((c) => `p.${c}`).join(", ")},
                  c.company_number AS company_number, c.company_name AS company_name,
                  c.next_statement_due AS next_statement_due
             FROM chase_people p
             JOIN chase_companies c ON c.id = p.company_id
            WHERE p.verification_state = 'unverified'
              AND p.resigned_on IS NULL
              AND p.contact_email IS NOT NULL AND p.contact_email <> ''
              AND p.chase_step < 3
              AND c.next_statement_due IS NOT NULL
              AND c.next_statement_due <= $1
            ORDER BY c.next_statement_due ASC, p.id ASC
            LIMIT $2`,
          [cutoff, limit],
        );
        return { ok: true, value: result.rows.map(mapPersonWithCompany) };
      } catch (error) {
        return internal(error);
      }
    },

    async startSyncRun(input: StartSyncRunInput): Promise<ChaseResult<ChaseSyncRun>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `INSERT INTO chase_sync_runs (id, org_id, trigger, provider)
             VALUES ($1, $2, $3, $4)
             RETURNING ${RUN_COLUMNS}`,
          [input.id, input.orgId, input.trigger, input.provider],
        );
        if (result.rows.length === 0) return { ok: false, error: { kind: "internal", message: "no row returned" } };
        return { ok: true, value: mapSyncRun(result.rows[0]!) };
      } catch (error) {
        return internal(error);
      }
    },

    async finishSyncRun(input: FinishSyncRunInput): Promise<ChaseResult<void>> {
      try {
        await executor.execute(
          `UPDATE chase_sync_runs
              SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                  companies_scanned = $1, people_upserted = $2, errors = $3
            WHERE id = $4 AND org_id = $5`,
          [input.companiesScanned, input.peopleUpserted, input.errors, input.id, input.orgId],
        );
        return { ok: true, value: undefined };
      } catch (error) {
        return internal(error);
      }
    },

    async listSyncRuns(orgId: string, limit: number): Promise<ChaseResult<ChaseSyncRun[]>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${RUN_COLUMNS} FROM chase_sync_runs
            WHERE org_id = $1 ORDER BY started_at DESC, id DESC LIMIT $2`,
          [orgId, limit],
        );
        return { ok: true, value: result.rows.map(mapSyncRun) };
      } catch (error) {
        return internal(error);
      }
    },

    async recordChaseMessage(input: RecordChaseMessageInput): Promise<ChaseResult<ChaseMessage>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `INSERT INTO chase_messages
             (id, org_id, person_id, company_id, step, to_address, template_key, notification_id, enqueue_result)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING ${MESSAGE_COLUMNS}`,
          [
            input.id,
            input.orgId,
            input.personId,
            input.companyId,
            input.step,
            input.toAddress,
            input.templateKey,
            input.notificationId,
            input.enqueueResult,
          ],
        );
        if (result.rows.length === 0) return { ok: false, error: { kind: "internal", message: "no row returned" } };
        return { ok: true, value: mapMessage(result.rows[0]!) };
      } catch (error) {
        return internal(error);
      }
    },

    async listChaseMessages(orgId: string, limit: number, offset: number): Promise<ChaseResult<ChaseMessage[]>> {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${MESSAGE_COLUMNS} FROM chase_messages
            WHERE org_id = $1 ORDER BY sent_at DESC, id DESC LIMIT $2 OFFSET $3`,
          [orgId, limit, offset],
        );
        return { ok: true, value: result.rows.map(mapMessage) };
      } catch (error) {
        return internal(error);
      }
    },
  };
}
