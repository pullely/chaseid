export type { SqlExecutor, SqlExecutorResult, SqlRow } from "../d1/executor.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ChaseRepositoryError =
  | { kind: "not_found" }
  | { kind: "conflict"; entity: string }
  | { kind: "internal"; message: string };

export type ChaseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ChaseRepositoryError };

// ---------------------------------------------------------------------------
// Domain types (transport-safe; nothing platform-shaped leaks through)
// ---------------------------------------------------------------------------

export type CompanyStatus = "active" | "dissolved" | "liquidation" | "unknown";
export type SyncState = "never" | "ok" | "not_found" | "provider_error";
export type CompanySource = "csv" | "api" | "manual";
export type VerificationState = "verified" | "unverified" | "unknown";
export type VerificationSource = "companies_house" | "manual";
export type PersonKind = "officer" | "psc";
export type SyncTrigger = "cron" | "manual" | "import";
export type ProviderKind = "http" | "fixture";
export type EnqueueResult =
  | "ok"
  | "no_binding"
  | "non_2xx"
  | "network_error"
  | "bad_response";

export interface ChaseCompany {
  id: string;
  orgId: string;
  companyNumber: string;
  companyName: string;
  companyStatus: CompanyStatus;
  nextStatementDue: string | null;
  lastSyncedAt: string | null;
  lastSyncState: SyncState;
  lastSyncError: string | null;
  source: CompanySource;
  createdAt: string;
  updatedAt: string;
}

export interface ChasePerson {
  id: string;
  orgId: string;
  companyId: string;
  providerPersonKey: string;
  kind: PersonKind;
  name: string;
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
  verificationState: VerificationState;
  verificationSource: VerificationSource;
  verifiedOn: string | null;
  contactEmail: string | null;
  chaseStep: number;
  lastChasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A person joined to the company whose filing their verification blocks —
 *  the row the status board and the at-risk report are both built from. */
export interface ChasePersonWithCompany extends ChasePerson {
  companyNumber: string;
  companyName: string;
  nextStatementDue: string | null;
}

export interface ChaseSyncRun {
  id: string;
  orgId: string;
  trigger: SyncTrigger;
  provider: ProviderKind;
  startedAt: string;
  finishedAt: string | null;
  companiesScanned: number;
  peopleUpserted: number;
  errors: number;
  createdAt: string;
}

export interface ChaseMessage {
  id: string;
  orgId: string;
  personId: string;
  companyId: string;
  step: number;
  channel: string;
  toAddress: string;
  templateKey: string;
  notificationId: string | null;
  enqueueResult: EnqueueResult;
  sentAt: string;
}

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export interface UpsertCompanyInput {
  id: string;
  orgId: string;
  companyNumber: string;
  source: CompanySource;
}

export interface ApplySyncInput {
  companyId: string;
  companyName: string;
  companyStatus: CompanyStatus;
  nextStatementDue: string | null;
  syncState: SyncState;
  syncError: string | null;
  syncedAt: string;
}

export interface UpsertPersonInput {
  id: string;
  orgId: string;
  companyId: string;
  providerPersonKey: string;
  kind: PersonKind;
  name: string;
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
  verificationState: VerificationState;
  verifiedOn: string | null;
}

export interface StartSyncRunInput {
  id: string;
  orgId: string;
  trigger: SyncTrigger;
  provider: ProviderKind;
}

export interface FinishSyncRunInput {
  id: string;
  orgId: string;
  companiesScanned: number;
  peopleUpserted: number;
  errors: number;
}

export interface RecordChaseMessageInput {
  id: string;
  orgId: string;
  personId: string;
  companyId: string;
  step: number;
  toAddress: string;
  templateKey: string;
  notificationId: string | null;
  enqueueResult: EnqueueResult;
}

export interface ListCompaniesParams {
  orgId: string;
  limit: number;
  offset: number;
}

export interface ListPeopleParams {
  orgId: string;
  limit: number;
  offset: number;
  verificationState?: VerificationState;
  companyId?: string;
  /** The DERIVED risk, expressed as the predicate `risk.ts` computes: a
   *  filing on or before `riskCutoff` with the person not verified is
   *  `at_risk`, verified is `due_soon`, and everything else is `ok`. Both
   *  fields or neither. */
  risk?: "at_risk" | "due_soon" | "ok";
  riskCutoff?: string;
}

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

export interface ChaseRepository {
  /** Insert the company, or return the row that already holds this
   *  (org_id, company_number). Idempotent by design: re-importing a CSV must
   *  never duplicate a client. */
  upsertCompany(input: UpsertCompanyInput): Promise<ChaseResult<{ company: ChaseCompany; created: boolean }>>;
  getCompany(orgId: string, companyId: string): Promise<ChaseResult<ChaseCompany>>;
  getCompanyByNumber(orgId: string, companyNumber: string): Promise<ChaseResult<ChaseCompany>>;
  listCompanies(params: ListCompaniesParams): Promise<ChaseResult<ChaseCompany[]>>;
  countCompanies(orgId: string): Promise<ChaseResult<number>>;
  /** Every company in the register, across all orgs, oldest sync first — the
   *  nightly sweep's work queue. */
  listCompaniesForSweep(limit: number): Promise<ChaseResult<ChaseCompany[]>>;
  applySync(input: ApplySyncInput): Promise<ChaseResult<void>>;
  deleteCompany(orgId: string, companyId: string): Promise<ChaseResult<void>>;

  upsertPerson(input: UpsertPersonInput): Promise<ChaseResult<{ person: ChasePerson; created: boolean }>>;
  listPeopleForCompany(companyId: string): Promise<ChaseResult<ChasePerson[]>>;
  listPeople(params: ListPeopleParams): Promise<ChaseResult<ChasePersonWithCompany[]>>;
  getPerson(orgId: string, personId: string): Promise<ChaseResult<ChasePersonWithCompany>>;
  setContactEmailByName(companyId: string, name: string, email: string): Promise<ChaseResult<number>>;
  updatePerson(
    orgId: string,
    personId: string,
    patch: { contactEmail?: string | null; verificationState?: VerificationState; verifiedOn?: string | null },
  ): Promise<ChaseResult<ChasePerson>>;
  advanceChaseStep(personId: string, step: number, chasedAt: string): Promise<ChaseResult<void>>;
  /** The morning sweep's candidates across every org: unverified, not
   *  resigned, with an address, not yet escalated, on a company whose
   *  statement is due on or before `cutoff` (ISO date). Soonest filing first. */
  listChaseCandidates(cutoff: string, limit: number): Promise<ChaseResult<ChasePersonWithCompany[]>>;

  startSyncRun(input: StartSyncRunInput): Promise<ChaseResult<ChaseSyncRun>>;
  finishSyncRun(input: FinishSyncRunInput): Promise<ChaseResult<void>>;
  listSyncRuns(orgId: string, limit: number): Promise<ChaseResult<ChaseSyncRun[]>>;

  recordChaseMessage(input: RecordChaseMessageInput): Promise<ChaseResult<ChaseMessage>>;
  listChaseMessages(orgId: string, limit: number, offset: number): Promise<ChaseResult<ChaseMessage[]>>;
}
